import { handleMonoCallback } from "@/lib/payments";
import { hasDb } from "@/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Вебхук monobank: результат кожного платежу (рахунок і списання за токеном), а також зміни статусу збереженої картки.
 * Тіло читаємо як текст: підпис X-Sign (ECDSA) рахується саме від сирого тіла. monobank повторює запит до 3 разів, поки не отримає 200.
 */
export async function POST(req: Request) {
  if (!hasDb()) return Response.json({ ok: false }, { status: 503 });
  const raw = await req.text();
  const r = await handleMonoCallback(raw, req.headers.get("x-sign")).catch((e) => ({ ok: false, reason: String(e).slice(0, 200) }));
  // невідомий рахунок чи поганий підпис — 200, щоб monobank не повторював; подія вже записана
  return Response.json(r, { status: 200 });
}
export async function GET() { return Response.json({ ok: true, service: "monobank webhook" }); }
