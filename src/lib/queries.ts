import { and, count, desc, eq, gte, ilike, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { db, hasDb, schema } from "@/db";

const { persons, subscriptions, orders, plans, offers, funnels, events, identities, syncRuns, resources, broadcasts, automations, bots } = schema;

export async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  if (!hasDb()) return fallback;
  try { return await fn(); } catch (e) { console.error("query failed", e); return fallback; }
}

export const ACTIVE = ["active", "trialing", "past_due"];

export async function navCounts() {
  return safe(async () => {
    const d = db();
    const [p] = await d.select({ c: count() }).from(persons);
    const [s] = await d.select({ c: count() }).from(subscriptions).where(inArray(subscriptions.status, ACTIVE));
    const [f] = await d.select({ c: count() }).from(funnels).where(eq(funnels.isActive, true));
    const [c] = await d.select({ c: count() }).from(events).where(and(eq(events.type, "bot.message"), gte(events.createdAt, new Date(Date.now() - 7 * 86400000))));
    return { people: p.c, subs: s.c, funnels: f.c, chats: c.c };
  }, {} as Record<string, number>);
}

export async function dashboard() {
  return safe(async () => {
    const d = db();
    const since30 = new Date(Date.now() - 30 * 86400000), since60 = new Date(Date.now() - 60 * 86400000);
    const byStatus = await d.select({ status: subscriptions.status, c: count() }).from(subscriptions).groupBy(subscriptions.status);
    const rev = await d.select({ cur: orders.currency, sum: sql<string>`coalesce(sum(price),0)`, c: count() }).from(orders)
      .where(and(eq(orders.status, "paid"), gte(orders.createdAt, since30))).groupBy(orders.currency);
    const starts30 = await d.select({ c: count() }).from(orders).where(and(eq(orders.status, "paid"), eq(orders.type, "subscription_start"), gte(orders.createdAt, since30)));
    const startsPrev = await d.select({ c: count() }).from(orders).where(and(eq(orders.status, "paid"), eq(orders.type, "subscription_start"), gte(orders.createdAt, since60), lte(orders.createdAt, since30)));
    const expiring = await d.select({ day: sql<string>`to_char(current_period_end, 'YYYY-MM-DD')`, c: count() }).from(subscriptions)
      .where(and(inArray(subscriptions.status, ACTIVE), gte(subscriptions.currentPeriodEnd, new Date()), lte(subscriptions.currentPeriodEnd, new Date(Date.now() + 14 * 86400000))))
      .groupBy(sql`to_char(current_period_end, 'YYYY-MM-DD')`).orderBy(sql`1`);
    const monthly = await d.execute(sql`
      select to_char(created_at, 'YYYY-MM') as m,
        count(*) filter (where type = 'subscription_start')::int as starts,
        count(*) filter (where type = 'subscription_renew')::int as renews,
        coalesce(sum(price) filter (where currency = 'UAH' and type <> 'one_time'),0)::numeric as uah
      from orders where status = 'paid' and created_at >= now() - interval '8 months'
      group by 1 order by 1`);
    const recent = await d.select({ id: events.id, type: events.type, createdAt: events.createdAt, payload: events.payload, personId: events.personId, first: persons.firstName, last: persons.lastName, username: persons.username })
      .from(events).leftJoin(persons, eq(persons.id, events.personId)).orderBy(desc(events.createdAt)).limit(10);
    const hubStarts = await d.select({ c: count() }).from(identities).where(eq(identities.botKey, "hub"));
    return { byStatus, rev, starts30: starts30[0].c, startsPrev: startsPrev[0].c, expiring, monthly: monthly.rows as { m: string; starts: number; renews: number; uah: string }[], recent, hubStarts: hubStarts[0].c };
  }, null);
}

