import { eq } from "drizzle-orm";
import { authBot } from "@/lib/access";
import { db, hasDb, schema } from "@/db";

export const dynamic = "force-dynamic";

// POST /api/v1/events { telegram_user_id, type, payload }
// type "usage" фіксує використання ресурсу бота (рахується у квоті), інші типи — довільні події.
export async function POST(req: Request) {
  if (!hasDb()) return Response.json({ error: "not configured" }, { status: 503 });
  const bot = await authBot(req);
  if (!bot) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as { telegram_user_id?: number; type?: string; payload?: Record<string, unknown> } | null;
  if (!body?.telegram_user_id || !body.type) return Response.json({ error: "telegram_user_id and type are required" }, { status: 400 });
  const [p] = await db().select({ id: schema.persons.id }).from(schema.persons).where(eq(schema.persons.telegramUserId, Number(body.telegram_user_id)));
  const resource = bot.resourceKey ?? bot.key;
  const type = body.type === "usage" ? `${resource}.usage` : `${bot.key}.${body.type}`.replace(/[^a-zA-Z0-9_.:-]/g, "");
  await db().insert(schema.events).values({ personId: p?.id ?? null, type, source: bot.key, payload: { ...(body.payload ?? {}), telegram_user_id: body.telegram_user_id } });
  return Response.json({ ok: true, person_id: p?.id ?? null });
}
