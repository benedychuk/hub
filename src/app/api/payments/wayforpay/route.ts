import { handleCallback } from "@/lib/payments";
import { acceptResponse, type WfpResponse } from "@/lib/wayforpay";
import { hasDb } from "@/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Service URL для WayForPay: результат кожного платежу. Приймає JSON або form-urlencoded. */
export async function POST(req: Request) {
  if (!hasDb()) return Response.json({ ok: false }, { status: 503 });
  const ct = req.headers.get("content-type") ?? "";
  let body: WfpResponse;
  try {
    if (ct.includes("application/json")) body = await req.json();
    else { const text = await req.text(); try { body = JSON.parse(text); } catch { body = Object.fromEntries(new URLSearchParams(text)) as WfpResponse; } }
  } catch { return Response.json({ ok: false, reason: "bad body" }, { status: 400 }); }
  const r = await handleCallback(body).catch((e) => ({ ok: false as const, reason: String(e).slice(0, 200) }));
  if (!r.ok || !("creds" in r) || !r.creds) return Response.json({ ok: false, reason: "reason" in r ? r.reason : "" }, { status: 200 });
  return Response.json(acceptResponse(r.creds, String(body.orderReference)));
}
export async function GET() { return Response.json({ ok: true, service: "wayforpay callback" }); }
