import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db, hasDb, schema } from "@/db";
import { adminTelegramId } from "./auth";
import { offerScope, scopeSql } from "./offers";

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
    const [f] = await d.select({ c: count() }).from(funnels).where(and(eq(funnels.isActive, true), eq(funnels.kind, "funnel")));
    const [pr] = await d.select({ c: count() }).from(funnels).where(eq(funnels.kind, "product"));
    const [c] = await d.select({ c: count() }).from(events).where(and(eq(events.type, "bot.message"), gte(events.createdAt, new Date(Date.now() - 7 * 86400000))));
    return { people: p.c, subs: s.c, funnels: f.c, products: pr.c, chats: c.c };
  }, {} as Record<string, number>);
}

export async function dashboard(offer?: string) {
  return safe(async () => {
    const d = db();
    const since30 = new Date(Date.now() - 30 * 86400000), since60 = new Date(Date.now() - 60 * 86400000);
    // фільтр за оффером: підписки (s) і замовлення (o) звужуються до оффера Hub із привʼязаними офферами ZenEdu або до одного оффера ZenEdu
    const sc = await offerScope(offer);
    const sW = sc ? scopeSql(sc, "s") : sql`true`; const oW = sc ? scopeSql(sc, "o") : sql`true`;
    const byStatus = (await d.execute(sql`select s.status, count(*)::int as c from subscriptions s where ${sW} group by 1`)).rows as { status: string; c: number }[];
    const rev = (await d.execute(sql`select o.currency as cur, coalesce(sum(o.price),0)::text as sum, count(*)::int as c from orders o where o.status = 'paid' and o.created_at >= ${since30} and ${oW} group by 1`)).rows as { cur: string; sum: string; c: number }[];
    const starts30 = (await d.execute(sql`select count(*)::int as c from orders o where o.status = 'paid' and o.type = 'subscription_start' and o.created_at >= ${since30} and ${oW}`)).rows as { c: number }[];
    const startsPrev = (await d.execute(sql`select count(*)::int as c from orders o where o.status = 'paid' and o.type = 'subscription_start' and o.created_at >= ${since60} and o.created_at <= ${since30} and ${oW}`)).rows as { c: number }[];
    const expiring = (await d.execute(sql`select to_char(s.current_period_end, 'YYYY-MM-DD') as day, count(*)::int as c from subscriptions s where s.status in ('active','trialing','past_due') and s.current_period_end >= now() and s.current_period_end <= now() + interval '14 days' and ${sW} group by 1 order by 1`)).rows as { day: string; c: number }[];
    const monthly = await d.execute(sql`
      select to_char(o.created_at, 'YYYY-MM') as m,
        count(*) filter (where o.type = 'subscription_start')::int as starts,
        count(*) filter (where o.type = 'subscription_renew')::int as renews,
        coalesce(sum(o.price) filter (where o.currency = 'UAH' and o.type <> 'one_time'),0)::numeric as uah
      from orders o where o.status = 'paid' and o.created_at >= now() - interval '8 months' and ${oW}
      group by 1 order by 1`);
    const recent = await d.select({ id: events.id, type: events.type, createdAt: events.createdAt, payload: events.payload, personId: events.personId, first: persons.firstName, last: persons.lastName, username: persons.username })
      .from(events).leftJoin(persons, eq(persons.id, events.personId)).orderBy(desc(events.createdAt)).limit(10);
    const hubStarts = await d.select({ c: count() }).from(identities).where(eq(identities.botKey, "hub"));
    return { byStatus, rev, starts30: starts30[0].c, startsPrev: startsPrev[0].c, expiring, monthly: monthly.rows as { m: string; starts: number; renews: number; uah: string }[], recent, hubStarts: hubStarts[0].c };
  }, null);
}

