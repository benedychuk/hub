import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { createHmac } from "crypto";
import { db, schema } from "@/db";
import { appUrl, botToken, sendToPerson } from "./bot";
import { accessTick } from "./telegram-access";
import { creds, charge as wfpCharge, refund as wfpRefund, purchaseForm, verifyResponse, type Creds, type WfpResponse } from "./wayforpay";
import { money } from "./format";

const { persons, plans, subscriptions, orders, events, settings, paymentMethods, paymentAttempts, identities } = schema;
export type Attempt = typeof paymentAttempts.$inferSelect;
export type Sub = typeof subscriptions.$inferSelect;
const KYIV = "Europe/Kyiv";
const PERIOD_DAYS: Record<string, number> = { month: 30, quarter: 90, year: 365 };
const RETRY_DAYS = [1, 3, 5];

// ---------- налаштування ----------
export async function paymentSettings() {
  const rows = await db().select().from(settings).where(inArray(settings.key, ["payments.mode", "payments.migrationDays", "payments.reminderDays", "payments.trialVerifyAmount", "payments.migrationAuto"]));
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { mode: (m["payments.mode"] === "live" ? "live" : "test") as "test" | "live", migrationDays: Number(m["payments.migrationDays"] ?? 5), reminderDays: Number(m["payments.reminderDays"] ?? 3), verifyAmount: Number(m["payments.trialVerifyAmount"] ?? 1), migrationAuto: m["payments.migrationAuto"] === true };
}
export async function setSetting(key: string, value: unknown) {
  await db().insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

// ---------- посилання на оплату ----------
function sign(payload: string) { return createHmac("sha256", process.env.SESSION_SECRET ?? botToken()).update("pay:" + payload).digest("hex").slice(0, 16); }
/** Підписане посилання на сторінку оплати для конкретної людини. kind: first (новий тариф) | card (змінити картку) | migrate (переїзд із ZenEdu). */
export function payLink(personId: number, planKey: string, kind: "first" | "card" | "migrate" = "first") {
  return `${appUrl()}/pay/${encodeURIComponent(planKey)}?u=${personId}.${sign(`${personId}:${planKey}:${kind}`)}&k=${kind}`;
}
export function parsePayToken(u: string | undefined, planKey: string, kind: string) {
  const m = (u ?? "").match(/^(\d+)\.([a-f0-9]{16})$/); if (!m) return null;
  return sign(`${m[1]}:${planKey}:${kind}`) === m[2] ? Number(m[1]) : null;
}

// ---------- час списання ----------
/** 10:00 за Києвом у день дати; якщо дата пізніше 10:00, лишаємо її час. */
export function chargeTime(d: Date) {
  const k = new Date(d.toLocaleString("en-US", { timeZone: KYIV })); const offset = k.getTime() - d.getTime();
  if (k.getHours() >= 10) return d;
  k.setHours(10, 0, 0, 0); return new Date(k.getTime() - offset);
}
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400_000);

// ---------- початок оплати ----------
export async function beginPayment(personId: number, planKey: string, kind: "first" | "card" | "migrate") {
  const d = db();
  const [pl] = await d.select().from(plans).where(eq(plans.key, planKey)); if (!pl || !pl.isActive) throw new Error("Тариф недоступний");
  const [p] = await d.select().from(persons).where(eq(persons.id, personId)); if (!p) throw new Error("Людину не знайдено");
  const s = await paymentSettings(); const c = creds(s.mode);
  const [hubSub] = await d.select().from(subscriptions).where(and(eq(subscriptions.personId, personId), eq(subscriptions.source, "hub")));
  const [zenSub] = await d.select().from(subscriptions).where(and(eq(subscriptions.personId, personId), eq(subscriptions.source, "zenedu")));
  // сума: перший платіж = ціна тарифу (або пробна); прив'язка й переїзд = перевірочна сума з поверненням
  const trial = pl.trialDays > 0 && !hubSub;
  const amount = kind === "first" ? (trial ? Number(pl.trialPrice ?? 0) : Number(pl.price)) : s.verifyAmount;
  const attemptKind = kind === "first" ? "first" : kind === "migrate" ? "migrate" : "card";
  if (kind === "first" && amount <= 0) throw new Error("Безкоштовний пробний період без картки поки не підтримується");
  const [a] = await d.insert(paymentAttempts).values({ orderReference: `tmp-${Date.now()}`, personId, planId: pl.id, subscriptionId: hubSub?.id ?? null, kind: attemptKind, amount: String(amount.toFixed(2)), currency: pl.currency, mode: c.mode, raw: { zenSubId: zenSub?.id ?? null } }).returning();
  const orderReference = `hub-${a.id}-${Date.now().toString(36)}`;
  await d.update(paymentAttempts).set({ orderReference }).where(eq(paymentAttempts.id, a.id));
  const label = kind === "first" ? `${pl.name}${trial ? " · пробний період" : ""}` : kind === "migrate" ? "Прив'язка картки для переїзду в Hub (повертається)" : "Перевірка картки (повертається)";
  const form = purchaseForm(c, { orderReference, amount, currency: pl.currency, products: [{ name: label, price: amount }], client: { firstName: p.firstName ?? undefined, lastName: p.lastName ?? undefined, email: p.email ?? undefined, phone: p.phone ?? undefined }, returnUrl: `${appUrl()}/pay/done?ref=${orderReference}`, serviceUrl: `${appUrl()}/api/payments/wayforpay` });
  await d.insert(events).values({ personId, type: "payment.started", source: "hub", payload: { attemptId: a.id, kind: attemptKind, amount, mode: c.mode, plan: pl.key } });
  return { attempt: { ...a, orderReference }, plan: pl, form, amount };
}

