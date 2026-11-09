import { runIncrementalSync } from "@/lib/sync";
import { hasDb } from "@/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Щогодинне оновлення з ZenEdu: нові оплати й продовження підтягуються протягом години, а не наступного ранку,
// тож доступ учасниць (кабінет, «Щиро», захист у каналі) не залежить від добового запізнення.
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) return Response.json({ ok: false }, { status: 401 });
  if (!hasDb() || !process.env.ZENEDU_API_TOKEN) return Response.json({ ok: false, reason: "not configured" });
  try { return Response.json({ ok: true, stats: await runIncrementalSync() }); }
  catch (e) { return Response.json({ ok: false, error: String(e).slice(0, 300) }, { status: 500 }); }
}
