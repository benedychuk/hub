import { currentUser } from "@/lib/auth";
import { peopleExport } from "@/lib/queries";
import { toCsv, csvResponse } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Експорт людей у CSV за поточними фільтрами списку (лише для користувачів Hub). */
export async function GET(req: Request) {
  const me = await currentUser(); if (!me) return new Response("Потрібен вхід", { status: 401 });
  const u = new URL(req.url).searchParams;
  const rows = await peopleExport({ q: u.get("q") ?? undefined, status: u.get("status") ?? undefined, tag: u.get("tag") ?? undefined, offer: u.get("offer") ?? undefined, product: Number(u.get("product") ?? 0) || undefined, sort: u.get("sort") ?? undefined });
  const flat = rows.map((r) => ({ id: r.p.id, name: [r.p.firstName, r.p.lastName].filter(Boolean).join(" "), username: r.p.username ?? "", telegram: r.p.telegramUserId, phone: r.p.phone ?? "", email: r.p.email ?? "", status: r.subStatus ?? "none", offer: r.offerName, price: r.subPrice ?? "", currency: r.subCur ?? "", until: r.subEnd ? new Date(r.subEnd).toISOString().slice(0, 10) : "", source: r.subSource ?? "", paid: r.paid, paidSum: r.paidSum, tags: (r.p.tags ?? []).join(", "), hubStarted: r.hubStarted ? new Date(r.hubStarted).toISOString().slice(0, 10) : "", lastActive: r.p.lastActiveAt ? new Date(r.p.lastActiveAt).toISOString().slice(0, 10) : "" }));
  const cols = [["id", "ID"], ["name", "Імʼя"], ["username", "Username"], ["telegram", "Telegram ID"], ["phone", "Телефон"], ["email", "Email"], ["status", "Статус підписки"], ["offer", "Оффер"], ["price", "Ціна"], ["currency", "Валюта"], ["until", "Доступ до"], ["source", "Джерело"], ["paid", "Оплат"], ["paidSum", "Сума оплат"], ["tags", "Теги"], ["hubStarted", "Запустила Hub-бот"], ["lastActive", "Остання активність"]].map(([key, label]) => ({ key, label }));
  return csvResponse(toCsv(flat, cols), `people-${new Date().toISOString().slice(0, 10)}.csv`);
}