// ---------- зворотний виклик і застосування результату ----------
export async function handleCallback(body: WfpResponse) {
  const d = db();
  const ref = String(body.orderReference ?? "");
  const [a] = await d.select().from(paymentAttempts).where(eq(paymentAttempts.orderReference, ref));
  if (!a) return { ok: false, reason: "unknown order" };
  const c = creds(a.mode as "test" | "live");
  if (!verifyResponse(c, body)) { await d.insert(events).values({ personId: a.personId, type: "payment.bad_signature", source: "wayforpay", payload: { ref } }); return { ok: false, reason: "bad signature" }; }
  await applyResult(a, body, c);
  return { ok: true, creds: c };
}

/** Ідемпотентно застосовує результат платежу (з callback або з відповіді Charge). */
export async function applyResult(a: Attempt, r: WfpResponse, c: Creds) {
  const d = db();
  const status = String(r.transactionStatus ?? "");
  const [fresh] = await d.select().from(paymentAttempts).where(eq(paymentAttempts.id, a.id));
  if (!fresh || fresh.status === "approved" || fresh.status === "refunded") return; // вже оброблено
  const base = { reasonCode: String(r.reasonCode ?? ""), reason: r.reason ? String(r.reason) : null, cardPan: r.cardPan ? String(r.cardPan) : null, recToken: r.recToken ? String(r.recToken) : null, raw: r as Record<string, unknown>, processedAt: new Date() };
  if (status === "Approved") {
    await d.update(paymentAttempts).set({ ...base, status: "approved" }).where(eq(paymentAttempts.id, a.id));
    await onApproved({ ...fresh, ...base, status: "approved" }, r, c);
  } else if (["Declined", "Expired"].includes(status)) {
    await d.update(paymentAttempts).set({ ...base, status: status === "Expired" ? "expired" : "declined" }).where(eq(paymentAttempts.id, a.id));
    if (fresh.kind === "renewal") await onRenewalFailed(fresh, String(r.reason ?? status));
    else await d.insert(events).values({ personId: fresh.personId, type: "payment.declined", source: "wayforpay", payload: { attemptId: a.id, kind: fresh.kind, reason: r.reason, code: r.reasonCode } });
  } else if (status === "Refunded" || status === "Voided") {
    await d.update(paymentAttempts).set({ ...base, status: "refunded" }).where(eq(paymentAttempts.id, a.id));
  } else {
    await d.update(paymentAttempts).set({ raw: r as Record<string, unknown> }).where(eq(paymentAttempts.id, a.id)); // InProcessing / Pending: чекаємо наступний виклик
  }
}

async function saveCard(personId: number, r: WfpResponse) {
  const d = db();
  const token = r.recToken ? String(r.recToken) : null; if (!token) return null;
  const [pm] = await d.insert(paymentMethods).values({ personId, recToken: token, cardPan: r.cardPan ? String(r.cardPan) : null, cardType: r.cardType ? String(r.cardType) : null, bank: r.issuerBankName ? String(r.issuerBankName) : null, lastUsedAt: new Date() })
    .onConflictDoUpdate({ target: [paymentMethods.personId, paymentMethods.recToken], set: { cardPan: r.cardPan ? String(r.cardPan) : null, isActive: true, failedAt: null, lastUsedAt: new Date() } }).returning();
  return pm;
}

