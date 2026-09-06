import { processDue } from "@/lib/funnels";
import { hasDb } from "@/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Тік воронок: раз на хвилину. Захист: заголовок Vercel Cron або ?key=CRON_SECRET.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}` && url.searchParams.get("key") !== process.env.CRON_SECRET) return Response.json({ ok: false }, { status: 401 });
  if (!hasDb() || !process.env.TELEGRAM_BOT_TOKEN) return Response.json({ ok: false, reason: "not configured" });
  try { return Response.json({ ok: true, ...(await processDue()) }); }
  catch (e) { return Response.json({ ok: false, error: String(e) }, { status: 500 }); }
}
