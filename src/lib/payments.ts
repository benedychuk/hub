import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { createHmac } from "crypto";
import { db, schema } from "@/db";
import type { OfferSettings } from "@/db/schema";
import { appUrl, botToken, sendToPerson } from "./bot";
import { accessTick, syncEntitlementsFromSubscriptions, enforcedChannelKeys, inviteAfterPayment } from "./telegram-access";
import { createInvoice as monoInvoice, walletPayment as monoCharge, cancelInvoice as monoCancel, invoiceStatus as monoStatus, verifyWebhook as monoVerify, toPayResult as monoResult, monoConfigured, type MonoInvoice } from "./monobank";
import { creds, charge as wfpCharge, refund as wfpRefund, purchaseForm, verifyResponse, type Creds, type WfpResponse } from "./wayforpay";
import { money } from "./format";
import { adminTelegramId } from "./auth";
import { periodDaysOf, accessEndFor, offerAvailability, syncProductAccess, expireOneTime } from "./offers";
import { DEFAULT_GRACE_HOURS, accessGraceHours, subscriptionAllowsSql } from "./access-rule";
import { onboardingConfigured, ensureAccountForPerson } from "./onboarding";
import { shchyroPushChanges, SHCHYRO_BOT_URL } from "./shchyro";

const { persons, plans, subscriptions, orders, events, settings, paymentMethods, paymentAttempts, identities } = schema;
export type Attempt = typeof paymentAttempts.$inferSelect;
export type Sub = typeof subscriptions.$inferSelect;
const KYIV = "Europe/Kyiv";
const RETRY_DAYS = [1, 3, 5];