async function onApproved(a: Attempt, r: WfpResponse, c: Creds) {
  const d = db();
  const [pl] = a.planId ? await d.select().from(plans).where(eq(plans.id, a.planId)) : [null];
  const [p] = await d.select().from(persons).where(eq(persons.id, a.personId));
  const pm = await saveCard(a.personId, r);
  const now = new Date();
  const [hubSub] = await d.select().from(subscriptions).where(and(eq(subscriptions.personId, a.personId), eq(subscriptions.source, "hub")));
  const periodDays = PERIOD_DAYS[pl?.period ?? "month"] ?? 30;

  if (a.kind === "first" || a.kind === "manual") {
    // новий тариф або ручне поновлення після невдалих списань
    const trial = Boolean(pl && pl.trialDays > 0 && !hubSub && a.kind === "first");
    const base = hubSub?.currentPeriodEnd && hubSub.currentPeriodEnd > now && a.kind === "manual" ? hubSub.currentPeriodEnd : now;
    const end = addDays(base, trial ? pl!.trialDays : periodDays);
    const row = { planId: pl?.id ?? hubSub?.planId ?? null, status: trial ? "trialing" : "active", price: pl ? String(pl.price) : hubSub?.price ?? a.amount, currency: a.currency, periodDays, currentPeriodEnd: end, nextChargeAt: chargeTime(end), nextRetryAt: null, retryCount: 0, cancelAtPeriodEnd: false, pausedAt: null, cancelledAt: null, paymentMethodId: pm?.id ?? hubSub?.paymentMethodId ?? null, lastPaymentAt: now, paymentsCount: (hubSub?.paymentsCount ?? 0) + 1, startedAt: hubSub?.startedAt ?? now, updatedAt: now };
    const [s] = hubSub ? await d.update(subscriptions).set(row).where(eq(subscriptions.id, hubSub.id)).returning() : await d.insert(subscriptions).values({ personId: a.personId, source: "hub", ...row }).returning();
    await recordOrder(a, s, pl?.name ?? "Підписка Hub", hubSub ? "subscription_renew" : "subscription_start");
    await d.update(paymentAttempts).set({ subscriptionId: s.id }).where(eq(paymentAttempts.id, a.id));
    await d.insert(events).values({ personId: a.personId, type: "payment.approved", source: "wayforpay", payload: { attemptId: a.id, kind: a.kind, amount: a.amount, plan: pl?.key, until: end } });
    await notify(a.personId, `Оплату отримано: ${money(a.amount, a.currency)}. Доступ до «${pl?.name ?? "клубу"}» діє до ${end.toLocaleDateString("uk-UA")}. Посилання на канал прийде за хвилину.`);
  } else if (a.kind === "renewal") {
    if (hubSub) await extendAfterCharge(hubSub, a, pl?.name ?? "Підписка Hub", pm?.id ?? null);
  } else if (a.kind === "card" || a.kind === "migrate") {
    // прив'язка картки: повертаємо перевірочну суму
    if (Number(a.amount) > 0) { try { await wfpRefund(c, { orderReference: a.orderReference, amount: Number(a.amount), currency: a.currency, comment: "Перевірка картки" }); } catch { /* повернемо вручну */ } }
    if (a.kind === "migrate") {
      const zenId = Number((a.raw as { zenSubId?: number } | null)?.zenSubId ?? 0);
      const [zen] = zenId ? await d.select().from(subscriptions).where(eq(subscriptions.id, zenId)) : [];
      const end = zen?.currentPeriodEnd && zen.currentPeriodEnd > now ? zen.currentPeriodEnd : addDays(now, 1);
      const row = { planId: pl?.id ?? null, status: "active", price: zen?.price ?? String(pl?.price ?? "0"), currency: zen?.currency ?? a.currency, periodDays: zen?.periodDays ?? periodDays, currentPeriodEnd: end, nextChargeAt: chargeTime(end), nextRetryAt: null, retryCount: 0, cancelAtPeriodEnd: false, pausedAt: null, cancelledAt: null, paymentMethodId: pm?.id ?? null, paymentsCount: 0, startedAt: now, migratedFromZen: zen?.id ?? null, updatedAt: now };
      const [s] = hubSub ? await d.update(subscriptions).set(row).where(eq(subscriptions.id, hubSub.id)).returning() : await d.insert(subscriptions).values({ personId: a.personId, source: "hub", ...row }).returning();
      await d.update(paymentAttempts).set({ subscriptionId: s.id }).where(eq(paymentAttempts.id, a.id));
      await d.insert(events).values({ personId: a.personId, type: "payment.card_linked", source: "wayforpay", payload: { attemptId: a.id, migrate: true, nextChargeAt: end, price: row.price } });
      await notify(a.personId, `Картку прив'язано. Наступне списання ${money(row.price, row.currency)} буде ${end.toLocaleDateString("uk-UA")} уже в Hub, ціна не змінюється. Перевірочна сума повернеться на картку впродовж кількох днів.`);
    } else {
      if (hubSub && pm) await d.update(subscriptions).set({ paymentMethodId: pm.id, retryCount: 0, nextRetryAt: null, status: hubSub.status === "past_due" ? "past_due" : hubSub.status, updatedAt: now }).where(eq(subscriptions.id, hubSub.id));
      await d.insert(events).values({ personId: a.personId, type: "payment.card_linked", source: "wayforpay", payload: { attemptId: a.id } });
      await notify(a.personId, `Картку оновлено${pm?.cardPan ? ` (${pm.cardPan})` : ""}. Перевірочна сума повернеться на картку впродовж кількох днів.`);
      if (hubSub?.status === "past_due") await chargeSubscription(hubSub.id).catch(() => null);
    }
  }
  void p;
  await accessTick().catch(() => null);
}

