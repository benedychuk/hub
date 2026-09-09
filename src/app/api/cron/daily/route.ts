import { runIncrementalSync } from "@/lib/sync";
import { reconcile } from "@/lib/telegram-access";
import { hasDb } from "@/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) return Response.json({ ok: false }, { status: 401 });
  if (!hasDb() || !process.env.ZENEDU_API_TOKEN) return Response.json({ ok: false, reason: "not configured" });
  try { const stats = await runIncrementalSync(); const rec = process.env.TELEGRAM_BOT_TOKEN ? await reconcile().catch((e) => ({ error: String(e) })) : null; return Response.json({ ok: true, stats, reconcile: rec }); }
  catch (e) { return Response.json({ ok: false, error: String(e) }, { status: 500 }); }
}
