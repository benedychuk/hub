import { currentUser } from "@/lib/auth";
import { ordersExport } from "@/lib/queries";
import { toCsv, csvResponse } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Експорт платежів у CSV за фільтрами сторінки (тип, оффер). */
export async function GET(req: Request) {
  const me = await currentUser(); if (!me) return new Response("Потрібен вхід", { status: 401 });
  const u = new URL(req.url).searchParams;
  const rows = await ordersExport(u.get("type") ?? undefined, u.get("offer") ?? undefined);
  const flat = rows.map((r) => ({ id: r.id, date: r.created_at ? new Date(String(r.created_at)).toISOString().slice(0, 16).replace("T", " ") : "", person: [r.first_name, r.last_name].filter(Boolean).join(" "), username: r.username ?? "", telegram: r.telegram_user_id ?? "", email: r.email ?? "", phone: r.phone ?? "", offer: r.offer_name ?? "", type: r.type ?? "", price: r.price, currency: r.currency, system: r.payment_system ?? "", status: r.status, source: r.source }));
  const cols = [["id", "ID"], ["date", "Дата"], ["person", "Людина"], ["username", "Username"], ["telegram", "Telegram ID"], ["email", "Email"], ["phone", "Телефон"], ["offer", "Оффер"], ["type", "Тип"], ["price", "Сума"], ["currency", "Валюта"], ["system", "Спосіб"], ["status", "Статус"], ["source", "Джерело"]].map(([key, label]) => ({ key, label }));
  return csvResponse(toCsv(flat, cols), `payments-${new Date().toISOString().slice(0, 10)}.csv`);
}