async function recordOrder(a: Attempt, s: Sub, name: string, type: string) {
  const d = db();
  const [o] = await d.insert(orders).values({ source: "hub", personId: a.personId, offerName: name, type, price: a.amount, currency: a.currency, status: "paid", paymentSystem: "wayforpay", paidAt: new Date() }).returning();
  await d.update(paymentAttempts).set({ orderId: o.id, subscriptionId: s.id }).where(eq(paymentAttempts.id, a.id));
  return o;
}
async function notify(personId: number, text: string) { try { await sendToPerson(personId, text); } catch { /* бот не запущений */ } }

// ---------- автосписання ----------
async function extendAfterCharge(s: Sub, a: Attempt, name: string, pmId: number | null) {
  const d = db(); const now = new Date();
  const base = s.currentPeriodEnd && now.getTime() - s.currentPeriodEnd.getTime() < 7 * 86400_000 ? s.currentPeriodEnd : now; // дата не зсувається, якщо повтори вклались у тиждень
  const end = addDays(base, s.periodDays || 30);
  const [ns] = await d.update(subscriptions).set({ status: "active", currentPeriodEnd: end, nextChargeAt: chargeTime(end), nextRetryAt: null, retryCount: 0, lastPaymentAt: now, paymentsCount: s.paymentsCount + 1, paymentMethodId: pmId ?? s.paymentMethodId, updatedAt: now }).where(eq(subscriptions.id, s.id)).returning();
  await recordOrder(a, ns, name, "subscription_renew");
  await d.insert(events).values({ personId: s.personId, type: "payment.approved", source: "wayforpay", payload: { attemptId: a.id, kind: "renewal", amount: a.amount, until: end } });
  await notify(s.personId, `Списано ${money(a.amount, a.currency)} за підписку. Доступ продовжено до ${end.toLocaleDateString("uk-UA")}. Дякуємо, що з нами!`);
}
async function onRenewalFailed(a: Attempt, reason: string) {
  const d = db(); const now = new Date();
  const [s] = a.subscriptionId ? await d.select().from(subscriptions).where(eq(subscriptions.id, a.subscriptionId)) : [];
  if (!s) return;
  const [pl] = s.planId ? await d.select({ key: plans.key, name: plans.name }).from(plans).where(eq(plans.id, s.planId)) : [];
  const retry = s.retryCount + 1;
  const link = payLink(s.personId, pl?.key ?? "", "card");
  if (retry >= RETRY_DAYS.length) {
    await d.update(subscriptions).set({ status: "expired", retryCount: retry, nextRetryAt: null, nextChargeAt: null, updatedAt: now }).where(eq(subscriptions.id, s.id));
    if (s.paymentMethodId) await d.update(paymentMethods).set({ failedAt: now }).where(eq(paymentMethods.id, s.paymentMethodId));
    await d.insert(events).values({ personId: s.personId, type: "subscription.expired", source: "hub", payload: { subscriptionId: s.id, reason } });
    await notify(s.personId, `Не вдалося списати оплату за підписку (${reason}). Доступ до клубу закрито. Щоб повернутись, оновіть картку: ${link}`);
  } else {
    const next = chargeTime(addDays(now, RETRY_DAYS[retry - 1]));
    await d.update(subscriptions).set({ status: "past_due", retryCount: retry, nextRetryAt: next, updatedAt: now }).where(eq(subscriptions.id, s.id));
    await d.insert(events).values({ personId: s.personId, type: "payment.retry_scheduled", source: "hub", payload: { subscriptionId: s.id, retry, next, reason } });
    await notify(s.personId, `Не вдалося списати оплату за підписку (${reason}). Спробуємо ще раз ${next.toLocaleDateString("uk-UA")}. Щоб не втратити доступ, перевірте баланс або оновіть картку: ${link}`);
  }
}

