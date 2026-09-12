import { and, eq, inArray, isNull, or, gt, sql, desc } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db, schema } from "@/db";
import { reactivateOrEnroll, stopEnrollment, deleteDelivered } from "./funnels";
import { accessTick } from "./telegram-access";
import { money } from "./format";

const { plans, subscriptions, entitlements, funnels, funnelEnrollments, accessLinks, events, orders, paymentAttempts } = schema;
export type Offer = typeof plans.$inferSelect;
export type OfferSettings = NonNullable<Offer["settings"]>;

// ---------- інтервал, ціна, доступ ----------
export const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, month: 30, quarter: 90, year: 365 };
export const UNIT_LABEL: Record<string, { one: string; short: string; many: string }> = {
  day: { one: "день", short: "дн", many: "днів" }, week: { one: "тиждень", short: "тиж", many: "тижнів" }, month: { one: "місяць", short: "міс", many: "місяців" },
  quarter: { one: "квартал", short: "3 міс", many: "кварталів" }, year: { one: "рік", short: "рік", many: "років" },
};
export function periodDaysOf(pl: Pick<Offer, "period" | "intervalCount">) { return Math.max(1, (pl.intervalCount || 1) * (UNIT_DAYS[pl.period] ?? 30)); }
/** «міс», «3 міс», «2 тиж», «рік». */
export function intervalLabel(pl: Pick<Offer, "period" | "intervalCount">) {
  const n = pl.intervalCount || 1; const u = UNIT_LABEL[pl.period] ?? UNIT_LABEL.month;
  if (pl.period === "quarter") return `${3 * n} міс`;
  return n === 1 ? u.short : `${n} ${u.short}`;
}
export function priceLabel(pl: Pick<Offer, "price" | "currency" | "paymentType" | "period" | "intervalCount">) {
  return pl.paymentType === "one_time" ? money(pl.price, pl.currency) : `${money(pl.price, pl.currency)} / ${intervalLabel(pl)}`;
}
export function accessLabel(pl: Pick<Offer, "paymentType" | "accessMode" | "accessDays" | "accessUntil">) {
  if (pl.paymentType !== "one_time") return "поки діє підписка";
  if (pl.accessMode === "days") return `${pl.accessDays ?? 0} дн після оплати`;
  if (pl.accessMode === "until") return pl.accessUntil ? `до ${pl.accessUntil.toLocaleDateString("uk-UA")}` : "до дати";
  if (pl.accessMode === "none") return "без доступу";
  return "безстроково";
}
/** Коли закінчується доступ, отриманий за оффером, якщо він починається з from. null = безстроково. */
export function accessEndFor(pl: Pick<Offer, "paymentType" | "accessMode" | "accessDays" | "accessUntil" | "period" | "intervalCount">, from: Date): Date | null {
  if (pl.paymentType !== "one_time") return new Date(from.getTime() + periodDaysOf(pl) * 86400_000);
  if (pl.accessMode === "days") return new Date(from.getTime() + Math.max(0, pl.accessDays ?? 0) * 86400_000);
  if (pl.accessMode === "until") return pl.accessUntil ?? from;
  if (pl.accessMode === "none") return from;
  return null;
}

// ---------- статистика й доступність ----------
export async function offerSales(planId: number) {
  const d = db();
  const [pay] = await d.select({ c: sql<number>`count(*)::int`, sum: sql<string>`coalesce(sum(amount), 0)` }).from(paymentAttempts)
    .where(and(eq(paymentAttempts.planId, planId), eq(paymentAttempts.status, "approved"), inArray(paymentAttempts.kind, ["first", "manual", "renewal"])));
  const [gr] = await d.select({ c: sql<number>`count(*)::int` }).from(subscriptions).where(and(eq(subscriptions.planId, planId), eq(subscriptions.source, "hub"), eq(subscriptions.kind, "grant")));
  const [act] = await d.select({ c: sql<number>`count(*)::int` }).from(subscriptions).where(and(eq(subscriptions.planId, planId), eq(subscriptions.source, "hub"), inArray(subscriptions.status, ["active", "trialing", "past_due"])));
  return { payments: pay.c, grants: gr.c, revenue: Number(pay.sum), active: act.c };
}
/** Зайняті місця: оплачені підписки + доступи за посиланнями, позначеними «рахувати як оплату». */
export async function spotsUsed(planId: number) {
  const r = await db().execute(sql`select count(*)::int as c from subscriptions s left join access_links l on l.id = s.access_link_id
    where s.source = 'hub' and s.plan_id = ${planId} and (s.kind <> 'grant' or coalesce(l.mark_as_payment, false))`);
  return Number((r.rows[0] as { c: number }).c);
}
export async function offerAvailability(pl: Offer): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!pl.isActive) return { ok: false, reason: "Оффер зупинено" };
  if (pl.salesEndAt && pl.salesEndAt < new Date()) return { ok: false, reason: "Продажі за цим оффером завершено" };
  if (pl.spotsLimit && (await spotsUsed(pl.id)) >= pl.spotsLimit) return { ok: false, reason: "Усі місця вже зайняті" };
  return { ok: true };
}