export type PeopleFilter = { q?: string; status?: string; page?: number; tag?: string };
export async function people(f: PeopleFilter) {
  return safe(async () => {
    const d = db();
    const per = 50, page = Math.max(1, f.page ?? 1);
    const conds = [];
    if (f.q) {
      const q = `%${f.q.trim()}%`;
      const asNum = Number(f.q.trim());
      conds.push(or(ilike(persons.firstName, q), ilike(persons.lastName, q), ilike(persons.username, q), ilike(persons.phone, q), ilike(persons.email, q),
        Number.isFinite(asNum) && asNum > 0 ? eq(persons.telegramUserId, asNum) : sql`false`));
    }
    if (f.tag) conds.push(sql`${persons.tags} @> ${JSON.stringify([f.tag])}::jsonb`);
    const subQ = d.select({ personId: subscriptions.personId, status: subscriptions.status, price: subscriptions.price, currency: subscriptions.currency, end: subscriptions.currentPeriodEnd, source: subscriptions.source })
      .from(subscriptions).where(sql`true`).as("s");
    let where = conds.length ? and(...conds) : undefined;
    if (f.status === "active") where = and(where, inArray(subQ.status, ["active", "past_due"]));
    else if (f.status === "trialing") where = and(where, eq(subQ.status, "trialing"));
    else if (f.status === "past_due") where = and(where, eq(subQ.status, "past_due"));
    else if (f.status === "expired") where = and(where, inArray(subQ.status, ["expired", "cancelled"]));
    else if (f.status === "none") where = and(where, sql`${subQ.status} is null`);
    else if (f.status === "hub") where = and(where, sql`exists (select 1 from identities i where i.person_id = ${persons.id} and i.bot_key = 'hub')`);
    const rows = await d.select({ p: persons, subStatus: subQ.status, subPrice: subQ.price, subCur: subQ.currency, subEnd: subQ.end, subSource: subQ.source })
      .from(persons).leftJoin(subQ, eq(subQ.personId, persons.id)).where(where).orderBy(desc(persons.lastActiveAt), desc(persons.id)).limit(per).offset((page - 1) * per);
    const [total] = await d.select({ c: count() }).from(persons).leftJoin(subQ, eq(subQ.personId, persons.id)).where(where);
    return { rows, total: total.c, page, per };
  }, { rows: [], total: 0, page: 1, per: 50 });
}

export async function person(id: number) {
  return safe(async () => {
    const d = db();
    const [p] = await d.select().from(persons).where(eq(persons.id, id));
    if (!p) return null;
    const subs = await d.select().from(subscriptions).where(eq(subscriptions.personId, id)).orderBy(desc(subscriptions.updatedAt));
    const ords = await d.select().from(orders).where(eq(orders.personId, id)).orderBy(desc(orders.createdAt)).limit(50);
    const ev = await d.select().from(events).where(eq(events.personId, id)).orderBy(desc(events.createdAt)).limit(50);
    const idn = await d.select().from(identities).where(eq(identities.personId, id));
    const ents = await d.select().from(schema.entitlements).where(eq(schema.entitlements.personId, id)).orderBy(desc(schema.entitlements.createdAt));
    const mem = await d.select().from(schema.memberships).where(eq(schema.memberships.personId, id));
    return { p, subs, orders: ords, events: ev, identities: idn, entitlements: ents, memberships: mem };
  }, null);
}

export async function subscriptionList(status?: string, page = 1) {
  return safe(async () => {
    const d = db();
    const per = 50;
    const where = status === "active_all" ? inArray(subscriptions.status, ACTIVE) : status && status !== "all" ? eq(subscriptions.status, status) : undefined;
    const rows = await d.select({ s: subscriptions, p: persons, offerName: offers.name }).from(subscriptions).innerJoin(persons, eq(persons.id, subscriptions.personId)).leftJoin(offers, eq(offers.id, subscriptions.offerId))
      .where(where).orderBy(sql`case when ${subscriptions.status} in ('active','trialing','past_due') then 0 else 1 end`, subscriptions.currentPeriodEnd).limit(per).offset((page - 1) * per);
    const [total] = await d.select({ c: count() }).from(subscriptions).where(where);
    const byStatus = await d.select({ status: subscriptions.status, c: count() }).from(subscriptions).groupBy(subscriptions.status);
    return { rows, total: total.c, page, per, byStatus };
  }, { rows: [], total: 0, page: 1, per: 50, byStatus: [] });
}

export async function paymentList(page = 1, type?: string) {
  return safe(async () => {
    const d = db();
    const per = 50;
    const where = type && type !== "all" ? eq(orders.type, type) : undefined;
    const rows = await d.select({ o: orders, p: persons }).from(orders).leftJoin(persons, eq(persons.id, orders.personId)).where(where).orderBy(desc(orders.createdAt)).limit(per).offset((page - 1) * per);
    const [total] = await d.select({ c: count() }).from(orders).where(where);
    const since30 = new Date(Date.now() - 30 * 86400000);
    const sum = await d.select({ cur: orders.currency, sum: sql<string>`coalesce(sum(price),0)`, c: count() }).from(orders).where(and(eq(orders.status, "paid"), gte(orders.createdAt, since30))).groupBy(orders.currency);
    return { rows, total: total.c, page, per, sum };
  }, { rows: [], total: 0, page: 1, per: 50, sum: [] });
}

