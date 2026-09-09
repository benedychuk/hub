import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db, hasDb, schema } from "@/db";

const { users, userSessions, events } = schema;
export const COOKIE = "hub_session";
export const SESSION_DAYS = 30;
export const INVITE_HOURS = 72;
export const MIN_PASSWORD = 10;
export type User = typeof users.$inferSelect;
export type Role = "owner" | "admin";
export const ROLE_LABEL: Record<string, string> = { owner: "Власник", admin: "Адміністратор" };

export function authEnabled() { return Boolean(process.env.ADMIN_PASSWORD); }
/** Числовий Telegram id адміністратора зі змінної ADMIN_TELEGRAM_ID; літери й пробіли відкидаються. */
export function adminTelegramId(): number { return Number(String(process.env.ADMIN_TELEGRAM_ID ?? "").replace(/\D/g, "")) || 0; }

// ---------- паролі й токени ----------
export function hashPassword(pw: string) {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(pw.normalize("NFKC"), salt, 64, { N: 16384, r: 8, p: 1 }).toString("base64url");
  return `scrypt$16384$${salt}$${hash}`;
}
export function verifyPassword(pw: string, stored: string | null | undefined) {
  if (!stored) return false;
  const [algo, n, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const calc = scryptSync(pw.normalize("NFKC"), salt, 64, { N: Number(n) || 16384, r: 8, p: 1 });
  const ref = Buffer.from(hash, "base64url");
  return calc.length === ref.length && timingSafeEqual(calc, ref);
}
export function newToken() { return randomBytes(32).toString("base64url"); }
export function sha256(s: string) { return createHash("sha256").update(s).digest("hex"); }
export function passwordProblem(pw: string) {
  if (pw.length < MIN_PASSWORD) return `Пароль має бути не коротший за ${MIN_PASSWORD} знаків`;
  if (!/[a-zA-Zа-яА-ЯіІїЇєЄґҐ]/.test(pw) || !/\d/.test(pw)) return "Пароль має містити і літери, і цифри";
  return null;
}
/** Перший вхід без акаунтів: підтвердження паролем зі змінної ADMIN_PASSWORD. */
export function checkBootstrapPassword(input: string) {
  const pw = process.env.ADMIN_PASSWORD ?? "";
  if (!pw) return true; // пароль не заданий: панель у режимі налаштування
  const a = Buffer.from(input), b = Buffer.from(pw);
  return a.length === b.length && timingSafeEqual(a, b);
}
/** Старий підпис сесії (одна спільна на всіх): лишається лише для періоду, поки акаунтів ще немає. */
export function legacySessionToken() {
  const secret = process.env.SESSION_SECRET ?? process.env.TELEGRAM_BOT_TOKEN ?? "hub";
  return createHmac("sha256", secret).update("session:" + (process.env.ADMIN_PASSWORD ?? "")).digest("hex");
}

// ---------- сесії ----------
export async function usersExist() { if (!hasDb()) return false; const [r] = await db().select({ c: sql<number>`count(*)::int` }).from(users); return r.c > 0; }

async function reqInfo() {
  const h = await headers();
  return { ip: (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || null, userAgent: (h.get("user-agent") ?? "").slice(0, 200) || null };
}
export async function createSession(userId: number) {
  const token = newToken();
  const info = await reqInfo();
  await db().insert(userSessions).values({ userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000), ...info });
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_DAYS * 86400 });
}
export async function destroySession() {
  const c = await cookies(); const token = c.get(COOKIE)?.value;
  if (token && hasDb()) await db().update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.tokenHash, sha256(token)));
  c.delete(COOKIE);
}
/** Поточний користувач за cookie сесії; null, якщо сесії немає, її відкликано або акаунт вимкнено. */
export async function currentUser(): Promise<(User & { sessionId: number }) | null> {
  if (!hasDb()) return null;
  const token = (await cookies()).get(COOKIE)?.value; if (!token) return null;
  const [row] = await db().select({ u: users, s: userSessions }).from(userSessions).innerJoin(users, eq(users.id, userSessions.userId))
    .where(and(eq(userSessions.tokenHash, sha256(token)), isNull(userSessions.revokedAt), gt(userSessions.expiresAt, new Date()), eq(users.status, "active")));
  if (!row) return null;
  if (Date.now() - row.s.lastSeenAt.getTime() > 10 * 60_000) await db().update(userSessions).set({ lastSeenAt: new Date() }).where(eq(userSessions.id, row.s.id)).catch(() => null);
  return { ...row.u, sessionId: row.s.id };
}
/** Для сторінок і дій: перенаправляє на вхід, якщо акаунти вже є, а сесії немає. Поки акаунтів немає, повертає null (перехідний режим). */
export async function requireUser(next = "/") {
  const u = await currentUser();
  if (u) return u;
  if (await usersExist()) redirect("/login?next=" + encodeURIComponent(next));
  return null;
}
export async function requireOwner() {
  const u = await requireUser("/settings?tab=users");
  if (!u || u.role !== "owner") throw new Error("Лише власник може це робити");
  return u;
}
export async function audit(type: string, payload: Record<string, unknown>, actor?: { id: number; email: string } | null) {
  const info = await reqInfo().catch(() => ({ ip: null, userAgent: null }));
  await db().insert(events).values({ personId: null, type, source: "auth", payload: { ...payload, actor: actor ? { id: actor.id, email: actor.email } : null, ip: info.ip } }).catch(() => null);
}
