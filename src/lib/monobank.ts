import { createVerify } from "crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { WfpResponse } from "./wayforpay";

/**
 * Інтернет-еквайринг monobank (plata by mono), API v2410: https://api.monobank.ua/docs/acquiring.html
 * Токени — лише змінні оточення у Vercel:
 *   MONO_TOKEN       — бойовий, з бізнес-кабінету web.monobank.ua (термінал інтернет-еквайрингу → «Інтеграції»);
 *   MONO_TEST_TOKEN  — тестовий, з api.monobank.ua (гроші не списуються, будь-яка картка, що проходить перевірку Луна).
 * Режим (test/live) — той самий перемикач «Режим оплат», що й для WayForPay.
 * Автосписання: перша оплата зберігає картку (saveCardData; функцію вмикає банк за заявкою «Оплата по підписці»),
 * далі Hub списує за токеном (wallet/payment, initiationKind = merchant).
 */
const BASE = () => (process.env.MONO_API_URL ?? "https://api.monobank.ua").replace(/\/$/, "");
export type MonoMode = "test" | "live";
// тестовий режим — лише з тестовим токеном: бойовий токен ніколи не використовується, коли «Режим оплат» тестовий
export const monoToken = (mode: MonoMode) => (mode === "live" ? process.env.MONO_TOKEN : process.env.MONO_TEST_TOKEN) ?? "";
export const monoConfigured = (mode: MonoMode) => Boolean(monoToken(mode));

export const CCY: Record<string, number> = { UAH: 980, USD: 840, EUR: 978 };
export const kop = (amount: number | string) => Math.round(Number(amount) * 100);

export type MonoInvoice = {
  invoiceId: string; status: string; failureReason?: string; errCode?: string; amount?: number; ccy?: number; finalAmount?: number;
  createdDate?: string; modifiedDate?: string; reference?: string; destination?: string;
  paymentInfo?: { maskedPan?: string; approvalCode?: string; rrn?: string; tranId?: string; bank?: string; paymentSystem?: string; paymentMethod?: string; fee?: number };
  walletData?: { cardToken?: string; walletId?: string; status?: string };
  cancelList?: { status: string; amount: number; extRef?: string }[];
};

async function api<T>(mode: MonoMode, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = monoToken(mode); if (!token) throw new Error(mode === "live" ? "MONO_TOKEN не задано" : "MONO_TEST_TOKEN не задано");
  const r = await fetch(`${BASE()}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { "X-Token": token, "content-type": "application/json", "X-Cms": "Hub" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(25_000),
  });
  const text = await r.text();
  let j: unknown = null; try { j = text ? JSON.parse(text) : null; } catch { j = { errText: text.slice(0, 200) }; }
  if (!r.ok) { const e = j as { errCode?: string; errText?: string }; throw new Error(`monobank ${r.status}: ${e?.errText ?? e?.errCode ?? "помилка"}`); }
  return j as T;
}

/** Рахунок на оплату: сторінка monobank (картка, Apple Pay, Google Pay). saveCard — зберегти картку для автосписань. */
export async function createInvoice(mode: MonoMode, o: { amount: number; currency: string; reference: string; destination: string; redirectUrl: string; webHookUrl: string; walletId?: string; email?: string }) {
  const r = await api<{ invoiceId: string; pageUrl: string }>(mode, "/api/merchant/invoice/create", { body: {
    amount: kop(o.amount), ccy: CCY[o.currency] ?? 980, redirectUrl: o.redirectUrl, webHookUrl: o.webHookUrl, validity: 24 * 3600, paymentType: "debit",
    merchantPaymInfo: { reference: o.reference, destination: o.destination.slice(0, 280), ...(o.email ? { customerEmails: [o.email] } : {}) },
    ...(o.walletId ? { saveCardData: { saveCard: true, walletId: o.walletId } } : {}),
  } });
  return r;
}
/** Списання за збереженою карткою з ініціативи Hub (регулярний платіж). Результат — у відповіді або пізніше вебхуком. */
export async function walletPayment(mode: MonoMode, o: { cardToken: string; amount: number; currency: string; reference: string; destination: string; redirectUrl: string; webHookUrl: string }) {
  return api<MonoInvoice>(mode, "/api/merchant/wallet/payment", { body: {
    cardToken: o.cardToken, amount: kop(o.amount), ccy: CCY[o.currency] ?? 980, initiationKind: "merchant", redirectUrl: o.redirectUrl, webHookUrl: o.webHookUrl,
    merchantPaymInfo: { reference: o.reference, destination: o.destination.slice(0, 280) },
  } });
}
export const invoiceStatus = (mode: MonoMode, invoiceId: string) => api<MonoInvoice>(mode, `/api/merchant/invoice/status?invoiceId=${encodeURIComponent(invoiceId)}`);
/** Повернення (скасування успішної оплати), повне або часткове (amount у гривнях). */
export const cancelInvoice = (mode: MonoMode, invoiceId: string, extRef: string, amount?: number) =>
  api<{ status: string; createdDate?: string; modifiedDate?: string }>(mode, "/api/merchant/invoice/cancel", { body: { invoiceId, extRef, ...(amount ? { amount: kop(amount) } : {}) } });

// ---------- вебхуки: підпис ECDSA (X-Sign) відкритим ключем monobank ----------
async function pubkey(mode: MonoMode, fresh = false) {
  const key = `mono.pubkey:${mode}`; const d = db();
  if (!fresh) { const [r] = await d.select().from(schema.settings).where(eq(schema.settings.key, key)); if (typeof r?.value === "string") return r.value; }
  const r = await api<{ key: string }>(mode, "/api/merchant/pubkey");
  await d.insert(schema.settings).values({ key, value: r.key }).onConflictDoUpdate({ target: schema.settings.key, set: { value: r.key, updatedAt: new Date() } });
  return r.key;
}
const verifyWith = (keyB64: string, body: string, signB64: string) => {
  try { const v = createVerify("SHA256"); v.write(body); v.end(); return v.verify(Buffer.from(keyB64, "base64").toString("utf8"), Buffer.from(signB64, "base64")); } catch { return false; }
};
/** Перевіряє підпис тіла вебхука. Ключ кешується; якщо не підійшов — беремо новий (monobank міг його змінити). */
export async function verifyWebhook(mode: MonoMode, body: string, sign: string | null) {
  if (!sign) return false;
  if (verifyWith(await pubkey(mode), body, sign)) return true;
  return verifyWith(await pubkey(mode, true), body, sign);
}

/** Статус monobank → формат результату, з яким працює логіка оплат Hub (спільна з WayForPay). */
export function toPayResult(i: MonoInvoice): WfpResponse & { provider: "monobank" } {
  const map: Record<string, string> = { success: "Approved", failure: "Declined", expired: "Expired", reversed: "Refunded" };
  return {
    provider: "monobank", transactionStatus: map[i.status] ?? "InProcessing", orderReference: i.reference, reason: i.failureReason ?? i.status, reasonCode: i.errCode ?? "",
    cardPan: i.paymentInfo?.maskedPan, cardType: i.paymentInfo?.paymentSystem, issuerBankName: i.paymentInfo?.bank,
    recToken: i.walletData?.cardToken && i.walletData.status !== "deleted" ? i.walletData.cardToken : undefined,
  } as WfpResponse & { provider: "monobank" };
}