export async function planList() { return safe(() => db().select().from(plans).orderBy(plans.sortOrder, plans.id), []); }
export async function planById(id: number) { return safe(async () => (await db().select().from(plans).where(eq(plans.id, id)))[0] ?? null, null); }
export async function offerList() {
  return safe(async () => {
    const d = db();
    const rows = await d.select({ o: offers, active: sql<number>`(select count(*)::int from subscriptions s where s.offer_id = ${offers.id} and s.status in ('active','trialing','past_due'))`, sales: sql<number>`(select count(*)::int from orders x where x.offer_id = ${offers.id} and x.status = 'paid')` })
      .from(offers).orderBy(desc(sql`(select count(*) from subscriptions s where s.offer_id = ${offers.id} and s.status in ('active','trialing','past_due'))`), desc(offers.createdAt));
    return rows;
  }, []);
}
export async function funnelList() { return safe(() => db().select().from(funnels).orderBy(desc(sql`${funnels.source} = 'hub'`), desc(funnels.isActive), desc(funnels.subscribersCount)), []); }
export async function funnelDetail(id: number) {
  return safe(async () => {
    const d = db();
    const [f] = await d.select().from(funnels).where(eq(funnels.id, id));
    if (!f) return null;
    const steps = await d.select().from(schema.funnelSteps).where(eq(schema.funnelSteps.funnelId, id)).orderBy(sql`position`);
    const stats = await d.select({ stepId: schema.funnelDeliveries.stepId, sent: count(), clicked: sql<number>`count(*) filter (where clicked)::int` }).from(schema.funnelDeliveries).groupBy(schema.funnelDeliveries.stepId);
    const enr = await d.select({ e: schema.funnelEnrollments, p: persons }).from(schema.funnelEnrollments).innerJoin(persons, eq(persons.id, schema.funnelEnrollments.personId)).where(eq(schema.funnelEnrollments.funnelId, id)).orderBy(desc(schema.funnelEnrollments.startedAt)).limit(50);
    const waiting = await d.select({ pos: schema.funnelEnrollments.nextPosition, c: count() }).from(schema.funnelEnrollments).where(and(eq(schema.funnelEnrollments.funnelId, id), eq(schema.funnelEnrollments.status, "active"))).groupBy(schema.funnelEnrollments.nextPosition);
    return { f, steps, stats, enr, waiting };
  }, null);
}
export async function hubFunnels() { return safe(() => db().select().from(funnels).where(and(eq(funnels.source, "hub"), eq(funnels.isActive, true))).orderBy(funnels.name), []); }
export async function resourceList() { return safe(() => db().select().from(resources).orderBy(resources.id), []); }
export async function broadcastList() { return safe(() => db().select().from(broadcasts).orderBy(desc(broadcasts.createdAt)).limit(50), []); }
export async function automationList() { return safe(() => db().select().from(automations).orderBy(automations.id), []); }
export async function botList() { return safe(() => db().select().from(bots).orderBy(bots.id), []); }
export async function syncRunList() { return safe(() => db().select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(8), []); }
export async function settingsMap() {
  return safe(async () => Object.fromEntries((await db().select().from(schema.settings)).map((s) => [s.key, s.value])), {} as Record<string, unknown>);
}

export async function chatThreads() {
  return safe(async () => {
    const d = db();
    const rows = await d.execute(sql`
      select distinct on (e.person_id) e.person_id, e.created_at, e.payload->>'text' as text, p.first_name, p.last_name, p.username
      from events e join persons p on p.id = e.person_id
      where e.type in ('bot.message','bot.reply') order by e.person_id, e.created_at desc`);
    return (rows.rows as { person_id: number; created_at: string; text: string | null; first_name: string | null; last_name: string | null; username: string | null }[])
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 100);
  }, []);
}

export async function migration() {
  return safe(async () => {
    const d = db();
    const bySource = await d.select({ source: subscriptions.source, status: subscriptions.status, c: count() }).from(subscriptions).groupBy(subscriptions.source, subscriptions.status);
    const cal = await d.select({ day: sql<string>`to_char(current_period_end, 'YYYY-MM-DD')`, c: count() }).from(subscriptions)
      .where(and(inArray(subscriptions.status, ACTIVE), isNotNull(subscriptions.currentPeriodEnd), gte(subscriptions.currentPeriodEnd, new Date(Date.now() - 86400000))))
      .groupBy(sql`to_char(current_period_end, 'YYYY-MM-DD')`).orderBy(sql`1`).limit(45);
    const prices = await d.select({ price: subscriptions.price, currency: subscriptions.currency, c: count() }).from(subscriptions).where(inArray(subscriptions.status, ACTIVE)).groupBy(subscriptions.price, subscriptions.currency).orderBy(desc(count()));
    const inHub = await d.execute(sql`select count(distinct s.person_id)::int as c from subscriptions s join identities i on i.person_id = s.person_id and i.bot_key = 'hub' where s.status in ('active','trialing','past_due')`);
    return { bySource, cal, prices, inHub: (inHub.rows[0] as { c: number })?.c ?? 0 };
  }, null);
}
