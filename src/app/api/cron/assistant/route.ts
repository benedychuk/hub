import { processAssistant } from "@/lib/assistant";
import { hasDb } from "@/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Асистентка підтримки: раз на хвилину відповідає на повідомлення в черзі. Захист: заголовок Vercel Cron або ?key=CRON_SECRET.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}` && url.searchParams.get("key") !== process.env.CRON_SECRET) return Response.json({ ok: false }, { status: 401 });
  if (!hasDb() || !process.env.TELEGRAM_BOT_TOKEN) return Response.json({ ok: false, reason: "not configured" });
  try { return Response.json({ ok: true, ...(await processAssistant(45_000)) }); }
  catch (e) { return Response.json({ ok: false, error: String(e).slice(0, 300) }, { status: 500 }); }
}
