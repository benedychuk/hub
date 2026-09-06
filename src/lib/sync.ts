import { desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { zen, type ZenSubscriber, type ZenOrder } from "./zenedu";

const { persons, orders, offers, funnels, subscriptions, syncRuns, bots, settings } = schema;

export type SyncStats = Record<string, number>;

async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const r = await db().select().from(settings).where(eq(settings.key, key));
  return (r[0]?.value as T) ?? null;
}
async function setSetting(key: string, value: unknown) {
  await db().insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

export async function getZenBotId(): Promise<number> {
  const v = await getSetting<number>("zenedu_bot_id");
  if (v) return Number(v);
  const list = await zen.bots();
  if (!list.length) throw new Error("У ZenEdu немає ботів");
  await setSetting("zenedu_bot_id", list[0].id);
  return list[0].id;
}

const parseDate = (s: string | null | undefined) => (s ? new Date(s) : null);
// ZenEdu віддає utm_tags і custom_fields то списком, то об'єктом, то null.
const normList = (v: unknown): Record<string, string>[] => Array.isArray(v) ? v : v && typeof v === "object" ? [v as Record<string, string>] : [];
const normObj = (v: unknown): Record<string, unknown> => Array.isArray(v) ? Object.assign({}, ...v.filter((x) => x && typeof x === "object")) : v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const splitTags = (t: string | null | undefined) => (t ?? "").split(",").map((x) => x.trim()).filter(Boolean);

function personRow(s: ZenSubscriber) {
  return {
    telegramUserId: s.user_id,
    firstName: s.first_name, lastName: s.last_name, username: s.username, phone: s.phone, email: s.email,
    tags: splitTags(s.tags), notes: s.notes, zenSubscriberId: s.id, zenIsActive: s.is_active, zenIsBlocked: s.is_blocked,
    utm: normList(s.utm_tags), customFields: normObj(s.custom_fields),
    lastActiveAt: parseDate(s.last_active_at), zenCreatedAt: parseDate(s.created_at), updatedAt: new Date(),
  };
}

/** Масовий upsert людей однією командою; повертає map telegram_user_id → person.id */
async function upsertPersons(list: ZenSubscriber[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  const uniq = new Map<number, ZenSubscriber>();
  list.forEach((s) => uniq.set(s.user_id, s));
  if (!uniq.size) return map;
  const rows = [...uniq.values()].map(personRow);
  const r = await db().insert(persons).values(rows).onConflictDoUpdate({
    target: persons.telegramUserId,
    set: {
      firstName: sql`excluded.first_name`, lastName: sql`excluded.last_name`, username: sql`excluded.username`,
      phone: sql`coalesce(excluded.phone, ${persons.phone})`, email: sql`coalesce(excluded.email, ${persons.email})`,
      tags: sql`excluded.tags`, notes: sql`excluded.notes`, zenSubscriberId: sql`excluded.zen_subscriber_id`,
      zenIsActive: sql`excluded.zen_is_active`, zenIsBlocked: sql`excluded.zen_is_blocked`, utm: sql`excluded.utm`,
      customFields: sql`excluded.custom_fields`, lastActiveAt: sql`excluded.last_active_at`, zenCreatedAt: sql`excluded.zen_created_at`, updatedAt: new Date(),
    },
  }).returning({ id: persons.id, tg: persons.telegramUserId });
  r.forEach((x) => map.set(x.tg, x.id));
  return map;
}

export async function syncOffersAndFunnels(botId: number, stats: SyncStats) {
  const off = await zen.offers(botId);
  if (off.length) {
    await db().insert(offers).values(off.map((o) => ({
      source: "zenedu", zenOfferId: o.id, name: o.name, price: String(o.price), currency: o.currency,
      isSubscription: o.is_subscription, isActive: o.is_active, link: o.link ?? null, landingLink: o.landing_link ?? null, raw: o,
    }))).onConflictDoUpdate({ target: offers.zenOfferId, set: {
      name: sql`excluded.name`, price: sql`excluded.price`, currency: sql`excluded.currency`, isSubscription: sql`excluded.is_subscription`,
      isActive: sql`excluded.is_active`, link: sql`excluded.link`, landingLink: sql`excluded.landing_link`, raw: sql`excluded.raw`,
    } });
  }
  stats.offers = off.length;
  const fn = await zen.funnels(botId);
  if (fn.length) {
    await db().insert(funnels).values(fn.map((f) => ({ source: "zenedu", zenFunnelId: f.id, name: f.name, isActive: f.is_active, subscribersCount: f.subscribers_count, stepsCount: f.steps_count })))
      .onConflictDoUpdate({ target: funnels.zenFunnelId, set: { name: sql`excluded.name`, isActive: sql`excluded.is_active`, subscribersCount: sql`excluded.subscribers_count`, stepsCount: sql`excluded.steps_count` } });
  }
  stats.funnels = fn.length;
}

/** Імпорт підписників частинами: maxPages сторінок за виклик, курсор у settings. Повертає true, коли все пройдено. */
export async function syncSubscribers(botId: number, stats: SyncStats, maxPages = 20, resume = true): Promise<boolean> {
  let n = 0, pages = 0, done = true;
  const start = resume ? Number((await getSetting<number>("sync.subscribers.page")) ?? 1) : 1;
  for await (const { rows, page, lastPage } of zen.subscribers(botId, start)) {
    await upsertPersons(rows); n += rows.length; pages++;
    if (page >= lastPage) { done = true; break; }
    if (pages >= maxPages) { done = false; await setSetting("sync.subscribers.page", page + 1); break; }
  }
  if (done) await setSetting("sync.subscribers.page", 1);
  stats.subscribers = (stats.subscribers ?? 0) + n; stats.subscribers_done = done ? 1 : 0;
  return done;
}

export async function syncOrders(botId: number, stats: SyncStats, maxPages = 20, resume = true): Promise<boolean> {
  let n = 0, pages = 0, done = true;
  const start = resume ? Number((await getSetting<number>("sync.orders.page")) ?? 1) : 1;
  const offerMap = new Map<number, number>();
  (await db().select({ id: offers.id, zen: offers.zenOfferId }).from(offers)).forEach((o) => { if (o.zen) offerMap.set(o.zen, o.id); });
  for await (const { rows, page, lastPage } of zen.orders(botId, start)) {
    const pm = await upsertPersons(rows.map((o) => o.subscriber).filter(Boolean) as ZenSubscriber[]);
    if (rows.length) {
      await db().insert(orders).values(rows.map((o: ZenOrder) => ({
        source: "zenedu", zenOrderId: o.id, personId: o.subscriber ? pm.get(o.subscriber.user_id) ?? null : null,
        offerId: offerMap.get(o.offer_id) ?? null, offerName: o.offer_name, type: o.type,
        price: String(o.price), currency: o.currency, status: o.status, paymentSystem: o.payment_system_type,
        paidAt: parseDate(o.status_changed_at), createdAt: new Date(o.created_at),
      }))).onConflictDoUpdate({ target: orders.zenOrderId, set: { status: sql`excluded.status`, paidAt: sql`excluded.paid_at`, personId: sql`coalesce(excluded.person_id, ${orders.personId})` } });
    }
    n += rows.length; pages++;
    if (page >= lastPage) { done = true; break; }
    if (pages >= maxPages) { done = false; await setSetting("sync.orders.page", page + 1); break; }
  }
  if (done) await setSetting("sync.orders.page", 1);
  stats.orders = (stats.orders ?? 0) + n; stats.orders_done = done ? 1 : 0;
  return done;
}

/**
 * Виводить підписки з платежів однією SQL-командою: останній платіж підписки кожної людини
 * + період за назвою оффера. Той самий алгоритм, що дав 177 ≈ 163 активних у ZenEdu (різниця — trial).
 * Стани cancelled/paused, виставлені вручну або вебхуком, не перезаписуються.
 */
export async function deriveSubscriptions(stats: SyncStats) {
  const d = db();
  await d.execute(sql`
    with last as (
      select distinct on (person_id) person_id, offer_id, offer_name, type, price, currency, created_at
      from orders
      where source = 'zenedu' and status = 'paid' and type in ('subscription_start','subscription_renew') and person_id is not null
      order by person_id, created_at desc
    ), cnt as (
      select person_id, count(*)::int as c from orders
      where source = 'zenedu' and status = 'paid' and type in ('subscription_start','subscription_renew') and person_id is not null
      group by person_id
    ), calc as (
      select l.*, c.c as payments,
        case
          when lower(l.offer_name) like '%рік%' or lower(l.offer_name) like '%year%' then 366
          when lower(l.offer_name) like '%3 місяці%' or lower(l.offer_name) like '%три місяці%' then 92
          when lower(l.offer_name) like '%2 тижні%' and l.type = 'subscription_start' then 14
          else 31 end as period_days
      from last l join cnt c on c.person_id = l.person_id
    )
    insert into subscriptions (person_id, offer_id, source, status, price, currency, period_days, current_period_end, last_payment_at, payments_count, started_at, updated_at)
    select person_id, offer_id, 'zenedu',
      case when now() <= created_at + (period_days || ' days')::interval + interval '3 days'
           then (case when period_days = 14 then 'trialing' else 'active' end) else 'expired' end,
      price, currency, period_days, created_at + (period_days || ' days')::interval, created_at, payments, created_at, now()
    from calc
    on conflict (person_id, source) do update set
      offer_id = excluded.offer_id,
      status = case when subscriptions.status in ('cancelled','paused') and excluded.status <> 'expired' then subscriptions.status else excluded.status end,
      price = excluded.price, currency = excluded.currency, period_days = excluded.period_days,
      current_period_end = excluded.current_period_end, last_payment_at = excluded.last_payment_at,
      payments_count = excluded.payments_count, updated_at = now()
  `);
  const r = await d.select({ status: subscriptions.status, c: sql<number>`count(*)::int` }).from(subscriptions).groupBy(subscriptions.status);
  r.forEach((x) => { stats[`subs_${x.status}`] = x.c; });
}

/**
 * Один крок повного імпорту (вкладається в межі serverless-функції).
 * Повертає { done } — клієнт викликає повторно, поки done не стане true.
 */
export async function runFullSyncStep(): Promise<{ done: boolean; phase: string; stats: SyncStats }> {
  const d = db();
  const stats: SyncStats = {};
  const phase = (await getSetting<string>("sync.phase")) ?? "start";
  const run = await d.insert(syncRuns).values({ kind: `zenedu_full:${phase}` }).returning({ id: syncRuns.id });
  try {
    const botId = await getZenBotId();
    let next = phase, done = false;
    if (phase === "start") {
      const list = await zen.bots();
      for (const b of list) {
        await d.insert(bots).values({ key: `zenedu_${b.id}`, name: b.name, username: b.username, role: "zenedu", isActive: b.is_active })
          .onConflictDoUpdate({ target: bots.key, set: { name: b.name, username: b.username, isActive: b.is_active } });
      }
      await syncOffersAndFunnels(botId, stats);
      await setSetting("sync.subscribers.page", 1); await setSetting("sync.orders.page", 1);
      next = "subscribers";
    } else if (phase === "subscribers") {
      if (await syncSubscribers(botId, stats)) next = "orders";
    } else if (phase === "orders") {
      if (await syncOrders(botId, stats)) next = "derive";
    } else {
      await deriveSubscriptions(stats);
      await setSetting("sync.last_full_at", new Date().toISOString());
      next = "start"; done = true;
    }
    await setSetting("sync.phase", next);
    await d.update(syncRuns).set({ status: "done", stats, finishedAt: new Date() }).where(eq(syncRuns.id, run[0].id));
    return { done, phase: next, stats };
  } catch (e) {
    await d.update(syncRuns).set({ status: "error", stats, error: String(e), finishedAt: new Date() }).where(eq(syncRuns.id, run[0].id));
    throw e;
  }
}

/** Швидкий інкремент: перші сторінки підписників і замовлень (нові з'являються згори). */
export async function runIncrementalSync() {
  const d = db();
  const run = await d.insert(syncRuns).values({ kind: "zenedu_incremental" }).returning({ id: syncRuns.id });
  const stats: SyncStats = {};
  try {
    const botId = await getZenBotId();
    await syncOffersAndFunnels(botId, stats);
    await syncSubscribers(botId, stats, 3, false);
    await syncOrders(botId, stats, 3, false);
    await deriveSubscriptions(stats);
    await d.update(syncRuns).set({ status: "done", stats, finishedAt: new Date() }).where(eq(syncRuns.id, run[0].id));
  } catch (e) {
    await d.update(syncRuns).set({ status: "error", stats, error: String(e), finishedAt: new Date() }).where(eq(syncRuns.id, run[0].id));
    throw e;
  }
  return stats;
}

export async function lastSyncRuns(n = 5) {
  return db().select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(n);
}

export async function resetSyncCursor() {
  await setSetting("sync.phase", "start");
}

export { inArray };
