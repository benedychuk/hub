import { and, eq, lte } from "drizzle-orm";
import { processDue } from "@/lib/funnels";
import { runBroadcast } from "@/lib/actions";
import { db, hasDb, schema } from "@/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Тік воронок: раз на хвилину. Захист: заголовок Vercel Cron або ?key=CRON_SECRET.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}` && url.searchParams.get("key") !== process.env.CRON_SECRET) return Response.json({ ok: false }, { status: 401 });
  if (!hasDb() || !process.env.TELEGRAM_BOT_TOKEN) return Response.json({ ok: false, reason: "not configured" });
  try {
    const funnels = await processDue();
    // заплановані розсилки, чий час настав
    const due = await db().select({ id: schema.broadcasts.id }).from(schema.broadcasts)
      .where(and(eq(schema.broadcasts.status, "scheduled"), lte(schema.broadcasts.scheduledAt, new Date()))).limit(3);
    for (const b of due) { await db().update(schema.broadcasts).set({ status: "sending" }).where(eq(schema.broadcasts.id, b.id)); await runBroadcast(b.id); }
    return Response.json({ ok: true, funnels, broadcasts: due.length });
  }
  catch (e) { return Response.json({ ok: false, error: String(e) }, { status: 500 }); }
}
