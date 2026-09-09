import { processDue, processDeletions } from "@/lib/funnels";
import { accessTick } from "@/lib/telegram-access";
import { processBroadcasts } from "@/lib/broadcasts";
import { chargeDue } from "@/lib/payments";
import { hasDb } from "@/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Тік воронок: раз на хвилину. Захист: заголовок Vercel Cron або ?key=CRON_SECRET.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}` && url.searchParams.get("key") !== process.env.CRON_SECRET) return Response.json({ ok: false }, { status: 401 });
  if (!hasDb() || !process.env.TELEGRAM_BOT_TOKEN) return Response.json({ ok: false, reason: "not configured" });
  const t0 = Date.now();
  try {
    const funnels = await processDue();
    const deletions = await processDeletions().catch((e) => ({ error: String(e).slice(0, 200) }));
    const access = await accessTick().catch((e) => ({ error: String(e).slice(0, 200) }));
    const payments = await chargeDue().catch((e) => ({ error: String(e).slice(0, 200) }));
    // розсилки: заплановані, черга надсилання, видалення у підписників; у межах бюджету, щоб тіки не накладались
    const broadcasts = await processBroadcasts(Math.max(5_000, 50_000 - (Date.now() - t0))).catch((e) => ({ error: String(e).slice(0, 200) }));
    return Response.json({ ok: true, funnels, deletions, access, payments, broadcasts });
  }
  catch (e) { return Response.json({ ok: false, error: String(e) }, { status: 500 }); }
}
