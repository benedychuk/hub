import { currentUser } from "@/lib/auth";
import { streamDetail } from "@/lib/streams";
import { toCsv, csvResponse } from "@/lib/csv";

export const dynamic = "force-dynamic";

/** Хто перейшов на етер — CSV. */
export async function GET(req: Request) {
  const me = await currentUser(); if (!me) return new Response("Потрібен вхід", { status: 401 });
  const d = await streamDetail(Number(new URL(req.url).searchParams.get("id")));
  if (!d) return new Response("Етер не знайдено", { status: 404 });
  const rows = d.visitors.map((v) => ({ name: v.name, username: v.username ? "@" + v.username : "", telegram: v.telegramUserId, member: v.zen && v.hub ? "ZenEdu і Hub" : v.zen ? "ZenEdu" : v.hub ? "Hub" : "не учасниця", at: new Date(v.firstAt).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" }), clicks: v.clicks, via: v.via === "miniapp" ? "Mini App" : "бот" }));
  const cols = [["name", "Людина"], ["username", "Username"], ["telegram", "Telegram ID"], ["member", "Учасниця клубу"], ["at", "Перейшла"], ["clicks", "Переходів"], ["via", "Через"]].map(([key, label]) => ({ key, label }));
  return csvResponse(toCsv(rows, cols), `efir-${d.s.startsAt.toISOString().slice(0, 10)}.csv`);
}