// ---------- доступ без оплати ----------
export function newLinkToken() { return randomBytes(9).toString("base64url"); }

/** Дає людині доступ за оффером без оплати (посилання доступу або вручну адміністратором). */
export async function grantOffer(personId: number, planId: number, by: string, opts: { linkId?: number; until?: Date | null } = {}) {
  const d = db(); const now = new Date();
  const [pl] = await d.select().from(plans).where(eq(plans.id, planId)); if (!pl) throw new Error("Оффер не знайдено");
  const end = opts.until !== undefined ? opts.until : accessEndFor(pl, now);
  const [cur] = await d.select().from(subscriptions).where(and(eq(subscriptions.personId, personId), eq(subscriptions.source, "hub"), eq(subscriptions.planId, planId))).orderBy(desc(subscriptions.updatedAt)).limit(1);
  const activeNow = cur && ["active", "trialing", "past_due"].includes(cur.status) && (!cur.currentPeriodEnd || cur.currentPeriodEnd > now);
  // чинну платну підписку не чіпаємо: лише подовжуємо дату, якщо доступ довший
  const row = activeNow && cur.kind !== "grant"
    ? { currentPeriodEnd: end === null ? null : cur.currentPeriodEnd && cur.currentPeriodEnd > end ? cur.currentPeriodEnd : end, updatedAt: now }
    : { planId, kind: "grant", accessLinkId: opts.linkId ?? null, status: "active", price: "0", currency: pl.currency, periodDays: end ? Math.max(1, Math.round((end.getTime() - now.getTime()) / 86400_000)) : 0, currentPeriodEnd: end, nextChargeAt: null, nextRetryAt: null, retryCount: 0, cancelAtPeriodEnd: false, pausedAt: null, cancelledAt: null, startedAt: cur?.startedAt ?? now, updatedAt: now };
  const [s] = cur ? await d.update(subscriptions).set(row).where(eq(subscriptions.id, cur.id)).returning() : await d.insert(subscriptions).values({ personId, source: "hub", ...(row as typeof row & { planId: number }) }).returning();
  await d.insert(events).values({ personId, type: "access.granted", source: by, payload: { planId, plan: pl.key, name: pl.name, until: end, linkId: opts.linkId ?? null } });
  await syncProductAccess(personId).catch(() => null);
  await accessTick().catch(() => null);
  return { plan: pl, sub: s, until: end };
}

export async function grantByLink(token: string, personId: number) {
  const d = db();
  const [l] = await d.select().from(accessLinks).where(eq(accessLinks.token, token));
  if (!l || !l.isActive) return { ok: false as const, reason: "Посилання більше не діє." };
  if (l.expiresAt && l.expiresAt < new Date()) return { ok: false as const, reason: "Термін дії посилання минув." };
  if (l.maxUses && l.usedCount >= l.maxUses) return { ok: false as const, reason: "Усі місця за цим посиланням уже зайняті." };
  const [pl] = await d.select().from(plans).where(eq(plans.id, l.planId));
  if (!pl) return { ok: false as const, reason: "Оффер не знайдено." };
  const [already] = await d.select({ id: subscriptions.id }).from(subscriptions).where(and(eq(subscriptions.personId, personId), eq(subscriptions.accessLinkId, l.id)));
  if (!already) await d.update(accessLinks).set({ usedCount: sql`${accessLinks.usedCount} + 1` }).where(eq(accessLinks.id, l.id));
  const r = await grantOffer(personId, pl.id, "access_link", { linkId: l.id });
  if (l.markAsPayment && !already) await d.insert(orders).values({ source: "hub", personId, offerName: pl.name, type: pl.paymentType === "one_time" ? "one_time" : "subscription_start", price: "0", currency: pl.currency, status: "paid", paymentSystem: "access_link", paidAt: new Date() });
  return { ok: true as const, plan: pl, until: r.until };
}

// ---------- синхронізація доступу до продуктів ----------
/** Разові оффери й доступи за посиланням: після дати закінчення підписка стає expired. */
export async function expireOneTime() {
  const d = db(); const now = new Date();
  const rows = await d.update(subscriptions).set({ status: "expired", updatedAt: now })
    .where(and(eq(subscriptions.source, "hub"), inArray(subscriptions.kind, ["one_time", "grant"]), eq(subscriptions.status, "active"), sql`${subscriptions.currentPeriodEnd} is not null and ${subscriptions.currentPeriodEnd} <= now()`)).returning({ id: subscriptions.id, personId: subscriptions.personId });
  for (const r of rows) await d.insert(events).values({ personId: r.personId, type: "subscription.expired", source: "hub", payload: { subscriptionId: r.id, reason: "access period ended" } });
  return rows.length;
}

