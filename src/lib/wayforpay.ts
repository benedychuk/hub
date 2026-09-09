import { createHmac } from "crypto";
import { appUrl } from "./bot";

/** Тестовий мерчант із документації WayForPay: платежі без реальних грошей. */
export const TEST_MERCHANT = { account: "test_merch_n1", secret: "flk3409refn54t54t*FNJRET", regularPassword: "" };
export type Creds = { account: string; secret: string; regularPassword: string; mode: "test" | "live" };

export function creds(mode: "test" | "live"): Creds {
  if (mode === "live" && process.env.WFP_MERCHANT && process.env.WFP_SECRET) return { account: process.env.WFP_MERCHANT, secret: process.env.WFP_SECRET, regularPassword: process.env.WFP_REGULAR_PASSWORD ?? "", mode: "live" };
  return { ...TEST_MERCHANT, mode: "test" };
}
export function liveConfigured() { return Boolean(process.env.WFP_MERCHANT && process.env.WFP_SECRET); }
export function domainName() { try { return new URL(appUrl()).host; } catch { return "hub.local"; } }

export const hmacMd5 = (secret: string, parts: (string | number)[]) => createHmac("md5", secret).update(parts.join(";"), "utf8").digest("hex");
export const money2 = (n: number | string) => Number(n).toFixed(2);

export type Product = { name: string; price: number; count?: number };
type Base = { orderReference: string; amount: number; currency: string; products: Product[]; orderDate?: number };

/** Поля форми для сторінки оплати secure.wayforpay.com/pay (Purchase). */
export function purchaseForm(c: Creds, o: Base & { client?: { firstName?: string; lastName?: string; email?: string; phone?: string }; returnUrl: string; serviceUrl: string; language?: string }) {
  const orderDate = o.orderDate ?? Math.floor(Date.now() / 1000);
  const names = o.products.map((p) => p.name), counts = o.products.map((p) => p.count ?? 1), prices = o.products.map((p) => money2(p.price));
  const amount = money2(o.amount);
  const signature = hmacMd5(c.secret, [c.account, domainName(), o.orderReference, orderDate, amount, o.currency, ...names, ...counts, ...prices]);
  const fields: Record<string, string | string[]> = {
    merchantAccount: c.account, merchantAuthType: "SimpleSignature", merchantDomainName: domainName(), merchantSignature: signature,
    orderReference: o.orderReference, orderDate: String(orderDate), amount, currency: o.currency,
    "productName[]": names, "productCount[]": counts.map(String), "productPrice[]": prices,
    returnUrl: o.returnUrl, serviceUrl: o.serviceUrl, language: o.language ?? "UA", orderTimeout: "3600",
  };
  if (o.client?.firstName) fields.clientFirstName = o.client.firstName;
  if (o.client?.lastName) fields.clientLastName = o.client.lastName;
  if (o.client?.email) fields.clientEmail = o.client.email;
  if (o.client?.phone) fields.clientPhone = o.client.phone;
  return { action: "https://secure.wayforpay.com/pay", fields };
}

/** Автосписання за токеном картки (Charge, host-to-host). */
export async function charge(c: Creds, o: Base & { recToken: string; client: { firstName?: string; lastName?: string; email?: string; phone?: string }; serviceUrl: string }) {
  const orderDate = o.orderDate ?? Math.floor(Date.now() / 1000);
  const names = o.products.map((p) => p.name), counts = o.products.map((p) => p.count ?? 1), prices = o.products.map((p) => money2(p.price));
  const amount = money2(o.amount);
  const body = {
    transactionType: "CHARGE", merchantAccount: c.account, merchantAuthType: "SimpleSignature", merchantDomainName: domainName(),
    merchantSignature: hmacMd5(c.secret, [c.account, domainName(), o.orderReference, orderDate, amount, o.currency, ...names, ...counts, ...prices]),
    apiVersion: 1, orderReference: o.orderReference, orderDate, amount: Number(amount), currency: o.currency,
    productName: names, productPrice: prices.map(Number), productCount: counts,
    recToken: o.recToken, clientFirstName: o.client.firstName ?? "Client", clientLastName: o.client.lastName ?? "Hub", clientEmail: o.client.email ?? undefined, clientPhone: o.client.phone ?? undefined,
    serviceUrl: o.serviceUrl,
  };
  return api(c, body);
}

export async function refund(c: Creds, o: { orderReference: string; amount: number; currency: string; comment: string }) {
  const amount = money2(o.amount);
  return api(c, { transactionType: "REFUND", merchantAccount: c.account, orderReference: o.orderReference, amount: Number(amount), currency: o.currency, comment: o.comment, merchantSignature: hmacMd5(c.secret, [c.account, o.orderReference, amount, o.currency]), apiVersion: 1 });
}
export async function checkStatus(c: Creds, orderReference: string) {
  return api(c, { transactionType: "CHECK_STATUS", merchantAccount: c.account, orderReference, merchantSignature: hmacMd5(c.secret, [c.account, orderReference]), apiVersion: 1 });
}

export type WfpResponse = { transactionStatus?: string; reasonCode?: number | string; reason?: string; recToken?: string; cardPan?: string; cardType?: string; issuerBankName?: string; authCode?: string; amount?: number; currency?: string; orderReference?: string; merchantSignature?: string; [k: string]: unknown };
async function api(c: Creds, body: Record<string, unknown>): Promise<WfpResponse> {
  const res = await fetch("https://api.wayforpay.com/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const text = await res.text();
  try { return JSON.parse(text) as WfpResponse; } catch { return { transactionStatus: "error", reason: `HTTP ${res.status}: ${text.slice(0, 200)}` }; }
}

/** Перевірка підпису зворотного виклику або відповіді API. */
export function verifyResponse(c: Creds, r: WfpResponse) {
  // WayForPay підписує суму так, як передав її сам (22, 22.5 або 22.00): перевіряємо всі варіанти запису
  const raw = r.amount == null ? "" : String(r.amount);
  const variants = Array.from(new Set([raw, money2(Number(r.amount ?? 0)), String(Number(r.amount ?? 0))]));
  const got = String(r.merchantSignature ?? "");
  return variants.some((amt) => hmacMd5(c.secret, [String(r.merchantAccount ?? c.account), String(r.orderReference ?? ""), amt, String(r.currency ?? ""), String(r.authCode ?? ""), String(r.cardPan ?? ""), String(r.transactionStatus ?? ""), String(r.reasonCode ?? "")]) === got);
}
/** Відповідь на зворотний виклик: WayForPay чекає підтвердження, інакше повторює виклик. */
export function acceptResponse(c: Creds, orderReference: string) {
  const time = Math.floor(Date.now() / 1000);
  return { orderReference, status: "accept", time, signature: hmacMd5(c.secret, [orderReference, "accept", time]) };
}
