import { authBot } from "@/lib/access";
import { db, hasDb, schema } from "@/db";

export const dynamic = "force-dynamic";

// POST /api/v1/identity { telegram_user_id, first_name, last_name, username, chat_id }
// Зовнішній бот повідомляє, що людина натиснула /start у ньому.
export async function POST(req: Request) {
  if (!hasDb()) return Response.json({ error: "not configured" }, { status: 503 });
  const bot = await authBot(req);
  if (!bot) return Response.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => null) as { telegram_user_id?: number; first_name?: string; last_name?: string; username?: string; chat_id?: number } | null;
  if (!b?.telegram_user_id) return Response.json({ error: "telegram_user_id is required" }, { status: 400 });
  const d = db();
  const [p] = await d.insert(schema.persons).values({ telegramUserId: Number(b.telegram_user_id), firstName: b.first_name ?? null, lastName: b.last_name ?? null, username: b.username ?? null, lastActiveAt: new Date() })
    .onConflictDoUpdate({ target: schema.persons.telegramUserId, set: { lastActiveAt: new Date(), updatedAt: new Date() } }).returning({ id: schema.persons.id });
  await d.insert(schema.identities).values({ personId: p.id, botKey: bot.key, chatId: b.chat_id ?? Number(b.telegram_user_id), lastMessageAt: new Date() })
    .onConflictDoUpdate({ target: [schema.identities.personId, schema.identities.botKey], set: { lastMessageAt: new Date(), blockedAt: null } });
  await d.insert(schema.events).values({ personId: p.id, type: `${bot.key}.start`, source: bot.key, payload: {} });
  return Response.json({ ok: true, person_id: p.id });
}
