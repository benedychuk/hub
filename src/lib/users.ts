"use server";
import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { appUrl } from "./bot";
import { audit, createSession, currentUser, destroySession, hashPassword, INVITE_HOURS, newToken, passwordProblem, requireUser, sha256, usersExist, verifyPassword, checkBootstrapPassword, type Role } from "./auth";

const { users, userSessions } = schema;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const email = (fd: FormData) => str(fd, "email").toLowerCase();
const back = (msg: string, tab = "users") => redirect(`/settings?tab=${tab}&${msg.startsWith("ok:") ? "ok=" + encodeURIComponent(msg.slice(3)) : "err=" + encodeURIComponent(msg)}`);

/** Перший вхід: створення акаунта власника. Працює лише поки акаунтів немає. */
export async function bootstrapOwner(fd: FormData) {
  if (await usersExist()) redirect("/login");
  if (!checkBootstrapPassword(str(fd, "adminPassword"))) redirect("/login?error=" + encodeURIComponent("Пароль ADMIN_PASSWORD не підійшов"));
  const pw = str(fd, "password"); const problem = passwordProblem(pw);
  if (problem) redirect("/login?error=" + encodeURIComponent(problem));
  if (pw !== str(fd, "password2")) redirect("/login?error=" + encodeURIComponent("Паролі не збігаються"));
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email(fd))) redirect("/login?error=" + encodeURIComponent("Вкажіть коректний email"));
  const [u] = await db().insert(users).values({ email: email(fd), name: str(fd, "name") || "Власник", role: "owner", status: "active", passwordHash: hashPassword(pw) }).returning();
  await audit("user.bootstrap", { userId: u.id, email: u.email }, u);
  await createSession(u.id);
  redirect("/settings?tab=users&ok=" + encodeURIComponent("Акаунт власника створено. Спільний пароль ADMIN_PASSWORD більше не використовується для входу."));
}

/** Вхід за email і паролем: 5 невдалих спроб блокують акаунт на 15 хвилин. */
export async function login(fd: FormData) {
  const next = str(fd, "next") || "/"; const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const fail = (msg: string) => redirect(`/login?error=${encodeURIComponent(msg)}&next=${encodeURIComponent(safeNext)}`);
  const [u] = await db().select().from(users).where(eq(users.email, email(fd)));
  const pw = str(fd, "password");
  if (!u || u.status !== "active" || !u.passwordHash) { await audit("user.login_failed", { email: email(fd), reason: u ? u.status : "unknown" }); fail("Email або пароль не підійшли"); return; }
  if (u.lockedUntil && u.lockedUntil.getTime() > Date.now()) fail(`Забагато спроб. Спробуйте після ${u.lockedUntil.toLocaleTimeString("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" })}`);
  if (!verifyPassword(pw, u.passwordHash)) {
    const attempts = u.failedAttempts + 1;
    await db().update(users).set({ failedAttempts: attempts, lockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60_000) : null }).where(eq(users.id, u.id));
    await audit("user.login_failed", { userId: u.id, email: u.email, attempts });
    fail("Email або пароль не підійшли");
  }
  await db().update(users).set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, u.id));
  await audit("user.login", { userId: u.id, email: u.email }, u);
  await createSession(u.id);
  redirect(safeNext);
}

export async function logout() {
  const u = await currentUser();
  await destroySession();
  if (u) await audit("user.logout", { userId: u.id }, u);
  redirect("/login");
}

// ---------- керування користувачами ----------
async function actor() { const u = await requireUser("/settings?tab=users"); if (!u) throw new Error("Спершу створіть акаунт власника"); return u; }
function canManage(me: { id: number; role: string }, target: { id: number; role: string }) {
  if (me.id === target.id) return false;            // себе змінюють у «Мій акаунт»
  if (me.role === "owner") return true;
  return target.role !== "owner";                  // адміністратор не чіпає власників
}
async function makeInviteLink(userId: number, purpose: "invite" | "reset") {
  const token = newToken();
  await db().update(users).set({ inviteTokenHash: sha256(token), inviteExpiresAt: new Date(Date.now() + INVITE_HOURS * 3600_000), invitePurpose: purpose, updatedAt: new Date() }).where(eq(users.id, userId));
  return `${appUrl()}/invite/${token}`;
}