/** Списання однієї підписки за збереженою карткою. */
export async function chargeSubscription(subId: number) {
  const d = db();
  const [s] = await d.select().from(subscriptions).where(eq(subscriptions.id, subId)); if (!s || s.source !== "hub") return { ok: false, reason: "не Hub-підписка" };
  const [pm] = s.paymentMethodId ? await d.select().from(paymentMethods).where(eq(paymentMethods.id, s.paymentMethodId)) : [];
  if (!pm?.recToken) return { ok: false, reason: "немає картки" };
  const [pl] = s.planId ? await d.select().from(plans).where(eq(plans.id, s.planId)) : [];
  const [p] = await d.select().from(persons).where(eq(persons.id, s.personId));
  const st = await paymentSettings(); const c = creds(st.mode);
  const amount = Number(s.price);
  const [a] = await d.insert(paymentAttempts).values({ orderReference: `tmp-${Date.now()}`, personId: s.personId, planId: s.planId, subscriptionId: s.id, kind: "renewal", amount: amount.toFixed(2), currency: s.currency, mode: c.mode, recToken: pm.recToken, cardPan: pm.cardPan }).returning();
  const orderReference = `hub-${a.id}-${Date.now().toString(36)}`;
  await d.update(paymentAttempts).set({ orderReference }).where(eq(paymentAttempts.id, a.id));
  // одразу зсуваємо спробу, щоб паралельний тік не списав двічі
  await d.update(subscriptions).set({ nextRetryAt: chargeTime(addDays(new Date(), 1)), updatedAt: new Date() }).where(eq(subscriptions.id, s.id));
  let r: WfpResponse;
  try {
    r = await wfpCharge(c, { orderReference, amount, currency: s.currency, products: [{ name: pl?.name ?? "Підписка Hub", price: amount }], recToken: pm.recToken, client: { firstName: p?.firstName ?? undefined, lastName: p?.lastName ?? undefined, email: p?.email ?? undefined, phone: p?.phone ?? undefined }, serviceUrl: `${appUrl()}/api/payments/wayforpay` });
  } catch (e) { r = { transactionStatus: "error", reason: String(e).slice(0, 200) }; }
  if (r.transactionStatus === "Approved" || r.transactionStatus === "Declined" || r.transactionStatus === "Expired") {
    if (r.merchantSignature && !verifyResponse(c, r)) { await d.update(paymentAttempts).set({ status: "error", reason: "bad signature", raw: r as Record<string, unknown> }).where(eq(paymentAttempts.id, a.id)); return { ok: false, reason: "bad signature" }; }
    await applyResult({ ...a, orderReference }, r, c);
    return { ok: r.transactionStatus === "Approved", reason: r.reason ? String(r.reason) : r.transactionStatus };
  }
  if (r.transactionStatus === "InProcessing" || r.transactionStatus === "Pending") { await d.update(paymentAttempts).set({ raw: r as Record<string, unknown> }).where(eq(paymentAttempts.id, a.id)); return { ok: false, reason: "в обробці" }; }
  // помилка запиту або формату: як невдале списання з повтором
  await d.update(paymentAttempts).set({ status: "error", reason: String(r.reason ?? "помилка запиту"), reasonCode: String(r.reasonCode ?? ""), raw: r as Record<string, unknown>, processedAt: new Date() }).where(eq(paymentAttempts.id, a.id));
  await onRenewalFailed({ ...a, orderReference }, String(r.reason ?? "помилка запиту"));
  return { ok: false, reason: String(r.reason ?? "помилка запиту") };
}

