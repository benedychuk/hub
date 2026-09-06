import { eq } from "drizzle-orm";
import { db, schema, hasDb } from "@/db";

export const dynamic = "force-dynamic";

// Приймач вебхуків ZenEdu: order.created, order.status.changed, subscriber.added, subscription.cancelled, message.received тощо.
export async function POST(req: Request) {
  if (!hasDb()) return Response.json({ ok: false }, { status: 500 });
  const secret = process.env.ZENEDU_WEBHOOK_SECRET;
  const url = new URL(req.url);
  if (secret && url.searchParams.get("key") !== secret) return Response.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ ok: false }, { status: 400 });
  const d = db();
  const data = (body.data ?? {}) as Record<string, unknown>;
  const sub = (data.subscriber ?? data) as { user_id?: number; id?: number; first_name?: string; last_name?: string; username?: string };
  let personId: number | null = null;
  if (sub?.user_id) {
    const r = await d.insert(schema.persons).values({ telegramUserId: sub.user_id, firstName: sub.first_name ?? null, lastName: sub.last_name ?? null, username: sub.username ?? null, zenSubscriberId: sub.id ?? null })
      .onConflictDoUpdate({ target: schema.persons.telegramUserId, set: { updatedAt: new Date() } }).returning({ id: schema.persons.id });
    personId = r[0].id;
  }
  await d.insert(schema.events).values({ personId, type: `zenedu.${body.event ?? "unknown"}`, source: "zenedu", payload: body });
  if (body.event === "subscription.cancelled" && personId) {
    await d.update(schema.subscriptions).set({ status: "cancelled", cancelAtPeriodEnd: true, updatedAt: new Date() })
      .where(eq(schema.subscriptions.personId, personId));
  }
  return Response.json({ ok: true });
}