export type PeopleFilter = { q?: string; status?: string; page?: number; tag?: string; offer?: string; product?: number; sort?: string; all?: boolean };
/** Умови списку людей: пошук, статус підписки, тег, оффер (Hub або ZenEdu), доступ до продукту. Підписка людини — одна «головна»: активна, інакше остання. */
async function peopleWhere(f: PeopleFilter) {
  const conds = [];
  if (f.q) {
    const q = `%${f.q.trim()}%`;
    const asNum = Number(f.q.trim());
    conds.push(or(ilike(persons.firstName, q), ilike(persons.lastName, q), ilike(persons.username, q), ilike(persons.phone, q), ilike(persons.email, q),
      Number.isFinite(asNum) && asNum > 0 ? eq(persons.telegramUserId, asNum) : sql`false`));
  }
  if (f.tag) conds.push(sql`${persons.tags} @> ${JSON.stringify([f.tag])}::jsonb`);
  const sc = await offerScope(f.offer);
  if (sc) conds.push(sql`exists (select 1 from subscriptions s where s.person_id = ${persons.id} and s.status in ('active','trialing','past_due') and ${scopeSql(sc, "s")})`);
  if (f.product) conds.push(sql`exists (select 1 from funnel_enrollments e where e.person_id = ${persons.id} and e.funnel_id = ${f.product} and e.status = 'active')`);
  if (f.status === "active") conds.push(sql`exists (select 1 from subscriptions s where s.person_id = ${persons.id} and s.status in ('active','past_due'))`);
  else if (f.status === "trialing") conds.push(sql`exists (select 1 from subscriptions s where s.person_id = ${persons.id} and s.status = 'trialing')`);
  else if (f.status === "past_due") conds.push(sql`exists (select 1 from subscriptions s where s.person_id = ${persons.id} and s.status = 'past_due')`);
  else if (f.status === "expired") conds.push(sql`exists (select 1 from subscriptions s where s.person_id = ${persons.id} and s.status in ('expired','cancelled')) and not exists (select 1 from subscriptions s where s.person_id = ${persons.id} and s.status in ('active','trialing','past_due'))`);
  else if (f.status === "none") conds.push(sql`not exists (select 1 from subscriptions s where s.person_id = ${persons.id})`);
  else if (f.status === "hub") conds.push(sql`exists (select 1 from identities i where i.person_id = ${persons.id} and i.bot_key = 'hub')`);
  return conds.length ? and(...conds) : undefined;
}
const mainSub = () => db().select({ personId: subscriptions.personId, status: subscriptions.status, price: subscriptions.price, currency: subscriptions.currency, end: subscriptions.currentPeriodEnd, source: subscriptions.source, planId: subscriptions.planId, offerId: subscriptions.offerId })
  .from(subscriptions).where(sql`${subscriptions.id} = (select x.id from subscriptions x where x.person_id = ${subscriptions.personId} order by (x.status in ('active','trialing','past_due')) desc, x.updated_at desc limit 1)`).as("s");
const peopleOrder = (sort?: string) => sort === "joined" ? [desc(sql`(select min(i.started_at) from identities i where i.person_id = ${persons.id} and i.bot_key = 'hub')`), desc(persons.id)]
  : sort === "payments" ? [desc(sql`(select count(*) from orders o where o.person_id = ${persons.id} and o.status = 'paid')`), desc(persons.id)]
  : sort === "name" ? [asc(persons.firstName), asc(persons.lastName)] : [desc(persons.lastActiveAt), desc(persons.id)];