// ---------- налаштування ----------
export async function paymentSettings() {
  const rows = await db().select().from(settings).where(inArray(settings.key, ["payments.mode", "payments.migrationDays", "payments.reminderDays", "payments.trialVerifyAmount", "payments.migrationAuto", "payments.enabled", "payments.newPeople", "payments.testers", "payments.provider", "access.graceHours"]));
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { provider: (["monobank", "monobank_testers"].includes(String(m["payments.provider"])) ? m["payments.provider"] : "wayforpay") as "wayforpay" | "monobank" | "monobank_testers", mode: (m["payments.mode"] === "live" ? "live" : "test") as "test" | "live", migrationDays: Number(m["payments.migrationDays"] ?? 5), reminderDays: Number(m["payments.reminderDays"] ?? 3), verifyAmount: Number(m["payments.trialVerifyAmount"] ?? 1), migrationAuto: m["payments.migrationAuto"] === true, enabled: m["payments.enabled"] === true, newPeople: m["payments.newPeople"] === true, testers: (Array.isArray(m["payments.testers"]) ? m["payments.testers"] as number[] : []), graceHours: Number.isFinite(Number(m["access.graceHours"])) && m["access.graceHours"] != null ? Number(m["access.graceHours"]) : DEFAULT_GRACE_HOURS };
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
/** Остання Hub-підписка людини за конкретним оффером (у людини може бути кілька офферів). */
async function hubSubFor(personId: number, planId: number | null | undefined) {
  const rows = await db().select().from(subscriptions).where(and(eq(subscriptions.personId, personId), eq(subscriptions.source, "hub"), planId ? eq(subscriptions.planId, planId) : sql`true`)).orderBy(desc(subscriptions.updatedAt)).limit(1);
  return rows[0];
}

// ---------- початок оплати ----------
/** Чи є в людини чинна підписка в ZenEdu: такі учасниці платять там, щоб не було подвійних списань. */
export async function hasActiveZenSub(personId: number) {
  const [s] = await db().select({ id: subscriptions.id }).from(subscriptions).where(and(eq(subscriptions.personId, personId), eq(subscriptions.source, "zenedu"), inArray(subscriptions.status, ["active", "trialing", "past_due"]))).limit(1);
  return Boolean(s);
}
/**
 * Хто бачить оплату в боті. Обидва перемикачі вмикає лише власник (Налаштування → Оплати):
 * «Оплати увімкнено для учасниць» — усі; «Оплати для нових людей» — ті, у кого немає чинної підписки в ZenEdu.
 * Адміністратор (ADMIN_TELEGRAM_ID) і тестувальники бачать оплату завжди.
 */
export async function paymentsAllowedFor(personId: number, plan?: { settings?: OfferSettings | null } | null) {
  const st = await paymentSettings(); if (st.enabled) return true;
  const [p] = await db().select({ tg: persons.telegramUserId }).from(persons).where(eq(persons.id, personId));
  if (p && (p.tg === adminTelegramId() || st.testers.includes(p.tg))) return true;
  if (!st.newPeople) return false;
  // учасниці ZenEdu — лише на офферах, де власник увімкнув «Доступно учасницям ZenEdu» (переведення в Hub)
  return !(await hasActiveZenSub(personId)) || Boolean(plan?.settings?.allowZenMembers);
}
/**
 * Шлюз для нових оплат (Налаштування → Оплати; за замовчуванням WayForPay, змінює лише власник):
 * monobank_testers — monobank лише для адміністратора й тестувальників, решта як і раніше через WayForPay.
 * Якщо токена monobank для поточного режиму немає — WayForPay. Автосписання йдуть тим шлюзом, яким збережено картку.
 */
export async function providerFor(personId: number): Promise<"wayforpay" | "monobank"> {
  const st = await paymentSettings();
  if (st.provider === "wayforpay" || !monoConfigured(st.mode)) return "wayforpay";
  if (st.provider === "monobank") return "monobank";
  const [p] = await db().select({ tg: persons.telegramUserId }).from(persons).where(eq(persons.id, personId));
  return p && (p.tg === adminTelegramId() || st.testers.includes(p.tg)) ? "monobank" : "wayforpay";
}
/** Що сказати людині, якій оплата в боті зараз недоступна. */
export async function paymentBlockedText(personId: number) {
  return (await hasActiveZenSub(personId))
    ? "Ваша підписка оформлена в ZenEdu: оплата й продовження лишаються там, нічого робити не потрібно."
    : "Оплата в боті зараз недоступна. Напишіть нам у цей чат, і команда допоможе оформити доступ.";
}
export async function beginPayment(personId: number, planKey: string, kind: "first" | "card" | "migrate") {
  const d = db();
  const [pl] = await d.select().from(plans).where(eq(plans.key, planKey)); if (!pl || !pl.isActive) throw new Error("Тариф недоступний");
  if (!(await paymentsAllowedFor(personId, kind === "first" ? pl : null))) throw new Error("Оплати ще не увімкнені. Спробуйте пізніше.");
  const [p] = await d.select().from(persons).where(eq(persons.id, personId)); if (!p) throw new Error("Людину не знайдено");
  const s = await paymentSettings(); const c = creds(s.mode);
  const av = await offerAvailability(pl); if (!av.ok) throw new Error(av.reason);
  const hubSub = await hubSubFor(personId, pl.id);
  const [zenSub] = await d.select().from(subscriptions).where(and(eq(subscriptions.personId, personId), eq(subscriptions.source, "zenedu")));
  // сума: перший платіж = ціна оффера (або пробна); прив'язка й переїзд = перевірочна сума з поверненням
  const oneTime = pl.paymentType === "one_time";
  const trial = !oneTime && pl.trialDays > 0 && !hubSub;
  const amount = kind === "first" ? (trial ? Number(pl.trialPrice ?? 0) : Number(pl.price)) : s.verifyAmount;
  const attemptKind = kind === "first" ? "first" : kind === "migrate" ? "migrate" : "card";
  if (kind === "first" && amount <= 0) throw new Error("Безкоштовний пробний період без картки поки не підтримується");
  const [a] = await d.insert(paymentAttempts).values({ orderReference: `tmp-${Date.now()}`, personId, planId: pl.id, subscriptionId: hubSub?.id ?? null, kind: attemptKind, amount: String(amount.toFixed(2)), currency: pl.currency, mode: c.mode, raw: { zenSubId: zenSub?.id ?? null } }).returning();
  const orderReference = `hub-${a.id}-${Date.now().toString(36)}`;
  await d.update(paymentAttempts).set({ orderReference }).where(eq(paymentAttempts.id, a.id));
  const label = kind === "first" ? `${pl.name}${trial ? " · пробний період" : ""}` : kind === "migrate" ? "Прив'язка картки для переїзду в Hub (повертається)" : "Перевірка картки (повертається)";
  // monobank: лише перші оплати офферів (прив'язка й переїзд картки — через WayForPay, як і раніше)
  if (kind === "first" && (await providerFor(personId)) === "monobank") {
    try {
      const inv = await monoInvoice(c.mode, { amount, currency: pl.currency, reference: orderReference, destination: label, redirectUrl: `${appUrl()}/pay/done?ref=${orderReference}`, webHookUrl: `${appUrl()}/api/payments/monobank`,
        walletId: oneTime ? undefined : `hub-${personId}`, email: p.email ?? undefined });
      await d.update(paymentAttempts).set({ provider: "monobank", providerRef: inv.invoiceId }).where(eq(paymentAttempts.id, a.id));
      await d.insert(events).values({ personId, type: "payment.started", source: "hub", payload: { attemptId: a.id, kind: attemptKind, amount, mode: c.mode, plan: pl.key, provider: "monobank" } });
      return { attempt: { ...a, orderReference }, plan: pl, redirect: inv.pageUrl as string | undefined, form: undefined, amount };
    } catch {
      await d.update(paymentAttempts).set({ provider: "monobank", status: "error", reason: "не вдалося створити рахунок monobank", processedAt: new Date() }).where(eq(paymentAttempts.id, a.id));
      throw new Error("Не вдалося створити оплату monobank. Спробуйте за хвилину або напишіть нам");
    }
  }
  const form = purchaseForm(c, { orderReference, amount, currency: pl.currency, products: [{ name: label, price: amount }], client: { firstName: p.firstName ?? undefined, lastName: p.lastName ?? undefined, email: p.email ?? undefined, phone: p.phone ?? undefined }, returnUrl: `${appUrl()}/pay/done?ref=${orderReference}`, serviceUrl: `${appUrl()}/api/payments/wayforpay` });
  await d.insert(events).values({ personId, type: "payment.started", source: "hub", payload: { attemptId: a.id, kind: attemptKind, amount, mode: c.mode, plan: pl.key } });
  return { attempt: { ...a, orderReference }, plan: pl, form, redirect: undefined as string | undefined, amount };
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

/**
 * Вебхук monobank: перевірка підпису ECDSA, захист від застарілих повідомлень (modifiedDate), той самий шлях, що й для WayForPay.
 * Окремо: токен картки може прийти вже після успішної оплати — тоді зберігаємо картку й прив'язуємо до підписки.
 */
export async function handleMonoCallback(raw: string, sign: string | null) {
  let i: MonoInvoice; try { i = JSON.parse(raw) as MonoInvoice; } catch { return { ok: false, reason: "bad body" }; }
  const d = db();
  const [a] = await d.select().from(paymentAttempts).where(and(eq(paymentAttempts.provider, "monobank"), or(eq(paymentAttempts.providerRef, String(i.invoiceId ?? "")), eq(paymentAttempts.orderReference, String(i.reference ?? "-")))));
  if (!a) return { ok: false, reason: "unknown invoice" };
  if (!(await monoVerify(a.mode as "test" | "live", raw, sign))) { await d.insert(events).values({ personId: a.personId, type: "payment.bad_signature", source: "monobank", payload: { invoiceId: i.invoiceId } }); return { ok: false, reason: "bad signature" }; }
  await applyMono(a, i);
  return { ok: true };
}
async function applyMono(a: Attempt, i: MonoInvoice) {
  const d = db();
  const prev = (a.raw as { modifiedDate?: string } | null)?.modifiedDate;
  if (prev && i.modifiedDate && i.modifiedDate < prev) return; // вебхуки можуть прийти не по черзі: актуальний — з більшим modifiedDate
  const r = monoResult(i);
  if (a.status === "approved") {
    if (r.recToken) { // картку збережено пізніше за оплату
      const pm = await saveCard(a.personId, r);
      if (pm && a.subscriptionId) await d.update(subscriptions).set({ paymentMethodId: pm.id, updatedAt: new Date() }).where(and(eq(subscriptions.id, a.subscriptionId), isNull(subscriptions.paymentMethodId)));
    }
    if (r.transactionStatus === "Refunded") { // повернення з кабінету monobank
      await d.update(paymentAttempts).set({ status: "refunded", raw: i as unknown as Record<string, unknown>, processedAt: new Date() }).where(eq(paymentAttempts.id, a.id));
      if (a.orderId) await d.update(orders).set({ status: "refunded" }).where(eq(orders.id, a.orderId));
      await d.insert(events).values({ personId: a.personId, type: "payment.refunded", source: "monobank", payload: { attemptId: a.id, amount: a.amount, revoke: true } });
      if (a.subscriptionId) await revokeSubscription(a.subscriptionId, a.id);
    }
    return;
  }
  await applyResult(a, r, creds(a.mode as "test" | "live"));
  await d.update(paymentAttempts).set({ providerRef: i.invoiceId, raw: i as unknown as Record<string, unknown> }).where(eq(paymentAttempts.id, a.id));
}
/** Підтягнути статус оплати monobank (сторінка /pay/done, якщо вебхук ще не дійшов). */
export async function syncMonoAttempt(orderReference: string) {
  const [a] = await db().select().from(paymentAttempts).where(and(eq(paymentAttempts.orderReference, orderReference), eq(paymentAttempts.provider, "monobank")));
  if (!a?.providerRef || a.status !== "pending") return;
  const i = await monoStatus(a.mode as "test" | "live", a.providerRef).catch(() => null);
  if (i) await applyMono(a, i);
}

/** Ідемпотентно застосовує результат платежу (з callback або з відповіді Charge). */
export async function applyResult(a: Attempt, r: WfpResponse, c: Creds) {
  const d = db();
  const status = String(r.transactionStatus ?? "");
  const [fresh] = await d.select().from(paymentAttempts).where(eq(paymentAttempts.id, a.id));
  if (!fresh || fresh.status === "approved" || fresh.status === "refunded") return; // вже оброблено
  // відмову вже зараховано (напр. «Wait 3ds data» у відповіді Charge): пізній підсумок WayForPay (Expired через 10 хв) не рахуємо вдруге
  if (["declined", "expired", "error"].includes(fresh.status) && status !== "Approved") return;
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
  const [pm] = await d.insert(paymentMethods).values({ personId, provider: String((r as { provider?: string }).provider ?? "wayforpay"), recToken: token, cardPan: r.cardPan ? String(r.cardPan) : null, cardType: r.cardType ? String(r.cardType) : null, bank: r.issuerBankName ? String(r.issuerBankName) : null, lastUsedAt: new Date() })
    .onConflictDoUpdate({ target: [paymentMethods.personId, paymentMethods.recToken], set: { cardPan: r.cardPan ? String(r.cardPan) : null, isActive: true, failedAt: null, lastUsedAt: new Date() } }).returning();
  return pm;
}

async function onApproved(a: Attempt, r: WfpResponse, c: Creds) {
  const d = db();
  const [pl] = a.planId ? await d.select().from(plans).where(eq(plans.id, a.planId)) : [null];
  const [p] = await d.select().from(persons).where(eq(persons.id, a.personId));
  const pm = await saveCard(a.personId, r);
  const now = new Date();
  const hubSub = await hubSubFor(a.personId, a.planId);
  const periodDays = pl ? periodDaysOf(pl) : 30;

  if (a.kind === "first" || a.kind === "manual") {
    // новий оффер, повторна разова покупка або ручне поновлення після невдалих списань
    const oneTime = pl?.paymentType === "one_time";
    const trial = Boolean(pl && !oneTime && pl.trialDays > 0 && !hubSub && a.kind === "first");
    const extend = hubSub?.currentPeriodEnd && hubSub.currentPeriodEnd > now && (a.kind === "manual" || oneTime);
    // переведення з ZenEdu (оффер із «Доступно учасницям ZenEdu», що відкриває клуб): оплачені дні ZenEdu не губляться —
    // період Hub починається з кінця підписки ZenEdu, а команда отримує звернення скасувати ZenEdu
    const zenCarry = a.kind === "first" && pl?.settings?.allowZenMembers && (await opensClub(pl.entitlements)) ? await liveZenSub(a.personId) : null;
    const base0 = extend ? hubSub!.currentPeriodEnd! : now;
    const base = zenCarry?.currentPeriodEnd && zenCarry.currentPeriodEnd > base0 ? zenCarry.currentPeriodEnd : base0;
    const end = oneTime ? (pl ? accessEndFor(pl, base) : null) : addDays(base, trial ? pl!.trialDays : periodDays);
    const row = { planId: pl?.id ?? hubSub?.planId ?? null, kind: oneTime ? "one_time" : "subscription", accessLinkId: null, status: trial ? "trialing" : "active", price: pl ? String(pl.price) : hubSub?.price ?? a.amount, currency: a.currency, periodDays: oneTime ? (pl?.accessDays ?? 0) : periodDays, currentPeriodEnd: end, nextChargeAt: oneTime || !end ? null : chargeTime(end), nextRetryAt: null, retryCount: 0, cancelAtPeriodEnd: false, pausedAt: null, cancelledAt: null, paymentMethodId: pm?.id ?? hubSub?.paymentMethodId ?? null, lastPaymentAt: now, paymentsCount: (hubSub?.paymentsCount ?? 0) + 1, startedAt: hubSub?.startedAt ?? now, updatedAt: now };
    const [s] = hubSub ? await d.update(subscriptions).set(row).where(eq(subscriptions.id, hubSub.id)).returning() : await d.insert(subscriptions).values({ personId: a.personId, source: "hub", ...row }).returning();
    await recordOrder(a, s, pl?.name ?? "Підписка Hub", oneTime ? "one_time" : hubSub && hubSub.paymentsCount > 0 ? "subscription_renew" : "subscription_start");
    await d.update(paymentAttempts).set({ subscriptionId: s.id }).where(eq(paymentAttempts.id, a.id));
    await d.insert(events).values({ personId: a.personId, type: "payment.approved", source: "wayforpay", payload: { attemptId: a.id, kind: a.kind, amount: a.amount, plan: pl?.key, until: end } });
    // порядок повідомлень: підтвердження → одразу посилання в клуб (канал) → текст після покупки; кабінет створюється мовчки, посилання на нього дає воронка
    const channels = await enforcedChannelKeys(Object.keys(pl?.entitlements ?? {})).catch(() => [] as string[]);
    const what = channels.length ? "Нижче посилання для входу в клуб." : pl?.products?.length ? "Матеріали з'являться в цьому боті за хвилину." : "";
    await notify(a.personId, `Оплату отримано: ${money(a.amount, a.currency)}. Доступ до «${pl?.name ?? "клубу"}» ${end ? `діє до ${end.toLocaleDateString("uk-UA")}` : "безстроковий"}.${pl?.accessMode === "none" && oneTime ? "" : what ? ` ${what}` : ""}${zenCarry && end ? ` Дні, що лишались у вашій попередній підписці, ми зберегли, тож доступ діє до ${end.toLocaleDateString("uk-UA")}. Попередню підписку скасуємо самі, щоб не було подвійних списань.` : ""}`);
    if (zenCarry) await zenCarryover(a.personId, zenCarry, pl!.name, end, s.id).catch(() => null);
    if (channels.length) { await syncEntitlementsFromSubscriptions().catch(() => null); await inviteAfterPayment(a.personId, channels).catch(() => null); }
    const pp = pl?.settings?.postPurchaseText?.trim();
    if (pp) { try { await sendToPerson(a.personId, pp, { html: true }); } catch { /* бот не запущений */ } }
    await createCabinetQuietly(a.personId);
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
  await syncProductAccess(a.personId).catch(() => null);
  await accessTick().catch(() => null);
}

async function recordOrder(a: Attempt, s: Sub, name: string, type: string) {
  const d = db();
  const [o] = await d.insert(orders).values({ source: "hub", personId: a.personId, planId: a.planId ?? s.planId ?? null, offerName: name, type, price: a.amount, currency: a.currency, status: "paid", paymentSystem: "wayforpay", paidAt: new Date() }).returning();
  await d.update(paymentAttempts).set({ orderId: o.id, subscriptionId: s.id }).where(eq(paymentAttempts.id, a.id));
  return o;
}
/** Чи відкриває оффер клуб (канал або групу). */
async function opensClub(ents: Record<string, string> | null | undefined) {
  const keys = Object.keys(ents ?? {}); if (!keys.length) return false;
  const r = await db().select({ k: schema.resources.key }).from(schema.resources).where(and(inArray(schema.resources.key, keys), inArray(schema.resources.kind, ["telegram_channel", "telegram_group"])));
  return r.length > 0;
}
/** Чинна підписка ZenEdu людини (оплачений період ще не закінчився) — найпізніша. */
async function liveZenSub(personId: number) {
  const [z] = await db().select().from(subscriptions).where(and(eq(subscriptions.personId, personId), eq(subscriptions.source, "zenedu"),
    sql`${subscriptions.status} not in ('paused','refunded') and ${subscriptions.currentPeriodEnd} > now()`)).orderBy(desc(subscriptions.currentPeriodEnd)).limit(1);
  return z ?? null;
}
/** Переведення з ZenEdu: подія в історії й звернення команді скасувати підписку ZenEdu (без повернення — дні вже зараховано в Hub). */
async function zenCarryover(personId: number, zen: typeof subscriptions.$inferSelect, planName: string, hubEnd: Date | null, hubSubId: number) {
  const days = zen.currentPeriodEnd ? Math.max(0, Math.round((zen.currentPeriodEnd.getTime() - Date.now()) / 86400_000)) : 0;
  const fmt = (d: Date | null) => d ? d.toLocaleDateString("uk-UA", { timeZone: KYIV }) : "—";
  await db().insert(events).values({ personId, type: "subscription.zen_carryover", source: "hub", payload: { zenSubId: zen.id, hubSubId, days, zenEnd: zen.currentPeriodEnd, hubEnd } });
  const cancelled = zen.status === "cancelled" || zen.cancelAtPeriodEnd;
  const { createTicket } = await import("./assistant");
  await createTicket(personId, { kind: "zenedu", summary: cancelled
    ? `Переведення в Hub: оплатила «${planName}». Підписка ZenEdu вже скасована (оплачено до ${fmt(zen.currentPeriodEnd)}), ${days} дн. зараховано в Hub: доступ до ${fmt(hubEnd)}. Дій у ZenEdu не потрібно; перевірте, що ZenEdu не виключить її з каналу.`
    : `Переведення в Hub: оплатила «${planName}». Скасуйте підписку ZenEdu (оплачено до ${fmt(zen.currentPeriodEnd)}) БЕЗ повернення коштів: ${days} дн. уже зараховано в Hub, доступ до ${fmt(hubEnd)}. Людині сказано, що попередню підписку скасуємо самі.` });
}
async function notify(personId: number, text: string) { try { await sendToPerson(personId, text); } catch { /* бот не запущений */ } }
/** Після оплати кабінет платформи створюється мовчки: посилання на нього людина отримує у воронці (кнопка «Особистий кабінет») або командою /cabinet. */
async function createCabinetQuietly(personId: number) {
  if (!onboardingConfigured()) return;
  try {
    const [p] = await db().select().from(persons).where(eq(persons.id, personId)); if (!p) return;
    await ensureAccountForPerson(p, "payment");
  } catch { /* кабінет не налаштовано */ }
}

/** Самовідновлення: у кожного, хто оплатив через Hub (бойова оплата, підписка чинна), має бути кабінет платформи. Нічого не надсилає людям. */
export async function ensureHubCabinets(limit = 20) {
  if (!onboardingConfigured()) return { created: 0 };
  const grace = await accessGraceHours();
  const rows = (await db().execute(sql`
    select distinct s.person_id from subscriptions s
    where s.source = 'hub' and ${sql.raw(subscriptionAllowsSql("s", grace))}
      and exists (select 1 from payment_attempts pa where pa.subscription_id = s.id and pa.mode = 'live' and pa.status = 'approved')
      and not exists (select 1 from onboarding_accounts oa where oa.person_id = s.person_id)
    limit ${limit}`)).rows as { person_id: number }[];
  let created = 0;
  for (const r of rows) { await createCabinetQuietly(r.person_id); created++; }
  return { created };
}

// ---------- автосписання ----------
async function extendAfterCharge(s: Sub, a: Attempt, name: string, pmId: number | null) {
  const d = db(); const now = new Date();
  const base = s.currentPeriodEnd && now.getTime() - s.currentPeriodEnd.getTime() < 7 * 86400_000 ? s.currentPeriodEnd : now; // дата не зсувається, якщо повтори вклались у тиждень
  const end = addDays(base, s.periodDays || 30);
  const [ns] = await d.update(subscriptions).set({ status: "active", currentPeriodEnd: end, nextChargeAt: chargeTime(end), nextRetryAt: null, retryCount: 0, lastPaymentAt: now, paymentsCount: s.paymentsCount + 1, paymentMethodId: pmId ?? s.paymentMethodId, updatedAt: now }).where(eq(subscriptions.id, s.id)).returning();
  await recordOrder(a, ns, name, "subscription_renew");
  await d.insert(events).values({ personId: s.personId, type: "payment.approved", source: "wayforpay", payload: { attemptId: a.id, kind: "renewal", amount: a.amount, until: end } });
  // ручне списання з дашборда надсилає власне привітання (клуб / «Щиро»), тож звичайне повідомлення не дублюємо
  if (!silentRetry.has(s.id)) await notify(s.personId, `Списано ${money(a.amount, a.currency)} за підписку. Доступ продовжено до ${end.toLocaleDateString("uk-UA")}. Дякуємо, що з нами!`);
}
async function onRenewalFailed(a: Attempt, reason: string) {
  const d = db(); const now = new Date();
  const [s] = a.subscriptionId ? await d.select().from(subscriptions).where(eq(subscriptions.id, a.subscriptionId)) : [];
  if (!s) return;
  // ручний повтор з дашборда: невдача нічого не змінює в підписці й нічого не пише людині
  if (silentRetry.has(s.id)) { await d.insert(events).values({ personId: s.personId, type: "payment.manual_retry_failed", source: "hub", payload: { subscriptionId: s.id, attemptId: a.id, reason } }); return; }
  const [pl] = s.planId ? await d.select().from(plans).where(eq(plans.id, s.planId)) : [];
  const retry = s.retryCount + 1;
  const link = payLink(s.personId, pl?.key ?? "", "card");
  if (retry >= RETRY_DAYS.length || pl?.settings?.retries === false) { // оффер може вимкнути повтори: доступ закривається одразу
    await d.update(subscriptions).set({ status: "expired", retryCount: retry, nextRetryAt: null, nextChargeAt: null, updatedAt: now }).where(eq(subscriptions.id, s.id));
    if (s.paymentMethodId) await d.update(paymentMethods).set({ failedAt: now }).where(eq(paymentMethods.id, s.paymentMethodId));
    await d.insert(events).values({ personId: s.personId, type: "subscription.expired", source: "hub", payload: { subscriptionId: s.id, reason } });
    await notify(s.personId, `Не вдалося списати оплату за підписку (${reason}). Доступ до клубу закрито. Щоб повернутись, оновіть картку: ${link}`);
  } else {
    const next = chargeTime(addDays(now, RETRY_DAYS[retry - 1]));
    await d.update(subscriptions).set({ status: "past_due", retryCount: retry, nextRetryAt: next, updatedAt: now }).where(eq(subscriptions.id, s.id));
    await d.insert(events).values({ personId: s.personId, type: "payment.retry_scheduled", source: "hub", payload: { subscriptionId: s.id, retry, next, reason } });
    const st = await paymentSettings();
    await notify(s.personId, `Не вдалося списати оплату за підписку (${reason}). Спробуємо ще раз ${next.toLocaleDateString("uk-UA")}. Доступ до клубу, «Щиро» і кабінету закриється через ${st.graceHours} год після кінця оплаченого періоду, якщо оплата не пройде; після оплати все повернеться само. Перевірте баланс або оновіть картку: ${link}`);
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
  if (pm.provider === "monobank") return chargeMono(s, pm, pl ?? null, amount, st.mode);
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
  // банк вимагає 3-D Secure (код 5100 «Wait 3ds data»): при автосписанні підтверджувати нікому — це відмова, одразу й один раз
  if (String(r.reasonCode ?? "") === "5100" || /wait 3ds/i.test(String(r.reason ?? "")) || r.transactionStatus === "WaitingAuthComplete") {
    const reason = "Wait 3ds data: банк вимагає 3-D Secure (списання без 3-D Secure не дозволене мерчанту)";
    await d.update(paymentAttempts).set({ status: "declined", reason, reasonCode: String(r.reasonCode ?? "5100"), raw: r as Record<string, unknown>, processedAt: new Date() }).where(eq(paymentAttempts.id, a.id));
    await onRenewalFailed({ ...a, orderReference }, reason);
    return { ok: false, reason };
  }
  if (r.transactionStatus === "InProcessing" || r.transactionStatus === "Pending") { await d.update(paymentAttempts).set({ raw: r as Record<string, unknown> }).where(eq(paymentAttempts.id, a.id)); return { ok: false, reason: "в обробці" }; }
  // помилка запиту або формату: як невдале списання з повтором
  await d.update(paymentAttempts).set({ status: "error", reason: String(r.reason ?? "помилка запиту"), reasonCode: String(r.reasonCode ?? ""), raw: r as Record<string, unknown>, processedAt: new Date() }).where(eq(paymentAttempts.id, a.id));
  await onRenewalFailed({ ...a, orderReference }, String(r.reason ?? "помилка запиту"));
  return { ok: false, reason: String(r.reason ?? "помилка запиту") };
}

/** Тік: списує підписки, у яких настав час, і завершує скасовані. */
/** Автосписання за карткою, збереженою в monobank (оплата за токеном з ініціативи Hub). Результат — одразу або вебхуком. */
async function chargeMono(s: Sub, pm: typeof paymentMethods.$inferSelect, pl: typeof plans.$inferSelect | null, amount: number, mode: "test" | "live") {
  const d = db();
  const [a] = await d.insert(paymentAttempts).values({ orderReference: `tmp-${Date.now()}`, personId: s.personId, planId: s.planId, subscriptionId: s.id, kind: "renewal", amount: amount.toFixed(2), currency: s.currency, mode, provider: "monobank", recToken: pm.recToken, cardPan: pm.cardPan }).returning();
  const orderReference = `hub-${a.id}-${Date.now().toString(36)}`;
  await d.update(paymentAttempts).set({ orderReference }).where(eq(paymentAttempts.id, a.id));
  await d.update(subscriptions).set({ nextRetryAt: chargeTime(addDays(new Date(), 1)), updatedAt: new Date() }).where(eq(subscriptions.id, s.id)); // як і для WayForPay: паралельний тік не спише двічі
  let i: MonoInvoice;
  try { i = await monoCharge(mode, { cardToken: pm.recToken, amount, currency: s.currency, reference: orderReference, destination: pl?.name ?? "Підписка Hub", redirectUrl: `${appUrl()}/pay/done?ref=${orderReference}`, webHookUrl: `${appUrl()}/api/payments/monobank` }); }
  catch (e) {
    const reason = String(e).slice(0, 200);
    await d.update(paymentAttempts).set({ status: "error", reason, processedAt: new Date() }).where(eq(paymentAttempts.id, a.id));
    await onRenewalFailed({ ...a, orderReference }, reason);
    return { ok: false, reason };
  }
  await d.update(paymentAttempts).set({ providerRef: i.invoiceId }).where(eq(paymentAttempts.id, a.id));
  const r = monoResult(i);
  if (r.transactionStatus === "InProcessing") { await d.update(paymentAttempts).set({ raw: i as unknown as Record<string, unknown> }).where(eq(paymentAttempts.id, a.id)); return { ok: false, reason: "в обробці" }; }
  await applyMono({ ...a, orderReference, providerRef: i.invoiceId }, i);
  return { ok: r.transactionStatus === "Approved", reason: r.reason ? String(r.reason) : String(r.transactionStatus) };
}

export async function chargeDue(limit = 20) {
  const d = db(); const now = new Date();
  await expireOneTime().catch(() => null); // разові оффери й доступи за посиланням
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
  const soon = await d.select({ s: subscriptions, pm: paymentMethods, pl: plans }).from(subscriptions).leftJoin(paymentMethods, eq(paymentMethods.id, subscriptions.paymentMethodId)).leftJoin(plans, eq(plans.id, subscriptions.planId))
    .where(and(eq(subscriptions.source, "hub"), eq(subscriptions.kind, "subscription"), inArray(subscriptions.status, ["active", "trialing"]), eq(subscriptions.cancelAtPeriodEnd, false), isNull(subscriptions.pausedAt), lte(subscriptions.nextChargeAt, addDays(now, st.reminderDays))));
  for (const { s, pm, pl } of soon) {
    if (pl?.settings?.reminder === false) continue; // оффер вимкнув нагадування
    if (!s.nextChargeAt || (s.remindedFor && s.remindedFor.getTime() === s.nextChargeAt.getTime())) continue;
    await notify(s.personId, `Нагадуємо: ${s.nextChargeAt.toLocaleDateString("uk-UA")} спишемо ${money(s.price, s.currency)} за підписку${pm?.cardPan ? ` з картки ${pm.cardPan}` : ""}. Керувати підпискою: /subscriptions`);
    await d.update(subscriptions).set({ remindedFor: s.nextChargeAt }).where(eq(subscriptions.id, s.id)); reminded++;
  }
  // нагадування про закінчення доступу (разові оффери й доступи за посиланням), якщо оффер це передбачає
  const ending = await d.select({ s: subscriptions, pl: plans }).from(subscriptions).innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(and(eq(subscriptions.source, "hub"), inArray(subscriptions.kind, ["one_time", "grant"]), eq(subscriptions.status, "active"), sql`${subscriptions.currentPeriodEnd} is not null`, lte(subscriptions.currentPeriodEnd, addDays(now, 60))));
  for (const { s, pl } of ending) {
    const os = pl.settings ?? {}; const end = s.currentPeriodEnd!;
    if (!os.expiryReminder || end > addDays(now, os.expiryDays ?? 3)) continue;
    if (s.remindedFor && s.remindedFor.getTime() === end.getTime()) continue;
    const left = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86400_000));
    const text = (os.expiryText?.trim() || "Доступ до «{{offer_name}}» закінчується через {{days}} дн.").replace(/\{\{\s*days\s*\}\}/g, String(left)).replace(/\{\{\s*offer_name\s*\}\}/g, pl.name);
    const [ren] = os.renewalOfferId ? await d.select().from(plans).where(and(eq(plans.id, os.renewalOfferId), eq(plans.isActive, true))) : [];
    try { await sendToPerson(s.personId, text, { html: true, buttons: ren ? [{ text: ren.design?.buttonText || `Продовжити: ${ren.name}`, url: payLink(s.personId, ren.key, "first") }] : undefined }); } catch { /* бот не запущений */ }
    await d.update(subscriptions).set({ remindedFor: end }).where(eq(subscriptions.id, s.id)); reminded++;
  }
  // переїзд: лише якщо власник явно увімкнув автоматичні запрошення в Налаштування → Оплати
  const [defaultPlan] = st.migrationAuto ? await d.select().from(plans).where(and(eq(plans.isActive, true), eq(plans.paymentType, "subscription"))).orderBy(desc(plans.isFeatured), plans.sortOrder).limit(1) : [];
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
export async function cancelAtEnd(subId: number, by: string, opts: { silent?: boolean } = {}) {
  const d = db(); const [s] = await d.update(subscriptions).set({ cancelAtPeriodEnd: true, updatedAt: new Date() }).where(eq(subscriptions.id, subId)).returning();
  if (s) { await d.insert(events).values({ personId: s.personId, type: "subscription.cancel_scheduled", source: by, payload: { subscriptionId: subId, until: s.currentPeriodEnd } }); if (!opts.silent) await notify(s.personId, `Продовження вимкнено. Доступ діє до ${s.currentPeriodEnd?.toLocaleDateString("uk-UA")}, далі списань не буде. Передумаєте — /subscriptions.`); }
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
export async function pauseSub(subId: number, by: string, opts: { silent?: boolean } = {}) {
  const d = db(); const [s] = await d.update(subscriptions).set({ status: "paused", pausedAt: new Date(), nextChargeAt: null, nextRetryAt: null, updatedAt: new Date() }).where(eq(subscriptions.id, subId)).returning();
  if (s) { await d.insert(events).values({ personId: s.personId, type: "subscription.paused", source: by, payload: { subscriptionId: subId } }); if (!opts.silent) await notify(s.personId, "Підписку поставлено на паузу: списань і доступу до закритих матеріалів не буде, поки її не відновити (/subscriptions)."); await accessTick().catch(() => null); }
  return s;
}
/**
 * Повернення коштів через API WayForPay (без входу в кабінет WFP). revoke: скасувати дію платежу — підписка чи разовий доступ,
 * які він дав, закриваються одразу (статус refunded, без грейсу й автосписань), права на канали, продукти й «Щиро» забираються.
 */
export async function refundAttempt(attemptId: number, comment = "Повернення з Hub", revoke = true) {
  const d = db(); const [a] = await d.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptId));
  if (!a || a.status !== "approved") return { ok: false, reason: "немає успішного платежу" };
  const c = creds(a.mode as "test" | "live");
  let r: WfpResponse;
  if (a.provider === "monobank") {
    // monobank: скасування успішної оплати (повернення на картку робить банк)
    if (!a.providerRef) return { ok: false, reason: "немає номера оплати monobank", revoked: false };
    try { const m = await monoCancel(a.mode as "test" | "live", a.providerRef, `refund-${a.id}`); r = { transactionStatus: ["processing", "success"].includes(m.status) ? "Refunded" : m.status, reason: m.status, ...m }; }
    catch (e) { return { ok: false, reason: String(e).slice(0, 200), revoked: false }; }
  } else r = await wfpRefund(c, { orderReference: a.orderReference, amount: Number(a.amount), currency: a.currency, comment });
  const ok = ["Refunded", "Approved", "Voided", "RefundInProcessing"].includes(String(r.transactionStatus));
  if (ok) {
    await d.update(paymentAttempts).set({ status: "refunded", raw: r as Record<string, unknown>, processedAt: new Date() }).where(eq(paymentAttempts.id, a.id));
    if (a.orderId) await d.update(orders).set({ status: "refunded" }).where(eq(orders.id, a.orderId));
    await d.insert(events).values({ personId: a.personId, type: "payment.refunded", source: "wayforpay", payload: { attemptId: a.id, amount: a.amount, revoke } });
    if (revoke && a.subscriptionId) await revokeSubscription(a.subscriptionId, a.id);
  }
  return { ok, reason: String(r.reason ?? r.transactionStatus ?? ""), revoked: ok && revoke && Boolean(a.subscriptionId) };
}
async function revokeSubscription(subId: number, attemptId: number) {
  const d = db(); const now = new Date();
  const [s] = await d.update(subscriptions).set({ status: "refunded", currentPeriodEnd: now, nextChargeAt: null, nextRetryAt: null, cancelAtPeriodEnd: false, cancelledAt: now, updatedAt: now }).where(eq(subscriptions.id, subId)).returning();
  if (!s) return;
  await d.insert(events).values({ personId: s.personId, type: "subscription.refunded", source: "hub", payload: { subscriptionId: s.id, attemptId, plan: s.planId } });
  await accessTick().catch(() => null); // права на канали; виключення з каналу — лише якщо на ньому увімкнено автоматику доступу
  await syncProductAccess(s.personId).catch(() => null);
  await shchyroPushChanges().catch(() => null); // «Щиро»: revoke одразу, не чекаючи тіку (лише коли інтеграцію увімкнено)
}
export async function hubIdentity(personId: number) { const [i] = await db().select().from(identities).where(and(eq(identities.personId, personId), eq(identities.botKey, "hub"))); return i ?? null; }

// ---------- ручний повтор автосписань, що не пройшли через 3-D Secure («Cardholder session expired») ----------
// До виправлення 2026-11-27 запит CHARGE ішов без merchantTransactionSecureType = NON3DS, і банк чекав підтвердження власниці картки.
// Кандидати (власник, 2026-11-27: «списати з усіх, в кого була помилка і вручну вони потім не оплатили»): бойова підписка Hub
// (борг або закрита після повторів), колись автосписання відхилено з цієї причини (або 5100 «Wait 3ds data»), після першої такої
// відмови людина не оплатила (жодної успішної оплати Hub ≥ половини ціни), автопродовження не вимкнене, не на паузі,
// є збережена картка WayForPay; кожну підписку — не частіше разу на добу.
const silentRetry = new Set<number>();
export type WfpRetryCandidate = { sub_id: number; person_id: number; status: string; price: string; currency: string; failed_at: string };
export async function wfpRetryCandidates(): Promise<WfpRetryCandidate[]> {
  const r = await db().execute(sql`
    select s.id as sub_id, s.person_id, s.status, s.price::text as price, s.currency, f.first_fail as failed_at
    from subscriptions s
    join payment_methods pm on pm.id = s.payment_method_id and pm.rec_token is not null and coalesce(pm.provider, 'wayforpay') = 'wayforpay'
    join lateral (select min(coalesce(r.processed_at, r.created_at)) as first_fail from payment_attempts r
      where r.subscription_id = s.id and r.mode = 'live' and r.kind = 'renewal' and (r.reason ilike '%session expired%' or r.reason ilike '%wait 3ds%')) f on true
    where s.source = 'hub' and s.kind = 'subscription' and s.status in ('past_due','expired') and not s.cancel_at_period_end and s.paused_at is null
      and f.first_fail is not null
      and not exists (select 1 from payment_attempts ok join plans pl on pl.id = ok.plan_id where ok.person_id = s.person_id and ok.mode = 'live'
        and ok.status = 'approved' and ok.kind in ('renewal','manual','first') and ok.amount >= pl.price * 0.5 and coalesce(ok.processed_at, ok.created_at) > f.first_fail)
      and not exists (select 1 from payment_attempts p where p.subscription_id = s.id and p.status = 'pending' and p.created_at > now() - interval '1 hour')
      -- ручний повтор — не частіше разу на добу для однієї підписки
      and not exists (select 1 from events e where e.type = 'payment.manual_retry' and e.payload->>'subscriptionId' = s.id::text and e.created_at > now() - interval '1 day')
    order by f.first_fail`);
  return r.rows as WfpRetryCandidate[];
}
/** Після ручного списання: доступ і привітання. Клуб — «повноцінна учасниця клубу» з кнопкою в канал; «Щиро» — повноцінний доступ на місяць. */
async function welcomeAfterManualCharge(subId: number) {
  const d = db();
  const [s] = await d.select().from(subscriptions).where(eq(subscriptions.id, subId)); if (!s) return;
  const [pl] = s.planId ? await d.select().from(plans).where(eq(plans.id, s.planId)) : [];
  const keys = Object.keys(pl?.entitlements ?? {});
  await syncEntitlementsFromSubscriptions().catch(() => null); // право на канал і «Щиро» за продовженою підпискою
  const until = s.currentPeriodEnd ? s.currentPeriodEnd.toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv" }) : null;
  const { channelKeysOf, welcomeToChannels } = await import("./telegram-access");
  const channels = await channelKeysOf(keys);
  if (channels.length) {
    await welcomeToChannels(s.personId, channels, `{first_name}, вітаємо! Оплату отримано — тепер ви повноцінна учасниця клубу${until ? ` (доступ до ${until})` : ""}. Натисніть кнопку, щоб перейти в клуб.`, "Перейти в клуб").catch(() => null);
    return;
  }
  const [shRes] = await d.select().from(settings).where(eq(settings.key, "shchyro.resource_key"));
  const shKey = typeof shRes?.value === "string" && shRes.value ? shRes.value : "shchyro.access";
  if (keys.includes(shKey)) {
    await shchyroPushChanges().catch(() => null);
    try { await sendToPerson(s.personId, `{first_name}, вітаємо! Оплату отримано — тепер у вас повноцінний доступ до «Щиро» на місяць${until ? `, до ${until}` : ""}.`, { buttons: [{ text: "Відкрити «Щиро»", url: SHCHYRO_BOT_URL }] }); } catch { /* бот не запущений */ }
    return;
  }
  await notify(s.personId, `Оплату отримано. Доступ продовжено${until ? ` до ${until}` : ""}. Дякуємо, що з нами!`);
}
/** Одна порція ручного повтору (функція Vercel має 60 с): списує, доки не мине ~40 с. Повертає підсумок і скільки лишилось. */
export async function retryWfpFailed(budgetMs = 40_000) {
  const st = await paymentSettings();
  if (st.mode !== "live") return { ok: 0, failed: 0, left: 0, error: "Режим оплат тестовий: повтор можливий лише в бойовому режимі" };
  const t0 = Date.now(); const list = await wfpRetryCandidates();
  let ok = 0, failed = 0, done = 0; const reasons = new Map<string, number>();
  for (const c of list) {
    if (Date.now() - t0 > budgetMs) break;
    silentRetry.add(c.sub_id);
    try {
      const r = await chargeSubscription(c.sub_id);
      if (r.ok) { ok++; await welcomeAfterManualCharge(c.sub_id).catch(() => null); } else { failed++; reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1); }
    } finally { silentRetry.delete(c.sub_id); }
    done++;
    await db().insert(events).values({ personId: c.person_id, type: "payment.manual_retry", source: "hub", payload: { subscriptionId: c.sub_id } });
  }
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { ok, failed, left: list.length - done, topReason: top, error: null as string | null };
}
