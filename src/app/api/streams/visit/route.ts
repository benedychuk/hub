import { verifyWebAppInitData, upsertPersonFromWebApp, recordStreamVisit } from "@/lib/streams";
import { hasDb } from "@/db";

export const dynamic = "force-dynamic";

/** Mini App етеру: перевіряє підпис Telegram, записує перехід і повертає посилання на трансляцію. */
export async function POST(req: Request) {
  if (!hasDb() || !process.env.TELEGRAM_BOT_TOKEN) return Response.json({ ok: false, error: "not_configured" }, { status: 503 });
  const body = await req.json().catch(() => ({})) as { initData?: string };
  const v = verifyWebAppInitData(String(body.initData ?? ""), process.env.TELEGRAM_BOT_TOKEN);
  if (!v) return Response.json({ ok: false, error: "bad_signature" }, { status: 401 });
  const code = v.startParam.startsWith("ev_") ? v.startParam.slice(3) : "";
  if (!code) return Response.json({ ok: false, error: "no_stream" }, { status: 400 });
  const personId = await upsertPersonFromWebApp(v.user);
  const st = await recordStreamVisit(code, personId, v.user.id, "miniapp");
  if (!st) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  return Response.json({ ok: true, title: st.title, url: st.youtubeUrl, startsAt: st.startsAt });
}