/** Тік: списує підписки, у яких настав час, і завершує скасовані. */
export async function chargeDue(limit = 20) {
  const d = db(); const now = new Date();
  // скасовані наприкінці періоду
  await d.update(subscriptions).set({ status: "cancelled", cancelledAt: now, nextChargeAt: null, updatedAt: now }).where(and(eq(subscriptions.source, "hub"), eq(subscriptions.cancelAtPeriodEnd, true), inArray(subscriptions.status, ["active", "trialing", "past_due"]), lte(subscriptions.currentPeriodEnd, now)));
  const due = await d.select().from(subscriptions).where(and(eq(subscriptions.source, "hub"), inArray(subscriptions.status, ["active", "trialing", "past_due"]), eq(subscriptions.cancelAtPeriodEnd, false), isNull(subscriptions.pausedAt), sql`${subscriptions.paymentMethodId} is not null`,
    or(and(eq(subscriptions.status, "past_due"), lte(subscriptions.nextRetryAt, now)), and(inArray(subscriptions.status, ["active", "trialing"]), lte(subscriptions.nextChargeAt, now), or(isNull(subscriptions.nextRetryAt), lte(subscriptions.nextRetryAt, now)))))).orderBy(asc(subscriptions.nextChargeAt)).limit(limit);
  let charged = 0, failed = 0;
  for (const s of due) { const r = await chargeSubscription(s.id); if (r.ok) charged++; else failed++; }
  return { due: due.length, charged, failed };
}

// ---------- нагадування й переїзд ----------
/** Щоденно: нагадати про списання за N днів; запросити активних у ZenEdu прив'язати картку в Hub. */
export async function dailyPayments() {
  const d = db(); const st = await paymentSettings(); const now = new Date();
  let reminded = 0, invited = 0;
  const soon = await d.select({ s: subscriptions, pm: paymentMethods }).from(subscriptions).leftJoin(paymentMethods, eq(paymentMethods.id, subscriptions.paymentMethodId))
    .where(and(eq(subscriptions.source, "hub"), inArray(subscriptions.status, ["active", "trialing"]), eq(subscriptions.cancelAtPeriodEnd, false), isNull(subscriptions.pausedAt), lte(subscriptions.nextChargeAt, addDays(now, st.reminderDays))));
  for (const { s, pm } of soon) {
    if (!s.nextChargeAt || (s.remindedFor && s.remindedFor.getTime() === s.nextChargeAt.getTime())) continue;
    await notify(s.personId, `Нагадуємо: ${s.nextChargeAt.toLocaleDateString("uk-UA")} спишемо ${money(s.price, s.currency)} за підписку${pm?.cardPan ? ` з картки ${pm.cardPan}` : ""}. Керувати підпискою: /subscriptions`);
    await d.update(subscriptions).set({ remindedFor: s.nextChargeAt }).where(eq(subscriptions.id, s.id)); reminded++;
  }
  // переїзд: лише якщо власник явно увімкнув автоматичні запрошення в Налаштування → Оплати
  const [defaultPlan] = st.migrationAuto ? await d.select().from(plans).where(eq(plans.isActive, true)).orderBy(desc(plans.isFeatured), plans.sortOrder).limit(1) : [];
  if (defaultPlan) {
    const rows = await d.execute(sql`select z.id, z.person_id, z.current_period_end, z.price, z.currency from subscriptions z
      join identities i on i.person_id = z.person_id and i.bot_key = 'hub' and i.blocked_at is null
      where z.source = 'zenedu' and z.status in ('active','trialing','past_due') and z.current_period_end is not null and z.current_period_end <= now() + (${st.migrationDays}::int * interval '1 day') and z.current_period_end > now()
        and not exists (select 1 from subscriptions h where h.person_id = z.person_id and h.source = 'hub')
        and not exists (select 1 from events e where e.person_id = z.person_id and e.type = 'payment.migrate_invite' and e.created_at > now() - interval '7 days') limit 100`);
    for (const z of rows.rows as { id: number; person_id: number; current_period_end: string; price: string; currency: string }[]) {
      const link = payLink(z.person_id, defaultPlan.key, "migrate");
      await notify(z.person_id, `Клуб переїжджає на власну платформу. Щоб доступ не перервався, прив'яжіть картку за хвилину: ${link}\n\nЦіна ${money(z.price, z.currency)} і дата списання ${new Date(z.current_period_end).toLocaleDateString("uk-UA")} лишаються без змін. Перевірочна сума ${st.verifyAmount} грн повертається.`);
      await d.insert(events).values({ personId: z.person_id, type: "payment.migrate_invite", source: "hub", payload: { zenSubId: z.id, periodEnd: z.current_period_end } }); invited++;
    }
  }
  return { reminded, invited };
}