export async function createUser(fd: FormData) {
  const me = await actor();
  const e = email(fd); const name = str(fd, "name");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) back("Вкажіть коректний email");
  const role: Role = me.role === "owner" && str(fd, "role") === "owner" ? "owner" : "admin";
  const [dup] = await db().select({ id: users.id }).from(users).where(eq(users.email, e));
  if (dup) back("Користувач із таким email уже є");
  const [u] = await db().insert(users).values({ email: e, name: name || e.split("@")[0], role, status: "invited", createdBy: me.id }).returning();
  const link = await makeInviteLink(u.id, "invite");
  await audit("user.invited", { userId: u.id, email: e, role }, me);
  revalidatePath("/settings");
  redirect(`/settings?tab=users&link=${encodeURIComponent(link)}&for=${encodeURIComponent(u.name)}`);
}
export async function resetUserPassword(fd: FormData) {
  const me = await actor(); const id = Number(fd.get("id"));
  const [u] = await db().select().from(users).where(eq(users.id, id));
  if (!u || !canManage(me, u)) back("Немає права на цю дію");
  const link = await makeInviteLink(id, "reset");
  await db().update(userSessions).set({ revokedAt: new Date() }).where(and(eq(userSessions.userId, id), sql`${userSessions.revokedAt} is null`));
  await audit("user.password_reset_link", { userId: id, email: u!.email }, me);
  revalidatePath("/settings");
  redirect(`/settings?tab=users&link=${encodeURIComponent(link)}&for=${encodeURIComponent(u!.name)}&reset=1`);
}
export async function toggleUser(fd: FormData) {
  const me = await actor(); const id = Number(fd.get("id"));
  const [u] = await db().select().from(users).where(eq(users.id, id));
  if (!u || !canManage(me, u)) back("Немає права на цю дію");
  if (u!.status === "active" && u!.role === "owner") { const [n] = await db().select({ c: sql<number>`count(*)::int` }).from(users).where(and(eq(users.role, "owner"), eq(users.status, "active"), ne(users.id, id))); if (n.c === 0) back("Має лишатися хоча б один активний власник"); }
  const next = u!.status === "disabled" ? (u!.passwordHash ? "active" : "invited") : "disabled";
  await db().update(users).set({ status: next, updatedAt: new Date() }).where(eq(users.id, id));
  if (next === "disabled") await db().update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.userId, id));
  await audit(next === "disabled" ? "user.disabled" : "user.enabled", { userId: id, email: u!.email }, me);
  revalidatePath("/settings"); back(`ok:${u!.name}: ${next === "disabled" ? "вимкнено" : "увімкнено"}`);
}
export async function changeRole(fd: FormData) {
  const me = await actor(); if (me.role !== "owner") back("Ролі змінює лише власник");
  const id = Number(fd.get("id")); const role: Role = str(fd, "role") === "owner" ? "owner" : "admin";
  if (id === me.id) back("Свою роль змінити не можна");
  await db().update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, id));
  await audit("user.role", { userId: id, role }, me);
  revalidatePath("/settings"); back("ok:Роль змінено");
}
export async function revokeUserSessions(fd: FormData) {
  const me = await actor(); const id = Number(fd.get("id"));
  const [u] = await db().select().from(users).where(eq(users.id, id));
  if (!u || !canManage(me, u)) back("Немає права на цю дію");
  await db().update(userSessions).set({ revokedAt: new Date() }).where(and(eq(userSessions.userId, id), sql`${userSessions.revokedAt} is null`));
  await audit("user.sessions_revoked", { userId: id }, me);
  revalidatePath("/settings"); back(`ok:${u!.name}: вихід на всіх пристроях виконано`);
}
export async function deleteUser(fd: FormData) {
  const me = await actor(); const id = Number(fd.get("id"));
  const [u] = await db().select().from(users).where(eq(users.id, id));
  if (!u || !canManage(me, u)) back("Немає права на цю дію");
  if (u!.role === "owner") { const [n] = await db().select({ c: sql<number>`count(*)::int` }).from(users).where(and(eq(users.role, "owner"), eq(users.status, "active"), ne(users.id, id))); if (n.c === 0) back("Останнього власника видалити не можна"); }
  await db().delete(users).where(eq(users.id, id));
  await audit("user.deleted", { userId: id, email: u!.email }, me);
  revalidatePath("/settings"); back(`ok:${u!.name}: акаунт видалено`);
}