/**
 * Узгоджує проходження цифрових продуктів із правами: кому належить продукт (активна Hub-підписка з оффером,
 * що містить продукт, або ручне право product:<id>) — той у ньому записаний; у кого доступ скінчився — зупиняється,
 * а якщо оффер вимагає, надіслані кроки видаляються з бота. Підписок ZenEdu не торкається.
 */
export async function syncProductAccess(personId?: number) {
  const d = db();
  const pf = personId ? sql`and s.person_id = ${personId}` : sql``;
  const pe = personId ? sql`and e.person_id = ${personId}` : sql``;
  const desiredRows = (await d.execute(sql`
    select s.person_id, (x.value)::int as product_id from subscriptions s join plans p on p.id = s.plan_id, jsonb_array_elements_text(p.products) x
      where s.source = 'hub' and s.status in ('active','trialing','past_due') and (s.kind = 'subscription' or s.current_period_end is null or s.current_period_end > now()) ${pf}
    union
    select e.person_id, substring(e.resource_key from 9)::int from entitlements e
      where e.resource_key like 'product:%' and e.revoked_at is null and (e.valid_until is null or e.valid_until > now()) ${pe}`)).rows as { person_id: number; product_id: number }[];
  const currentRows = (await d.execute(sql`
    select e.id, e.person_id, e.funnel_id as product_id from funnel_enrollments e join funnels f on f.id = e.funnel_id
      where f.kind = 'product' and e.status = 'active' ${pe}`)).rows as { id: number; person_id: number; product_id: number }[];
  const key = (p: number, f: number) => `${p}:${f}`;
  const desired = new Set(desiredRows.map((r) => key(r.person_id, r.product_id)));
  const current = new Set(currentRows.map((r) => key(r.person_id, r.product_id)));
  let opened = 0, closed = 0;
  for (const r of desiredRows) if (!current.has(key(r.person_id, r.product_id))) { if (await reactivateOrEnroll(r.product_id, r.person_id, "offer")) opened++; }
  for (const r of currentRows) if (!desired.has(key(r.person_id, r.product_id))) {
    await stopEnrollment(r.id, "access_ended"); closed++;
    const [last] = (await d.execute(sql`select p.settings from subscriptions s join plans p on p.id = s.plan_id where s.person_id = ${r.person_id} and s.source = 'hub' and p.products @> ${JSON.stringify([r.product_id])}::jsonb order by s.updated_at desc limit 1`)).rows as { settings: OfferSettings }[];
    if (last?.settings?.removeContentOnEnd) await deleteDelivered(r.id).catch(() => null);
  }
  return { opened, closed };
}

/** Оффери, які містять продукт. */
export async function offersWithProduct(productId: number) {
  return db().select().from(plans).where(sql`${plans.products} @> ${JSON.stringify([productId])}::jsonb`).orderBy(plans.sortOrder, plans.id);
}
export async function hubOffersForButtons() {
  return db().select({ id: plans.id, key: plans.key, name: plans.name, isActive: plans.isActive }).from(plans).where(eq(plans.isActive, true)).orderBy(plans.sortOrder, plans.name);
}
export { funnels, funnelEnrollments, entitlements, isNull, or, gt };

/** Telegram-HTML (b, i, u, s, code, pre, a, blockquote) → безпечний HTML для сторінки оплати; решта екранується. */
export function telegramHtmlToSafe(html: string) {
  const keep: string[] = [];
  const hold = (t: string) => { keep.push(t); return `@@K${keep.length - 1}@@`; };
  let s = html.replace(/<a\s+href="(https?:\/\/[^"\s<>]+)"\s*>/gi, (_m, h) => hold(`<a href="${h}" target="_blank" rel="noreferrer">`))
    .replace(/<(\/?)(b|strong|i|em|u|ins|s|strike|del|code|pre|blockquote|a)\s*>/gi, (_m, sl, tag) => hold(`<${sl}${String(tag).toLowerCase()}>`))
    .replace(/<span class="tg-spoiler">/gi, () => hold('<span class="spoiler">')).replace(/<\/span>/gi, () => hold("</span>"))
    .replace(/<br\s*\/?>/gi, () => hold("<br>"));
  s = s.replace(/&(?!(amp|lt|gt|quot|#\d+);)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/@@K(\d+)@@/g, (_m, i) => keep[Number(i)]);
  return s.replace(/\n/g, "<br>");
}
