import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { createHash, randomBytes } from "crypto";
import { db, schema } from "@/db";

const { persons, subscriptions, entitlements, resources, plans, bots, events } = schema;

export type AccessResult =
  | { allowed: true; person_id: number; valid_until: string | null; plan: string | null; source: "manual" | "plan" | "zenedu"; quota: { per_day: number | null; used_today: number } }
  | { allowed: false; person_id: number | null; reason: "unknown_person" | "no_subscription" | "expired" | "quota_exceeded"; offer_url: string | null };

function todayKyiv() { return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Kyiv" }); }

/**
 * Чи має людина право на ресурс. Джерела, за пріоритетом:
 * 1) ручне право (entitlements) з чинним valid_until;
 * 2) активна підписка Hub, чий тариф містить ресурс;
 * 3) перехідне правило: активна підписка ZenEdu, якщо ресурс має config.zenedu_grants = true
 *    (повторює нинішню поведінку «Щиро»: доступ усім активним учасницям клубу).
 */
export async function checkAccess(telegramUserId: number, resourceKey: string): Promise<AccessResult> {
  const d = db();
  const [p] = await d.select({ id: persons.id }).from(persons).where(eq(persons.telegramUserId, telegramUserId));
  const [res] = await d.select().from(resources).where(eq(resources.key, resourceKey));
  const cfg = (res?.config ?? {}) as { zenedu_grants?: boolean; offer_url?: string; quota_per_day?: number };
  const offer = cfg.offer_url ?? null;
  if (!p) return { allowed: false, person_id: null, reason: "unknown_person", offer_url: offer };
  const now = new Date();

  const [ent] = await d.select().from(entitlements).where(and(eq(entitlements.personId, p.id), eq(entitlements.resourceKey, resourceKey), isNull(entitlements.revokedAt), or(isNull(entitlements.validUntil), gt(entitlements.validUntil, now)))).limit(1);
  let source: "manual" | "plan" | "zenedu" | null = ent ? "manual" : null;
  let validUntil: Date | null = ent?.validUntil ?? null;
  let planKey: string | null = null;
  let quotaPerDay: number | null = ent?.quota ? Number(String(ent.quota).replace(/\D/g, "")) || null : null;

  if (!source) {
    const subs = await d.select({ s: subscriptions, planKey: plans.key, ents: plans.entitlements }).from(subscriptions).leftJoin(plans, eq(plans.id, subscriptions.planId))
      .where(and(eq(subscriptions.personId, p.id), sql`${subscriptions.status} in ('active','trialing','past_due')`));
    for (const row of subs) {
      const has = row.ents && Object.prototype.hasOwnProperty.call(row.ents, resourceKey);
      if (has) { source = "plan"; validUntil = row.s.currentPeriodEnd; planKey = row.planKey; const q = row.ents?.[resourceKey]; quotaPerDay = q ? Number(String(q).replace(/\D/g, "")) || null : null; break; }
      if (row.s.source === "zenedu" && cfg.zenedu_grants) { source = "zenedu"; validUntil = row.s.currentPeriodEnd; planKey = "zenedu"; }
    }
    if (!source) {
      const anyExpired = await d.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.personId, p.id)).limit(1);
      return { allowed: false, person_id: p.id, reason: anyExpired.length ? "expired" : "no_subscription", offer_url: offer };
    }
  }
  const perDay = quotaPerDay ?? cfg.quota_per_day ?? null;
  const [used] = await d.select({ c: sql<number>`count(*)::int` }).from(events).where(and(eq(events.personId, p.id), eq(events.type, `${resourceKey}.usage`), sql`${events.createdAt} >= (now() at time zone 'Europe/Kyiv')::date`));
  if (perDay && used.c >= perDay) return { allowed: false, person_id: p.id, reason: "quota_exceeded", offer_url: offer };
  return { allowed: true, person_id: p.id, valid_until: validUntil ? validUntil.toISOString() : null, plan: planKey, source, quota: { per_day: perDay, used_today: used.c } };
}

export function hashKey(k: string) { return createHash("sha256").update(k).digest("hex"); }
export function newApiKey(prefix = "hub") { return `${prefix}_${randomBytes(24).toString("base64url")}`; }

/** Автентифікація зовнішнього бота за Bearer-ключем; оновлює лічильники. */
export async function authBot(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  const key = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!key) return null;
  const [b] = await db().select().from(bots).where(and(eq(bots.apiKeyHash, hashKey(key)), eq(bots.isActive, true)));
  if (!b) return null;
  const day = todayKyiv();
  await db().update(bots).set({ lastSeenAt: new Date(), requestsToday: b.requestsDay === day ? sql`${bots.requestsToday} + 1` : 1, requestsDay: day }).where(eq(bots.id, b.id));
  return b;
}