// ---------- мій акаунт ----------
export async function updateProfile(fd: FormData) {
  const me = await actor();
  const name = str(fd, "name"); const e = email(fd);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) back("Вкажіть коректний email", "account");
  const [dup] = await db().select({ id: users.id }).from(users).where(and(eq(users.email, e), ne(users.id, me.id)));
  if (dup) back("Цей email уже зайнятий", "account");
  await db().update(users).set({ name: name || me.name, email: e, updatedAt: new Date() }).where(eq(users.id, me.id));
  revalidatePath("/settings"); back("ok:Профіль збережено", "account");
}
export async function changePassword(fd: FormData) {
  const me = await actor();
  if (!verifyPassword(str(fd, "current"), me.passwordHash)) back("Поточний пароль не підійшов", "account");
  const pw = str(fd, "password"); const problem = passwordProblem(pw);
  if (problem) back(problem, "account");
  if (pw !== str(fd, "password2")) back("Нові паролі не збігаються", "account");
  await db().update(users).set({ passwordHash: hashPassword(pw), updatedAt: new Date() }).where(eq(users.id, me.id));
  await db().update(userSessions).set({ revokedAt: new Date() }).where(and(eq(userSessions.userId, me.id), ne(userSessions.id, me.sessionId)));
  await audit("user.password_changed", { userId: me.id }, me);
  revalidatePath("/settings"); back("ok:Пароль змінено; інші пристрої вийшли з акаунта", "account");
}
export async function revokeMySession(fd: FormData) {
  const me = await actor(); const id = Number(fd.get("id"));
  await db().update(userSessions).set({ revokedAt: new Date() }).where(and(eq(userSessions.id, id), eq(userSessions.userId, me.id)));
  revalidatePath("/settings"); back("ok:Сесію завершено", "account");
}

/** Приймання запрошення або скидання пароля за посиланням. */
export async function acceptInvite(fd: FormData) {
  const token = str(fd, "token");
  const [u] = await db().select().from(users).where(eq(users.inviteTokenHash, sha256(token)));
  const fail = (m: string) => redirect(`/invite/${token}?error=${encodeURIComponent(m)}`);
  if (!u || !u.inviteExpiresAt || u.inviteExpiresAt.getTime() < Date.now() || u.status === "disabled") fail("Посилання недійсне або прострочене. Попросіть нове.");
  const pw = str(fd, "password"); const problem = passwordProblem(pw);
  if (problem) fail(problem);
  if (pw !== str(fd, "password2")) fail("Паролі не збігаються");
  await db().update(users).set({ passwordHash: hashPassword(pw), status: "active", inviteTokenHash: null, inviteExpiresAt: null, invitePurpose: null, failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), name: str(fd, "name") || u!.name, updatedAt: new Date() }).where(eq(users.id, u!.id));
  await db().update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.userId, u!.id));
  await audit(u!.invitePurpose === "reset" ? "user.password_reset" : "user.activated", { userId: u!.id, email: u!.email }, u!);
  await createSession(u!.id);
  redirect("/");
}
