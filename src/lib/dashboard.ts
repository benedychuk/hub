import { sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { accessGraceHours, subscriptionAllowsSql } from "./access-rule";
import { offerScope, scopeSql } from "./offers";

/**
 * Зведення для дашборда. Дані ZenEdu (імпорт) і Hub (оплати WayForPay) рахуються разом:
 * - учасниці клубу — унікальні люди з чинним доступом за підпискою клубу (людина в ZenEdu і в Hub рахується один раз);
 * - підписка клубу — будь-яка підписка ZenEdu або оффер Hub, що відкриває канал чи групу;
 * - тестові оплати Hub (режим test) ніде не враховуються;
 * - доступ ZenEdu: до кінця оплаченого періоду + 3 дні на автосписання (як у ZenEdu), скасована — до кінця періоду;
 *   доступ Hub: єдине правило з грейсом (access-rule).
 */

const DAY = 86400_000;
type SubRow = { id: number; person_id: number; source: string; kind: string; status: string; price: string; currency: string; period_days: number; current_period_end: Date | string | null; next_charge_at: Date | string | null; cancel_at_period_end: boolean; plan_id: number | null; offer_id: number | null; plan_name: string | null; offer_name: string | null };

export type Dashboard = Awaited<ReturnType<typeof buildDashboard>>;

export async function buildDashboard(offerKey?: string) {
  const d = db();
  const grace = await accessGraceHours();
  const sc = await offerScope(offerKey);

  // оффери Hub, що відкривають канал або групу клубу
  const chans = (await d.select({ key: schema.resources.key, kind: schema.resources.kind }).from(schema.resources)).filter((r) => r.kind === "telegram_channel" || r.kind === "telegram_group").map((r) => r.key);
  const plans = await d.select({ id: schema.plans.id, name: schema.plans.name, ents: schema.plans.entitlements }).from(schema.plans);
  const clubPlanIds = plans.filter((p) => Object.keys(p.ents ?? {}).some((k) => chans.includes(k))).map((p) => p.id);
  const idList = (ids: number[]) => sql.raw(ids.length ? ids.join(",") : "0");

  const clubSub: SQL = sc ? scopeSql(sc, "s") : sql`(s.source = 'zenedu' or s.plan_id in (${idList(clubPlanIds)}))`;
  const clubOrder = (a: "o" | "p"): SQL => sc ? sql.raw(`(${scopeSqlText(sc, a)})`)
    : sql.raw(`((${a}.source = 'zenedu' and ${a}.type in ('subscription_start','subscription_renew')) or (${a}.source = 'hub' and ${a}.plan_id in (${clubPlanIds.length ? clubPlanIds.join(",") : "0"})))`);
  const notTestSub = sql`not (s.source = 'hub' and exists (select 1 from payment_attempts pa where pa.subscription_id = s.id and pa.mode = 'test') and not exists (select 1 from payment_attempts pa where pa.subscription_id = s.id and pa.mode = 'live'))`;
  const notTestOrder = (a: "o" | "p") => sql`not (${sql.raw(a)}.source = 'hub' and exists (select 1 from payment_attempts pa where pa.order_id = ${sql.raw(a)}.id and pa.mode = 'test'))`;
  const hubAllow = sql.raw(subscriptionAllowsSql("s", grace));
  // чинний доступ зараз
  const live = sql`(case when s.source = 'zenedu'
      then s.status not in ('paused','refunded') and (s.current_period_end is null or s.current_period_end + (case when s.status = 'cancelled' then interval '0 days' else interval '3 days' end) > now())
      else ${hubAllow} end)`;
  // коли доступ закінчився або закінчиться
  const accessEnd = sql`(case when s.source = 'zenedu' then s.current_period_end + (case when s.status = 'cancelled' then interval '0 days' else interval '3 days' end)
      else s.current_period_end + (${Math.max(0, Math.round(grace))} * interval '1 hour') end)`;

  // ---------- учасниці ----------
  const subs = (await d.execute(sql`
    select s.id, s.person_id, s.source, s.kind, s.status, s.price::text as price, s.currency, s.period_days, s.current_period_end, s.next_charge_at, s.cancel_at_period_end, s.plan_id, s.offer_id,
      pl.name as plan_name, zo.name as offer_name
    from subscriptions s left join plans pl on pl.id = s.plan_id left join offers zo on zo.id = s.offer_id
    where ${clubSub} and ${notTestSub} and ${live}`)).rows as SubRow[];
  const bySource = new Map<number, Set<string>>();
  for (const s of subs) { const set = bySource.get(s.person_id) ?? new Set<string>(); set.add(s.source); bySource.set(s.person_id, set); }
  const members = bySource.size;
  const both = [...bySource.values()].filter((x) => x.size > 1).length;
  const zenOnly = [...bySource.values()].filter((x) => x.size === 1 && x.has("zenedu")).length;
  const hubOnly = members - both - zenOnly;
  const autoRenews = (s: SubRow) => s.source === "zenedu" ? ["active", "trialing"].includes(s.status) : s.kind === "subscription" && ["active", "trialing", "past_due"].includes(s.status) && !s.cancel_at_period_end;
  const renewingPersons = new Set(subs.filter(autoRenews).map((s) => s.person_id));
  const noRenew = [...bySource.keys()].filter((p) => !renewingPersons.has(p)).length;
  const trialing = new Set(subs.filter((s) => s.status === "trialing").map((s) => s.person_id)).size;
  const pastDue = new Set(subs.filter((s) => s.status === "past_due").map((s) => s.person_id)).size;

  // пішли за 30 днів: доступ закінчився за останні 30 днів, і чинної підписки клубу зараз немає
  const [left] = (await d.execute(sql`
    select count(distinct s.person_id)::int as c from subscriptions s
    where ${clubSub} and ${notTestSub} and not ${live} and ${accessEnd} between now() - interval '30 days' and now()
      and not exists (select 1 from subscriptions s2 where s2.person_id = s.person_id and s2.id <> s.id and ${liveFor("s2", grace)} and ${clubFor("s2", sc, clubPlanIds)})`)).rows as { c: number }[];

  // ---------- платежі: нові й продовження ----------
  // разова оплата клубу в Hub — нова, якщо раніше людина клуб не оплачувала, інакше продовження
  // дата платежу — момент оплати (paid_at), а не створення замовлення: замовлення ZenEdu може бути створене раніше, ніж оплачене
  // пробний: старт ZenEdu-оффера «2 тижні»/«пробн…» або перша оплата Hub дешевша за половину ціни оффера
  const classified = sql`
    select o.id, o.source, o.price, o.currency, coalesce(o.paid_at, o.created_at) as created_at, o.person_id,
      case when o.type in ('subscription_start','subscription_renew') then o.type
           when exists (select 1 from orders p where p.person_id = o.person_id and p.status = 'paid' and p.id <> o.id and coalesce(p.paid_at, p.created_at) < coalesce(o.paid_at, o.created_at) and ${clubOrder("p")} and ${notTestOrder("p")})
           then 'subscription_renew' else 'subscription_start' end as kind,
      (o.type = 'subscription_start' and ((o.source = 'zenedu' and (lower(o.offer_name) like '%2 тижні%' or lower(o.offer_name) like '%пробн%'))
        or (o.source = 'hub' and exists (select 1 from plans pl where pl.id = o.plan_id and o.price < pl.price * 0.5)))) as is_trial,
      (case when o.source = 'zenedu' then not (lower(o.offer_name) like '%рік%' or lower(o.offer_name) like '%year%' or lower(o.offer_name) like '%3 місяці%' or lower(o.offer_name) like '%три місяці%')
            else exists (select 1 from plans pl where pl.id = o.plan_id and pl.payment_type = 'subscription' and pl.period = 'month' and pl.interval_count = 1) end) as monthly
    from orders o where o.status = 'paid' and ${clubOrder("o")} and ${notTestOrder("o")}`;
  const period = (await d.execute(sql`
    with c as (${classified})
    select
      count(*) filter (where kind = 'subscription_start' and created_at >= now() - interval '30 days')::int as starts,
      count(*) filter (where kind = 'subscription_start' and created_at >= now() - interval '30 days' and source = 'zenedu')::int as starts_zen,
      count(*) filter (where kind = 'subscription_start' and created_at >= now() - interval '30 days' and source = 'hub')::int as starts_hub,
      count(*) filter (where kind = 'subscription_start' and created_at >= now() - interval '60 days' and created_at < now() - interval '30 days')::int as starts_prev,
      count(*) filter (where kind = 'subscription_renew' and created_at >= now() - interval '30 days')::int as renews,
      coalesce(sum(price) filter (where currency = 'UAH' and created_at >= now() - interval '30 days'), 0)::text as club_uah
    from c`)).rows[0] as { starts: number; starts_zen: number; starts_hub: number; starts_prev: number; renews: number; club_uah: string };
  const monthly = (await d.execute(sql`
    with c as (${classified})
    select to_char(created_at at time zone 'Europe/Kyiv', 'YYYY-MM') as m,
      count(*) filter (where kind = 'subscription_start')::int as starts,
      count(*) filter (where kind = 'subscription_renew')::int as renews,
      count(*) filter (where source = 'hub')::int as hub,
      coalesce(sum(price) filter (where currency = 'UAH'), 0)::text as uah,
      coalesce(sum(price) filter (where currency = 'USD'), 0)::text as usd
    from c where created_at >= date_trunc('month', now() at time zone 'Europe/Kyiv') - interval '7 months'
    group by 1 order by 1`)).rows as { m: string; starts: number; renews: number; hub: number; uah: string; usd: string }[];

  // останні 14 днів по днях (київський час): нові й продовження
  const daily = (await d.execute(sql`
    with c as (${classified})
    select to_char(created_at at time zone 'Europe/Kyiv', 'YYYY-MM-DD') as day,
      count(*) filter (where kind = 'subscription_start')::int as starts,
      count(*) filter (where kind = 'subscription_start' and source = 'zenedu')::int as starts_zen,
      count(*) filter (where kind = 'subscription_start' and source = 'hub')::int as starts_hub,
      count(*) filter (where kind = 'subscription_start' and is_trial)::int as trials,
      count(*) filter (where kind = 'subscription_renew')::int as renews,
      coalesce(sum(price) filter (where currency = 'UAH'), 0)::text as uah
    from c where created_at >= (date_trunc('day', now() at time zone 'Europe/Kyiv') - interval '13 days') at time zone 'Europe/Kyiv'
    group by 1`)).rows as { day: string; starts: number; starts_zen: number; starts_hub: number; trials: number; renews: number; uah: string }[];
  const last14 = Array.from({ length: 14 }, (_, i) => kyivDay(Date.now() - i * DAY)).map((day) => daily.find((x) => x.day === day) ?? { day, starts: 0, starts_zen: 0, starts_hub: 0, trials: 0, renews: 0, uah: "0" });

  // конверсії (когорти, щоб у кожної людини був час продовжити):
  // пробний → 1-й повний місяць: пробні, розпочаті 17–90 днів тому; продовжила, якщо була наступна оплата клубу
  // 1-й → 2-й місяць: перша повна місячна оплата (старт без пробного або перша оплата після пробного) 34–120 днів тому
  const [conv] = (await d.execute(sql`
    with c as (${classified}),
    seq as (select c.*, lead(created_at) over w as next_at, lag(is_trial) over w as prev_trial, lag(created_at) over w as prev_at from c window w as (partition by person_id order by created_at))
    select
      count(*) filter (where is_trial and created_at between now() - interval '90 days' and now() - interval '17 days')::int as trials,
      count(*) filter (where is_trial and created_at between now() - interval '90 days' and now() - interval '17 days' and next_at is not null and next_at <= created_at + interval '45 days')::int as trials_paid,
      count(*) filter (where first_full and created_at between now() - interval '120 days' and now() - interval '34 days')::int as firsts,
      count(*) filter (where first_full and created_at between now() - interval '120 days' and now() - interval '34 days' and next_at is not null and next_at <= created_at + interval '45 days')::int as firsts_paid
    from (select seq.*, (not is_trial and monthly and (kind = 'subscription_start' or (prev_trial is true and prev_at > created_at - interval '45 days'))) as first_full from seq) x`)).rows as { trials: number; trials_paid: number; firsts: number; firsts_paid: number }[];

  // зібрано за 30 днів: усі оплачені замовлення (клуб і продукти), без тестових
  const scopeO = sc ? scopeSql(sc, "o") : sql`true`;
  const rev = (await d.execute(sql`select o.currency as cur, o.source, coalesce(sum(o.price),0)::text as sum, count(*)::int as c from orders o
    where o.status = 'paid' and coalesce(o.paid_at, o.created_at) >= now() - interval '30 days' and ${scopeO} and ${notTestOrder("o")} group by 1, 2`)).rows as { cur: string; source: string; sum: string; c: number }[];
  const revOf = (cur: string, source?: string) => rev.filter((r) => r.cur === cur && (!source || r.source === source)).reduce((a, r) => a + Number(r.sum), 0);
  const revCount = rev.reduce((a, r) => a + r.c, 0);

  // ---------- Hub-бот ----------
  const [bot] = (await d.execute(sql`select count(*)::int as total,
      count(*) filter (where started_at >= now() - interval '30 days')::int as d30,
      count(*) filter (where started_at >= now() - interval '60 days' and started_at < now() - interval '30 days')::int as prev
    from identities where bot_key = 'hub'`)).rows as { total: number; d30: number; prev: number }[];

  // ---------- прогноз списань ----------
  // ціна продовження після пробного періоду ZenEdu: найчастіша ціна місячних підписок ZenEdu
  const zenMonthly = subs.filter((s) => s.source === "zenedu" && s.period_days >= 28 && s.period_days <= 31).map((s) => Number(s.price));
  const zenRenewPrice = mode(zenMonthly);
  const now = Date.now();
  const charges: { at: number; price: number; currency: string; source: string }[] = [];
  const horizon = endOfMonthKyiv(2); // поточний місяць і два наступні
  for (const s of subs.filter(autoRenews)) {
    let next = new Date((s.source === "hub" ? s.next_charge_at ?? s.current_period_end : s.current_period_end) ?? 0).getTime();
    if (!next) continue;
    if (next < now) next = now; // ZenEdu: списання вже мало бути, чекаємо в межах 3 днів
    const price = s.source === "zenedu" && s.status === "trialing" ? (zenRenewPrice ?? Number(s.price)) : Number(s.price);
    const step = Math.max(1, s.source === "zenedu" && s.status === "trialing" ? 31 : s.period_days) * DAY;
    for (let t = next; t < horizon; t += step) charges.push({ at: t, price, currency: s.currency, source: s.source });
  }
  const days14: { day: string; c: number; zen: number; hub: number; uah: number; ends: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const day = kyivDay(now + i * DAY);
    const list = charges.filter((c) => kyivDay(c.at) === day);
    days14.push({ day, c: list.length, zen: list.filter((c) => c.source === "zenedu").length, hub: list.filter((c) => c.source === "hub").length, uah: list.filter((c) => c.currency === "UAH").reduce((a, c) => a + c.price, 0), ends: 0 });
  }
  // закінчуються без продовження (скасовані, разові, доступ за посиланням)
  for (const s of subs.filter((x) => !autoRenews(x))) {
    if (!s.current_period_end) continue;
    const day = kyivDay(new Date(s.current_period_end).getTime());
    const row = days14.find((x) => x.day === day); if (row) row.ends++;
  }
  const forecast = new Map<string, { uah: number; usd: number; c: number }>();
  for (const c of charges) {
    const m = kyivMonth(c.at); const f = forecast.get(m) ?? { uah: 0, usd: 0, c: 0 };
    if (c.currency === "USD") f.usd += c.price; else f.uah += c.price; f.c++; forecast.set(m, f);
  }

  // ---------- тарифи ----------
  const tariffs = new Map<string, { name: string; source: string; period: number; members: Set<number>; renewing: number; prices: number[]; mrr: number; currency: string }>();
  for (const s of subs) {
    const name = s.source === "hub" ? s.plan_name ?? "Оффер Hub" : s.offer_name ?? "ZenEdu (оффер не прив'язано)";
    const key = `${s.source}|${name}|${s.period_days}|${s.currency}`;
    const t = tariffs.get(key) ?? { name, source: s.source, period: s.period_days, members: new Set<number>(), renewing: 0, prices: [], mrr: 0, currency: s.currency };
    t.members.add(s.person_id); if (autoRenews(s)) { t.renewing++; t.mrr += s.source === "zenedu" && s.status === "trialing" ? zenRenewPrice ?? Number(s.price) : Number(s.price) / monthsOf(s.period_days); }
    t.prices.push(Number(s.price)); tariffs.set(key, t);
  }
  const tariffRows = [...tariffs.values()].map((t) => ({ name: t.name, source: t.source, period: t.period, currency: t.currency, members: t.members.size, renewing: t.renewing, price: mode(t.prices) ?? 0, mrr: Math.round(t.mrr) })).sort((a, b) => b.members - a.members);
  const mrrUah = tariffRows.filter((t) => t.currency === "UAH").reduce((a, t) => a + t.mrr, 0);
  const mrrUsd = tariffRows.filter((t) => t.currency === "USD").reduce((a, t) => a + t.mrr, 0);

  // ---------- свіжість даних ZenEdu ----------
  const [sync] = (await d.execute(sql`select
      (select max(finished_at) from sync_runs where kind like 'zenedu%' and status = 'done') as ok_at,
      (select row_to_json(x) from (select kind, status, error, started_at, stats from sync_runs where kind like 'zenedu%' order by started_at desc limit 1) x) as last`)).rows as { ok_at: string | null; last: { kind: string; status: string; error: string | null; started_at: string; stats: Record<string, number> } | null }[];

  return {
    members, zenOnly, hubOnly, both, trialing, pastDue, noRenew, left: left?.c ?? 0,
    last14, conv: conv ?? { trials: 0, trials_paid: 0, firsts: 0, firsts_paid: 0 },
    // ARPU: щомісячний дохід (MRR) на учасницю з автопродовженням; і фактичний дохід клубу за 30 днів на активну учасницю
    arpu: renewingPersons.size ? Math.round(mrrUah / renewingPersons.size) : 0,
    arpu30: bySource.size ? Math.round(Number(period.club_uah) / bySource.size) : 0,
    starts30: period.starts, startsZen: period.starts_zen, startsHub: period.starts_hub, startsPrev: period.starts_prev, renews30: period.renews,
    revUah: revOf("UAH"), revUsd: revOf("USD"), revZen: revOf("UAH", "zenedu"), revHub: revOf("UAH", "hub"), revCount,
    bot: bot ?? { total: 0, d30: 0, prev: 0 },
    days14, monthly, forecast: [...forecast.entries()].map(([m, f]) => ({ m, ...f })).sort((a, b) => a.m.localeCompare(b.m)),
    tariffs: tariffRows, mrrUah, mrrUsd, zenRenewPrice,
    syncOkAt: sync?.ok_at ? new Date(sync.ok_at) : null, syncLast: sync?.last ?? null, syncProblem: syncProblem(sync?.last ?? null),
    scoped: Boolean(sc),
  };
}

// ---------- допоміжне ----------
function scopeSqlText(sc: { planId: number | null; zenIds: number[] }, alias: string) {
  const parts: string[] = [];
  if (sc.planId) parts.push(`${alias}.plan_id = ${sc.planId}`);
  if (sc.zenIds.length) parts.push(`${alias}.offer_id in (${sc.zenIds.join(",")})`);
  return parts.length ? parts.join(" or ") : "false";
}
function liveFor(a: string, grace: number) {
  return sql.raw(`(case when ${a}.source = 'zenedu' then ${a}.status not in ('paused','refunded') and (${a}.current_period_end is null or ${a}.current_period_end + (case when ${a}.status = 'cancelled' then interval '0 days' else interval '3 days' end) > now()) else ${subscriptionAllowsSql(a, grace)} end)`);
}
function clubFor(a: string, sc: { planId: number | null; zenIds: number[] } | null, clubPlanIds: number[]) {
  return sql.raw(sc ? `(${scopeSqlText(sc, a)})` : `(${a}.source = 'zenedu' or ${a}.plan_id in (${clubPlanIds.length ? clubPlanIds.join(",") : "0"}))`);
}
/** Скільки місяців у періоді: місяць (28–31 дн.) = 1, 3 місяці = 3, рік = 12, інше — за днями. */
function monthsOf(days: number) {
  if (days >= 28 && days <= 31) return 1;
  if (days >= 89 && days <= 93) return 3;
  if (days >= 360 && days <= 366) return 12;
  return Math.max(1, days) / 30.4;
}
function mode(xs: number[]) {
  if (!xs.length) return null;
  const m = new Map<number, number>(); xs.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}
const kyivFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" });
export const kyivDay = (t: number) => kyivFmt.format(new Date(t));
export const kyivMonth = (t: number) => kyivDay(t).slice(0, 7);
/** Кінець n-го місяця від поточного (за київським часом), мс. */
function endOfMonthKyiv(n: number) {
  const [y, m] = kyivMonth(Date.now()).split("-").map(Number);
  return Date.UTC(y, m - 1 + n + 1, 1) - 3 * 3600_000;
}

/** Що сталося з останньою синхронізацією ZenEdu і що робити — людською мовою. null — проблем немає. */
function syncProblem(last: { kind: string; status: string; error: string | null; started_at: string } | null) {
  if (!last) return { title: "Дані ZenEdu ще не імпортовані", what: "Запустіть повний імпорт у Налаштуваннях.", detail: null };
  const kind = last.kind === "zenedu_incremental" ? "Щоденне оновлення" : "Повний імпорт";
  const stuck = last.status === "running" && Date.now() - new Date(last.started_at).getTime() > 10 * 60_000;
  if (stuck) return { title: `${kind} ZenEdu не завершився (перервано за лімітом часу)`, what: last.kind === "zenedu_incremental" ? "Натисніть «Оновити з ZenEdu» у Налаштуваннях." : "Продовжіть повний імпорт у Налаштуваннях: він продовжить з того ж місця.", detail: null };
  if (last.status !== "error") return null;
  const e = last.error ?? "";
  const what = /ZENEDU_API_TOKEN/.test(e) ? "У Vercel не задано ZENEDU_API_TOKEN: додайте токен API ZenEdu і зробіть редеплой."
    : /\b(401)\b/.test(e) ? "ZenEdu не прийняв токен API (401): перевірте ZENEDU_API_TOKEN у Vercel."
    : /\b(403|429|5\d\d)\b|retries/.test(e) ? "ZenEdu тимчасово обмежив запити: повторіть оновлення в Налаштуваннях за кілька хвилин; наступного ранку воно запуститься саме."
    : "Повторіть оновлення в Налаштуваннях; якщо помилка повториться, надішліть її текст розробнику.";
  return { title: `${kind} ZenEdu ${new Date(last.started_at).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} завершився помилкою`, what, detail: e.slice(0, 300) };
}