// ---------- керування підпискою ----------
export async function cancelAtEnd(subId: number, by: string) {
  const d = db(); const [s] = await d.update(subscriptions).set({ cancelAtPeriodEnd: true, updatedAt: new Date() }).where(eq(subscriptions.id, subId)).returning();
  if (s) { await d.insert(events).values({ personId: s.personId, type: "subscription.cancel_scheduled", source: by, payload: { subscriptionId: subId, until: s.currentPeriodEnd } }); await notify(s.personId, `Продовження вимкнено. Доступ діє до ${s.currentPeriodEnd?.toLocaleDateString("uk-UA")}, далі списань не буде. Передумаєте — /subscriptions.`); }
  return s;
}
export async function resumeSub(subId: number, by: string) {
  const d = db(); const now = new Date();
  const [cur] = await d.select().from(subscriptions).where(eq(subscriptions.id, subId)); if (!cur) return null;
  const active = cur.currentPeriodEnd && cur.currentPeriodEnd > now;
  const [s] = await d.update(subscriptions).set({ cancelAtPeriodEnd: false, pausedAt: null, status: active ? (cur.status === "paused" || cur.status === "cancelled" ? "active" : cur.status) : "past_due", nextChargeAt: cur.currentPeriodEnd ? chargeTime(active ? cur.currentPeriodEnd : now) : chargeTime(now), nextRetryAt: active ? null : now, retryCount: 0, updatedAt: now }).where(eq(subscriptions.id, subId)).returning();
  await d.insert(events).values({ personId: s.personId, type: "subscription.resumed", source: by, payload: { subscriptionId: subId } });
  await notify(s.personId, active ? `Підписку відновлено. Наступне списання ${s.nextChargeAt?.toLocaleDateString("uk-UA")}.` : "Підписку відновлено: зараз спробуємо списати оплату за новий період.");
  if (!active) await chargeSubscription(subId).catch(() => null);
  await accessTick().catch(() => null);
  return s;
}
export async function pauseSub(subId: number, by: string) {
  const d = db(); const [s] = await d.update(subscriptions).set({ status: "paused", pausedAt: new Date(), nextChargeAt: null, nextRetryAt: null, updatedAt: new Date() }).where(eq(subscriptions.id, subId)).returning();
  if (s) { await d.insert(events).values({ personId: s.personId, type: "subscription.paused", source: by, payload: { subscriptionId: subId } }); await notify(s.personId, "Підписку поставлено на паузу: списань і доступу до закритих матеріалів не буде, поки її не відновити (/subscriptions)."); await accessTick().catch(() => null); }
  return s;
}
export async function refundAttempt(attemptId: number, comment = "Повернення з Hub") {
  const d = db(); const [a] = await d.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptId));
  if (!a || a.status !== "approved") return { ok: false, reason: "немає успішного платежу" };
  const c = creds(a.mode as "test" | "live");
  const r = await wfpRefund(c, { orderReference: a.orderReference, amount: Number(a.amount), currency: a.currency, comment });
  const ok = ["Refunded", "Approved", "Voided", "RefundInProcessing"].includes(String(r.transactionStatus));
  if (ok) {
    await d.update(paymentAttempts).set({ status: "refunded", raw: r as Record<string, unknown>, processedAt: new Date() }).where(eq(paymentAttempts.id, a.id));
    if (a.orderId) await d.update(orders).set({ status: "refunded" }).where(eq(orders.id, a.orderId));
    await d.insert(events).values({ personId: a.personId, type: "payment.refunded", source: "wayforpay", payload: { attemptId: a.id, amount: a.amount } });
  }
  return { ok, reason: String(r.reason ?? r.transactionStatus ?? "") };
}
export async function hubIdentity(personId: number) { const [i] = await db().select().from(identities).where(and(eq(identities.personId, personId), eq(identities.botKey, "hub"))); return i ?? null; }