export async function people(f: PeopleFilter) {
  return safe(async () => {
    const d = db();
    const per = 50, page = Math.max(1, f.page ?? 1);
    const where = await peopleWhere(f); const subQ = mainSub();
    const rows = await d.select({ p: persons, subStatus: subQ.status, subPrice: subQ.price, subCur: subQ.currency, subEnd: subQ.end, subSource: subQ.source, hubStarted: sql<Date | null>`(select min(i.started_at) from identities i where i.person_id = ${persons.id} and i.bot_key = 'hub')`, paid: sql<number>`(select count(*)::int from orders o where o.person_id = ${persons.id} and o.status = 'paid')` })
      .from(persons).leftJoin(subQ, eq(subQ.personId, persons.id)).where(where).orderBy(...peopleOrder(f.sort)).limit(per).offset((page - 1) * per);
    const [total] = await d.select({ c: count() }).from(persons).where(where);
    return { rows, total: total.c, page, per };
  }, { rows: [], total: 0, page: 1, per: 50 });
}
/** Експорт людей за тими самими фільтрами (до 5000 рядків). */
export async function peopleExport(f: PeopleFilter) {
  const d = db(); const where = await peopleWhere(f); const subQ = mainSub();
  const rows = await d.select({ p: persons, subStatus: subQ.status, subPrice: subQ.price, subCur: subQ.currency, subEnd: subQ.end, subSource: subQ.source, planId: subQ.planId, offerId: subQ.offerId, hubStarted: sql<Date | null>`(select min(i.started_at) from identities i where i.person_id = ${persons.id} and i.bot_key = 'hub')`, paid: sql<number>`(select count(*)::int from orders o where o.person_id = ${persons.id} and o.status = 'paid')`, paidSum: sql<string>`(select coalesce(sum(o.price),0) from orders o where o.person_id = ${persons.id} and o.status = 'paid')` })
    .from(persons).leftJoin(subQ, eq(subQ.personId, persons.id)).where(where).orderBy(...peopleOrder(f.sort)).limit(5000);
  const [pls, zs] = await Promise.all([d.select({ id: plans.id, name: plans.name }).from(plans), d.select({ id: offers.id, name: offers.name }).from(offers)]);
  return rows.map((r) => ({ ...r, offerName: r.planId ? pls.find((x) => x.id === r.planId)?.name ?? "" : r.offerId ? zs.find((x) => x.id === r.offerId)?.name ?? "" : "" }));
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
    // воронки й продукти людини: скільки кроків отримала з активних
    const fun = (await d.execute(sql`select e.id, e.funnel_id, f.name, f.kind, e.status, e.next_at, e.started_at, e.finished_at, e.stop_reason,
        (select count(*)::int from funnel_steps s where s.funnel_id = f.id and s.is_active) as total,
        (select count(distinct step_id)::int from funnel_deliveries d where d.enrollment_id = e.id) as received
      from funnel_enrollments e join funnels f on f.id = e.funnel_id where e.person_id = ${id} order by e.started_at desc`)).rows as { id: number; funnel_id: number; name: string; kind: string; status: string; next_at: string | null; started_at: string; finished_at: string | null; stop_reason: string | null; total: number; received: number }[];
    // назви обʼєктів, на які посилаються події (воронки, оффери, розсилки, кроки)
    const pl = (k: string) => ev.map((e) => Number((e.payload as Record<string, unknown> | null)?.[k] ?? 0)).filter((x) => x > 0);
    const fids = [...new Set([...pl("funnelId"), ...fun.map((x) => x.funnel_id), ...ents.map((x) => Number((x.resourceKey.match(/^product:(\d+)$/) ?? [])[1] ?? 0)).filter(Boolean)])];
    const [fn, pn, bn, sn] = await Promise.all([
      fids.length ? d.select({ id: funnels.id, name: funnels.name, kind: funnels.kind }).from(funnels).where(inArray(funnels.id, fids)) : [],
      pl("planId").length ? d.select({ id: plans.id, name: plans.name }).from(plans).where(inArray(plans.id, [...new Set(pl("planId"))])) : [],
      pl("broadcastId").length ? d.select({ id: broadcasts.id, name: broadcasts.name }).from(broadcasts).where(inArray(broadcasts.id, [...new Set(pl("broadcastId"))])) : [],
      pl("stepId").length ? d.select({ id: schema.funnelSteps.id, title: schema.funnelSteps.title }).from(schema.funnelSteps).where(inArray(schema.funnelSteps.id, [...new Set(pl("stepId"))])) : [],
    ]);
    const names = { funnels: Object.fromEntries(fn.map((x) => [x.id, { name: x.name, kind: x.kind }])), plans: Object.fromEntries(pn.map((x) => [x.id, x.name])), broadcasts: Object.fromEntries(bn.map((x) => [x.id, x.name])), steps: Object.fromEntries(sn.map((x) => [x.id, x.title ?? ""])) };
    return { p, subs, orders: ords, events: ev, identities: idn, entitlements: ents, memberships: mem, funnels: fun, names };
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

/** Умова списку замовлень: тип (перші, продовження, разові, пробний → оплата, пробний без продовження) і оффер. */
async function ordersWhere(type?: string, offer?: string) {
  const parts = [];
  const sc = await offerScope(offer);
  if (sc) parts.push(scopeSql(sc, "o"));
  if (type === "trial_to_paid") parts.push(sql`o.type = 'subscription_renew' and (select count(*) from orders y where y.person_id = o.person_id and coalesce(y.offer_id, -coalesce(y.plan_id, 0)) = coalesce(o.offer_id, -coalesce(o.plan_id, 0)) and y.status = 'paid' and y.created_at < o.created_at) = 1 and (select y.price from orders y where y.person_id = o.person_id and coalesce(y.offer_id, -coalesce(y.plan_id, 0)) = coalesce(o.offer_id, -coalesce(o.plan_id, 0)) and y.status = 'paid' and y.created_at < o.created_at order by y.created_at limit 1) < o.price`);
  else if (type === "trial_churn") parts.push(sql`o.type = 'subscription_start' and o.created_at < now() - interval '40 days' and o.price < coalesce((select z.price from offers z where z.id = o.offer_id), (select pl.price from plans pl where pl.id = o.plan_id), o.price + 1) and not exists (select 1 from orders y where y.person_id = o.person_id and coalesce(y.offer_id, -coalesce(y.plan_id, 0)) = coalesce(o.offer_id, -coalesce(o.plan_id, 0)) and y.status = 'paid' and y.created_at > o.created_at)`);
  else if (type && type !== "all") parts.push(sql`o.type = ${type}`);
  return parts.length ? sql.join(parts, sql` and `) : sql`true`;
}
export async function paymentList(page = 1, type?: string, offer?: string) {
  return safe(async () => {
    const d = db();
    const per = 50;
    const where = await ordersWhere(type, offer);
    const rows = (await d.execute(sql`select o.id, o.created_at, o.type, o.price, o.currency, o.payment_system, o.status, o.offer_name, o.source, o.plan_id, p.id as pid, p.first_name, p.last_name, p.username, p.telegram_user_id
      from orders o left join persons p on p.id = o.person_id where ${where} order by o.created_at desc limit ${per} offset ${(page - 1) * per}`)).rows as { id: number; created_at: string; type: string | null; price: string; currency: string; payment_system: string | null; status: string; offer_name: string | null; source: string; plan_id: number | null; pid: number | null; first_name: string | null; last_name: string | null; username: string | null; telegram_user_id: number | null }[];
    const [total] = (await d.execute(sql`select count(*)::int as c, coalesce(sum(o.price) filter (where o.status = 'paid'), 0) as s from orders o where ${where}`)).rows as { c: number; s: string }[];
    const since30 = new Date(Date.now() - 30 * 86400000);
    const sum = await d.select({ cur: orders.currency, sum: sql<string>`coalesce(sum(price),0)`, c: count() }).from(orders).where(and(eq(orders.status, "paid"), gte(orders.createdAt, since30))).groupBy(orders.currency);
    return { rows, total: total.c, filteredSum: total.s, page, per, sum };
  }, { rows: [], total: 0, filteredSum: "0", page: 1, per: 50, sum: [] });
}
export async function ordersExport(type?: string, offer?: string) {
  const where = await ordersWhere(type, offer);
  return (await db().execute(sql`select o.id, o.created_at, o.paid_at, o.type, o.price, o.currency, o.payment_system, o.status, o.offer_name, o.source, p.id as pid, p.first_name, p.last_name, p.username, p.telegram_user_id, p.email, p.phone
    from orders o left join persons p on p.id = o.person_id where ${where} order by o.created_at desc limit 20000`)).rows as Record<string, unknown>[];
}
/** Пробні періоди за оффером: скільки почали, скільки продовжили, скільки не продовжили (за замовленнями ZenEdu і Hub). */
export async function trialStats(offer?: string) {
  return safe(async () => {
    const started = (await db().execute(sql`select count(*)::int as c from orders o where ${await ordersWhere("all", offer)} and o.status = 'paid' and o.type = 'subscription_start' and o.price < coalesce((select z.price from offers z where z.id = o.offer_id), (select pl.price from plans pl where pl.id = o.plan_id), o.price + 1)`)).rows[0] as { c: number };
    const conv = (await db().execute(sql`select count(*)::int as c from orders o where ${await ordersWhere("trial_to_paid", offer)}`)).rows[0] as { c: number };
    const churn = (await db().execute(sql`select count(*)::int as c from orders o where ${await ordersWhere("trial_churn", offer)}`)).rows[0] as { c: number };
    return { started: started.c, converted: conv.c, churned: churn.c };
  }, { started: 0, converted: 0, churned: 0 });
}

export async function planList() { return safe(() => db().select().from(plans).orderBy(plans.sortOrder, plans.id), []); }
export async function planById(id: number) { return safe(async () => (await db().select().from(plans).where(eq(plans.id, id)))[0] ?? null, null); }
export async function offerList() {
  return safe(async () => {
    const d = db();
    const rows = await d.select({ o: offers, active: sql<number>`(select count(*)::int from subscriptions s where s.offer_id = offers.id and s.status in ('active','trialing','past_due'))`, sales: sql<number>`(select count(*)::int from orders x where x.offer_id = offers.id and x.status = 'paid')` })
      .from(offers).orderBy(desc(sql`(select count(*) from subscriptions s where s.offer_id = offers.id and s.status in ('active','trialing','past_due'))`), desc(offers.createdAt));
    return rows;
  }, []);
}
export async function funnelFolders(kind: "funnel" | "product" = "funnel") {
  return safe(() => db().select({ id: schema.funnelFolders.id, name: schema.funnelFolders.name, n: sql<number>`(select count(*)::int from funnels f where f.folder_id = funnel_folders.id)` }).from(schema.funnelFolders).where(eq(schema.funnelFolders.kind, kind)).orderBy(schema.funnelFolders.sortOrder, schema.funnelFolders.name), []);
}
export async function funnelList(kind: "funnel" | "product" = "funnel") {
  return safe(() => db().select({
    id: funnels.id, source: funnels.source, folderId: funnels.folderId, name: funnels.name, cover: funnels.cover, status: funnels.status, isActive: funnels.isActive,
    subscribersCount: funnels.subscribersCount, stepsCount: funnels.stepsCount, createdAt: funnels.createdAt, updatedAt: funnels.updatedAt, settings: funnels.settings,
    activeNow: sql<number>`(select count(*)::int from funnel_enrollments e where e.funnel_id = funnels.id and e.status = 'active')`,
    offersCount: sql<number>`(select count(*)::int from plans p where p.products @> to_jsonb(array[funnels.id]))`,
  }).from(funnels).where(eq(funnels.kind, kind)).orderBy(desc(funnels.updatedAt)), []);
}
export async function funnelDetail(id: number) {
  return safe(async () => {
    const d = db();
    const [f] = await d.select().from(funnels).where(eq(funnels.id, id));
    if (!f) return null;
    const [steps, modules, commands, stats, enr, waiting, totals] = await Promise.all([
      d.select().from(schema.funnelSteps).where(eq(schema.funnelSteps.funnelId, id)).orderBy(asc(schema.funnelSteps.position), asc(schema.funnelSteps.id)),
      d.select().from(schema.funnelModules).where(eq(schema.funnelModules.funnelId, id)).orderBy(asc(schema.funnelModules.position), asc(schema.funnelModules.id)),
      d.select().from(schema.funnelCommands).where(eq(schema.funnelCommands.funnelId, id)).orderBy(asc(schema.funnelCommands.position), asc(schema.funnelCommands.id)),
      d.select({ stepId: schema.funnelDeliveries.stepId, sent: count(), people: sql<number>`count(distinct person_id)::int`, clicked: sql<number>`count(*) filter (where clicked)::int`, answered: sql<number>`count(*) filter (where answer is not null)::int` })
        .from(schema.funnelDeliveries).innerJoin(schema.funnelSteps, eq(schema.funnelSteps.id, schema.funnelDeliveries.stepId)).where(eq(schema.funnelSteps.funnelId, id)).groupBy(schema.funnelDeliveries.stepId),
      d.select({ e: schema.funnelEnrollments, p: persons }).from(schema.funnelEnrollments).innerJoin(persons, eq(persons.id, schema.funnelEnrollments.personId)).where(eq(schema.funnelEnrollments.funnelId, id)).orderBy(desc(schema.funnelEnrollments.startedAt)).limit(100),
      d.select({ pos: schema.funnelEnrollments.nextPosition, c: count() }).from(schema.funnelEnrollments).where(and(eq(schema.funnelEnrollments.funnelId, id), eq(schema.funnelEnrollments.status, "active"))).groupBy(schema.funnelEnrollments.nextPosition),
      d.select({ status: schema.funnelEnrollments.status, c: count(), people: sql<number>`count(distinct person_id)::int` }).from(schema.funnelEnrollments).where(eq(schema.funnelEnrollments.funnelId, id)).groupBy(schema.funnelEnrollments.status),
    ]);
    const by = (st: string) => totals.find((t) => t.status === st)?.c ?? 0;
    const started = totals.reduce((a, t) => a + t.c, 0);
    // продукт: оффери, які його містять, і всі оффери для вибору
    const offersWith = f.kind === "product" ? await d.select({ pl: plans, active: sql<number>`(select count(*)::int from subscriptions s where s.plan_id = plans.id and s.source = 'hub' and s.status in ('active','trialing','past_due'))`, payments: sql<number>`(select count(*)::int from payment_attempts a where a.plan_id = plans.id and a.status = 'approved' and a.kind in ('first','manual','renewal'))`, grants: sql<number>`(select count(*)::int from subscriptions s where s.plan_id = plans.id and s.source = 'hub' and s.kind = 'grant')`, revenue: sql<string>`(select coalesce(sum(amount),0) from payment_attempts a where a.plan_id = plans.id and a.status = 'approved' and a.kind in ('first','manual','renewal'))` }).from(plans).where(sql`${plans.products} @> to_jsonb(array[${id}::int])`).orderBy(plans.sortOrder, plans.id) : [];
    const allOffers = f.kind === "product" ? await d.select({ id: plans.id, name: plans.name, isActive: plans.isActive }).from(plans).orderBy(plans.sortOrder, plans.name) : [];
    const links = await d.select().from(schema.funnelLinks).where(eq(schema.funnelLinks.funnelId, id)).orderBy(asc(schema.funnelLinks.id));
    const [direct] = await d.select({ c: sql<number>`count(*)::int` }).from(events).where(and(eq(events.type, "funnel.enrolled"), sql`(payload->>'funnelId')::int = ${id}`, sql`payload->>'linkId' is null`));
    return { f, steps, modules, commands, stats, enr, waiting, summary: { started, active: by("active"), stopped: by("stopped"), finished: by("done") }, offersWith, allOffers, links, directJoins: direct?.c ?? 0 };
  }, null);
}
export async function stepDetail(funnelId: number, stepId: number) {
  return safe(async () => {
    const d = db();
    const [f] = await d.select().from(funnels).where(eq(funnels.id, funnelId));
    if (!f) return null;
    const [steps, modules, med, allFunnels, offers] = await Promise.all([
      d.select().from(schema.funnelSteps).where(eq(schema.funnelSteps.funnelId, funnelId)).orderBy(asc(schema.funnelSteps.position), asc(schema.funnelSteps.id)),
      d.select().from(schema.funnelModules).where(eq(schema.funnelModules.funnelId, funnelId)).orderBy(asc(schema.funnelModules.position)),
      d.select().from(schema.media).orderBy(desc(schema.media.createdAt)).limit(300),
      d.select({ id: funnels.id, name: funnels.name }).from(funnels).where(and(eq(funnels.source, "hub"), eq(funnels.kind, "funnel"))).orderBy(funnels.name),
      d.select({ id: schema.offers.id, name: schema.offers.name, url: schema.offers.link }).from(schema.offers).where(eq(schema.offers.isActive, true)).orderBy(schema.offers.name),
    ]);
    const step = steps.find((s) => s.id === stepId);
    if (!step) return null;
    // кнопка «оффер»: оффери Hub (персональне посилання на оплату) і оффери ZenEdu (статичне посилання)
    const hub = await d.select({ id: plans.id, name: plans.name, key: plans.key }).from(plans).where(eq(plans.isActive, true)).orderBy(plans.sortOrder, plans.name);
    const offerOptions = [...hub.map((o) => ({ id: -o.id, name: `Hub · ${o.name}`, url: `hub:${o.key}` })), ...offers.map((o) => ({ id: o.id, name: `ZenEdu · ${o.name}`, url: o.url }))];
    // люди у воронці для «Надіслати цей крок людям»: чи отримували саме цей крок
    const people = (await d.execute(sql`select e.id, e.person_id, e.status, p.first_name, p.last_name, p.username,
        exists (select 1 from funnel_deliveries x where x.step_id = ${stepId} and x.person_id = e.person_id) as received, e.started_at
      from funnel_enrollments e join persons p on p.id = e.person_id where e.funnel_id = ${funnelId} order by e.started_at desc limit 500`)).rows as { id: number; person_id: number; status: string; first_name: string | null; last_name: string | null; username: string | null; received: boolean; started_at: string }[];
    return { f, step, steps, modules, media: med, allFunnels, offers: offerOptions, people };
  }, null);
}
export async function funnelPublic(id: number) {
  return safe(async () => {
    const [f] = await db().select({ id: funnels.id, name: funnels.name, description: funnels.description, buttonText: funnels.buttonText, cover: funnels.cover, isActive: funnels.isActive }).from(funnels).where(eq(funnels.id, id));
    const [b] = await db().select({ username: bots.username }).from(bots).where(eq(bots.key, "hub"));
    return f ? { f, botUsername: b?.username ?? null } : null;
  }, null);
}
export async function hubFunnels() { return safe(() => db().select().from(funnels).where(and(eq(funnels.source, "hub"), eq(funnels.isActive, true), eq(funnels.kind, "funnel"))).orderBy(funnels.name), []); }
export async function productPicker() { return safe(() => db().select({ id: funnels.id, name: funnels.name, isActive: funnels.isActive, cover: funnels.cover }).from(funnels).where(eq(funnels.kind, "product")).orderBy(funnels.name), []); }

// ---------- оффери Hub ----------
const offerStats = {
  active: sql<number>`(select count(*)::int from subscriptions s where s.plan_id = plans.id and s.source = 'hub' and s.status in ('active','trialing','past_due'))`,
  payments: sql<number>`(select count(*)::int from payment_attempts a where a.plan_id = plans.id and a.status = 'approved' and a.kind in ('first','manual','renewal'))`,
  grants: sql<number>`(select count(*)::int from subscriptions s where s.plan_id = plans.id and s.source = 'hub' and s.kind = 'grant')`,
  revenue: sql<string>`(select coalesce(sum(amount),0) from payment_attempts a where a.plan_id = plans.id and a.status = 'approved' and a.kind in ('first','manual','renewal'))`,
  spots: sql<number>`(select count(*)::int from subscriptions s left join access_links l on l.id = s.access_link_id where s.plan_id = plans.id and s.source = 'hub' and (s.kind <> 'grant' or coalesce(l.mark_as_payment, false)))`,
};
export async function hubOfferList() {
  return safe(async () => {
    const d = db();
    const rows = await d.select({ pl: plans, ...offerStats }).from(plans).orderBy(plans.sortOrder, plans.id);
    const prods = await d.select({ id: funnels.id, name: funnels.name }).from(funnels).where(eq(funnels.kind, "product"));
    const res = await d.select({ key: resources.key, name: resources.name }).from(resources);
    return rows.map((r) => ({ ...r, productNames: (r.pl.products ?? []).map((id) => prods.find((p) => p.id === id)?.name ?? `#${id}`), resourceNames: Object.keys(r.pl.entitlements ?? {}).map((k) => res.find((x) => x.key === k)?.name ?? k) }));
  }, []);
}
export async function offerDetail(id: number) {
  return safe(async () => {
    const d = db();
    const [row] = await d.select({ pl: plans, ...offerStats }).from(plans).where(eq(plans.id, id));
    if (!row) return null;
    const [links, prods, res, others, recent] = await Promise.all([
      d.select().from(schema.accessLinks).where(eq(schema.accessLinks.planId, id)).orderBy(desc(schema.accessLinks.createdAt)),
      d.select({ id: funnels.id, name: funnels.name, isActive: funnels.isActive, cover: funnels.cover, stepsCount: funnels.stepsCount }).from(funnels).where(eq(funnels.kind, "product")).orderBy(funnels.name),
      d.select().from(resources).orderBy(resources.id),
      d.select({ id: plans.id, name: plans.name }).from(plans).where(and(eq(plans.isActive, true), sql`plans.id <> ${id}`)).orderBy(plans.sortOrder, plans.name),
      d.select({ s: subscriptions, p: persons }).from(subscriptions).innerJoin(persons, eq(persons.id, subscriptions.personId)).where(and(eq(subscriptions.planId, id), eq(subscriptions.source, "hub"))).orderBy(desc(subscriptions.updatedAt)).limit(30),
    ]);
    return { ...row, links, products: prods, resources: res, others, recent };
  }, null);
}
export async function offerPublic(key: string) {
  return safe(async () => { const [pl] = await db().select().from(plans).where(eq(plans.key, key)); return pl ?? null; }, null);
}
export async function resourceList() { return safe(() => db().select().from(resources).orderBy(resources.id), []); }
export async function broadcastList(f: { q?: string; status?: string } = {}) {
  return safe(() => {
    const conds = [];
    if (f.q) conds.push(ilike(broadcasts.name, `%${f.q.trim()}%`));
    if (f.status) conds.push(eq(broadcasts.status, f.status));
    return db().select().from(broadcasts).where(conds.length ? and(...conds) : undefined).orderBy(desc(sql`coalesce(${broadcasts.scheduledAt}, ${broadcasts.createdAt})`)).limit(200);
  }, []);
}
export async function broadcastDetail(id: number) {
  return safe(async () => {
    const d = db();
    const [b] = await d.select().from(broadcasts).where(eq(broadcasts.id, id));
    if (!b) return null;
    const [recipients, clicks, med, tags, funs, plansL, offersL, res, byStatus] = await Promise.all([
      d.select({ r: schema.broadcastRecipients, p: persons, customer: sql<boolean>`exists (select 1 from orders o where o.person_id = ${persons.id} and o.status = 'paid')` }).from(schema.broadcastRecipients).innerJoin(persons, eq(persons.id, schema.broadcastRecipients.personId)).where(eq(schema.broadcastRecipients.broadcastId, id)).orderBy(desc(schema.broadcastRecipients.sentAt), asc(schema.broadcastRecipients.id)).limit(500),
      d.select({ c: schema.broadcastClicks, p: persons }).from(schema.broadcastClicks).innerJoin(persons, eq(persons.id, schema.broadcastClicks.personId)).where(eq(schema.broadcastClicks.broadcastId, id)).orderBy(desc(schema.broadcastClicks.createdAt)).limit(500),
      d.select().from(schema.media).orderBy(desc(schema.media.createdAt)).limit(300),
      d.execute(sql`select t as tag, count(*)::int as n from persons p, jsonb_array_elements_text(p.tags) t group by t order by n desc limit 300`).then((r) => r.rows as { tag: string; n: number }[]),
      d.select({ id: funnels.id, name: funnels.name }).from(funnels).where(eq(funnels.source, "hub")).orderBy(funnels.name),
      d.select({ id: plans.id, name: plans.name }).from(plans).orderBy(plans.sortOrder),
      d.select({ id: offers.id, name: offers.name, link: offers.link }).from(offers).where(eq(offers.isActive, true)).orderBy(offers.name),
      d.select({ key: resources.key, name: resources.name }).from(resources).orderBy(resources.id),
      d.select({ status: schema.broadcastRecipients.status, c: count() }).from(schema.broadcastRecipients).where(eq(schema.broadcastRecipients.broadcastId, id)).groupBy(schema.broadcastRecipients.status),
    ]);
    const hubOffers = await d.select({ id: plans.id, name: plans.name, key: plans.key }).from(plans).where(eq(plans.isActive, true)).orderBy(plans.sortOrder, plans.name);
    return { b, recipients, clicks, media: med, tags, funnels: funs, plans: plansL, offers: offersL, hubOffers, resources: res, byStatus };
  }, null);
}
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

export async function mediaList() { return safe(() => db().select().from(schema.media).orderBy(desc(schema.media.createdAt)).limit(200), []); }
export async function adminTexts() {
  return safe(async () => {
    const tg = adminTelegramId();
    const rows = await db().select({ id: events.id, createdAt: events.createdAt, payload: events.payload }).from(events).innerJoin(persons, eq(persons.id, events.personId))
      .where(and(eq(events.type, "bot.message"), eq(persons.telegramUserId, tg))).orderBy(desc(events.createdAt)).limit(100);
    return rows.map((r) => ({ id: r.id, at: r.createdAt, text: String((r.payload as { text?: string })?.text ?? ""), media: (r.payload as { media?: { kind: string } })?.media?.kind ?? null })).filter((r) => r.text);
  }, []);
}

/** Хто писав у Hub-бот останнім часом і чи були там медіа: для діагностики ADMIN_TELEGRAM_ID. */
export async function recentSenders() {
  return safe(async () => {
    const rows = await db().execute(sql`
      select p.telegram_user_id as tg, p.first_name, p.username, max(e.created_at) as last_at, count(*)::int as n,
             count(*) filter (where e.payload->'media' is not null and e.payload->'media' <> 'null'::jsonb)::int as with_media
      from events e join persons p on p.id = e.person_id
      where e.type = 'bot.message' group by 1,2,3 order by last_at desc limit 8`);
    return rows.rows as { tg: number; first_name: string | null; username: string | null; last_at: string; n: number; with_media: number }[];
  }, []);
}

export async function paymentAttemptList(page = 1) {
  return safe(async () => {
    const d = db(); const per = 50;
    const rows = await d.select({ a: schema.paymentAttempts, p: persons, plan: plans.name }).from(schema.paymentAttempts).innerJoin(persons, eq(persons.id, schema.paymentAttempts.personId)).leftJoin(plans, eq(plans.id, schema.paymentAttempts.planId)).orderBy(desc(schema.paymentAttempts.createdAt)).limit(per).offset((page - 1) * per);
    const [t] = await d.select({ c: count() }).from(schema.paymentAttempts);
    const [sum] = await d.select({ c: sql<number>`count(*)::int`, s: sql<string>`coalesce(sum(amount) filter (where status = 'approved' and kind in ('first','renewal','manual')), 0)` }).from(schema.paymentAttempts).where(sql`created_at > now() - interval '30 days' and mode = 'live'`);
    return { rows, total: t.c, page, per, live30: sum };
  }, { rows: [], total: 0, page: 1, per: 50, live30: { c: 0, s: "0" } });
}
export async function migrationList() {
  return safe(async () => {
    const r = await db().execute(sql`select z.id, z.person_id, p.first_name, p.last_name, p.username, z.price, z.currency, z.current_period_end, z.status,
        exists (select 1 from identities i where i.person_id = z.person_id and i.bot_key = 'hub' and i.blocked_at is null) as in_hub,
        (select max(e.created_at) from events e where e.person_id = z.person_id and e.type = 'payment.migrate_invite') as invited_at,
        h.id as hub_id, h.next_charge_at as hub_next, h.zen_cancelled_at, (select card_pan from payment_methods m where m.id = h.payment_method_id) as card
      from subscriptions z join persons p on p.id = z.person_id left join subscriptions h on h.person_id = z.person_id and h.source = 'hub'
      where z.source = 'zenedu' and z.status in ('active','trialing','past_due') order by z.current_period_end asc nulls last limit 500`);
    return r.rows as { id: number; person_id: number; first_name: string | null; last_name: string | null; username: string | null; price: string; currency: string; current_period_end: string | null; status: string; in_hub: boolean; invited_at: string | null; hub_id: number | null; hub_next: string | null; zen_cancelled_at: string | null; card: string | null }[];
  }, []);
}
export async function personPayments(personId: number) {
  return safe(async () => {
    const d = db();
    const hubSubs = await d.select({ s: subscriptions, plan: plans }).from(subscriptions).leftJoin(plans, eq(plans.id, subscriptions.planId)).where(and(eq(subscriptions.personId, personId), eq(subscriptions.source, "hub"))).orderBy(desc(subscriptions.updatedAt));
    const cards = await d.select().from(schema.paymentMethods).where(eq(schema.paymentMethods.personId, personId)).orderBy(desc(schema.paymentMethods.createdAt));
    const attempts = await d.select().from(schema.paymentAttempts).where(eq(schema.paymentAttempts.personId, personId)).orderBy(desc(schema.paymentAttempts.createdAt)).limit(20);
    const offersL = await d.select({ id: plans.id, name: plans.name, paymentType: plans.paymentType }).from(plans).where(eq(plans.isActive, true)).orderBy(plans.sortOrder, plans.name);
    const primaryCard = hubSubs.find((x) => x.s.paymentMethodId)?.s.paymentMethodId ?? null;
    return { hubSubs, cards, attempts, offers: offersL, primaryCard };
  }, { hubSubs: [] as { s: typeof subscriptions.$inferSelect; plan: typeof plans.$inferSelect | null }[], cards: [] as (typeof schema.paymentMethods.$inferSelect)[], attempts: [] as (typeof schema.paymentAttempts.$inferSelect)[], offers: [] as { id: number; name: string; paymentType: string }[], primaryCard: null as number | null });
}
