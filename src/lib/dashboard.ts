import { sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { accessGraceHours, subscriptionAllowsSql } from "./access-rule";
import { offerScope, scopeSql } from "./offers";
import { zenPeriodSql } from "./zenedu";

/**
 * Зведення для дашборда. Дані ZenEdu (імпорт) і Hub (оплати WayForPay) рахуються разом:
 * - учасниці клубу — унікальні люди з чинним доступом за підпискою клубу (людина в ZenEdu і в Hub рахується один раз);
 * - підписка клубу — будь-яка підписка ZenEdu або оффер Hub, що відкриває канал чи групу;
 * - тестові оплати Hub (режим test) ніде не враховуються;
 * - доступ ZenEdu: до кінця оплаченого періоду + 3 дні на автосписання (як у ZenEdu), скасована — до кінця періоду;
 *   доступ Hub: єдине правило з грейсом (access-rule).
 */

const DAY = 86400_000;
/** Курс для зведення: усі суми дашборда в гривнях, долари множаться на цей курс. Інші валюти не враховуються. */
export const USD_UAH = 45;
const RATE: Record<string, number> = { UAH: 1, USD: USD_UAH };
const toUah = (price: number, currency: string) => price * (RATE[currency] ?? 0);
const rateSql = (a: string) => sql.raw(`(case ${a}.currency when 'UAH' then 1 when 'USD' then ${USD_UAH} end)`);
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
    : sql.raw(`((${a}.source = 'zenedu' and ${a}.type in ('subscription_start','subscription_renew','subscription_card_update')) or (${a}.source = 'hub' and ${a}.plan_id in (${clubPlanIds.length ? clubPlanIds.join(",") : "0"})))`);
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

  const classified = sql`
    select o.id, o.source, o.price * ${rateSql("o")} as price, o.price as raw_price, o.currency, coalesce(o.paid_at, o.created_at) as created_at, o.person_id,
      case when o.type = 'subscription_card_update' then 'subscription_renew' when o.type in ('subscription_start','subscription_renew') then o.type
           when exists (select 1 from orders p where p.person_id = o.person_id and p.status = 'paid' and p.id <> o.id and coalesce(p.paid_at, p.created_at) < coalesce(o.paid_at, o.created_at) and ${clubOrder("p")} and ${notTestOrder("p")})
           then 'subscription_renew' else 'subscription_start' end as kind,
      (o.type = 'subscription_start' and ((o.source = 'zenedu' and (lower(o.offer_name) like '%2 тижні%' or lower(o.offer_name) like '%пробн%'))
        or (o.source = 'hub' and exists (select 1 from plans pl where pl.id = o.plan_id and o.price < pl.price * 0.5)))) as is_trial,
      (case when o.source = 'zenedu' then ${sql.raw(zenPeriodSql("o.offer_name", "o.type"))} in (14, 31)
            else exists (select 1 from plans pl where pl.id = o.plan_id and pl.payment_type = 'subscription' and pl.period = 'month' and pl.interval_count = 1) end) as monthly
    from orders o where o.status = 'paid' and ${clubOrder("o")} and ${notTestOrder("o")}`;
  const cover = sql`
    with c as (${classified}),
    cv as (select c.*, (case
        when c.source = 'zenedu' then (case when c.is_trial then 14 else ${sql.raw(zenPeriodSql("o.offer_name", "o.type"))} end)
        else (case when c.is_trial then 14 else coalesce((select s.period_days from payment_attempts pa join subscriptions s on s.id = pa.subscription_id where pa.order_id = c.id limit 1), 31) end) end) as days
      from c join orders o on o.id = c.id),
    sq as (select cv.*, created_at + days * interval '1 day' as cover_end,
        max(created_at + days * interval '1 day') over (partition by person_id order by created_at, id rows between unbounded preceding and 1 preceding) as prev_end,
        max(created_at + days * interval '1 day') over (partition by person_id order by created_at, id rows between unbounded preceding and current row) as run_end,
        lead(created_at) over (partition by person_id order by created_at, id) as next_at
      from cv),
    fl as (select sq.*, case when prev_end is null then 'new' when prev_end + interval '3 days' < created_at then 'returned' else 'renew' end as flow,
        case when next_at is null or next_at > run_end + interval '3 days' then run_end + interval '3 days' end as lapse_at
      from sq)`;
  const scopeO = sc ? scopeSql(sc, "o") : sql`true`;
  // усі запити дашборда незалежні: запускаємо одночасно, а не по черзі (кожен — окремий запит до Neon)
  const run = <T,>(q: PromiseLike<T>) => { const pr = Promise.resolve(q); pr.catch(() => null); return pr; };
  // звітний період — поточний календарний місяць за Києвом (M0 → зараз); порівняння — минулий місяць з 1-го до того самого дня й часу (P0 → P1).
  // Якщо в минулому місяці такого числа немає (31 березня → лютий), P1 = кінець минулого місяця.
  const KM = sql.raw(`date_trunc('month', now() at time zone 'Europe/Kyiv')`);
  const M0 = sql`(${KM} at time zone 'Europe/Kyiv')`;
  const P0 = sql`((${KM} - interval '1 month') at time zone 'Europe/Kyiv')`;
  const P1 = sql`least((${KM} - interval '1 month' + ((now() at time zone 'Europe/Kyiv') - ${KM})) at time zone 'Europe/Kyiv', ${M0})`;
  const q1 = run(d.execute(sql`
    select s.id, s.person_id, s.source, s.kind, s.status, s.price::text as price, s.currency, s.period_days, s.current_period_end, s.next_charge_at, s.cancel_at_period_end, s.plan_id, s.offer_id,
      pl.name as plan_name, zo.name as offer_name
    from subscriptions s left join plans pl on pl.id = s.plan_id left join offers zo on zo.id = s.offer_id
    where ${clubSub} and ${notTestSub} and ${live}`));
  const q2 = run(d.execute(sql`
    select count(distinct s.person_id)::int as c from subscriptions s
    where ${clubSub} and ${notTestSub} and not ${live} and ${accessEnd} >= ${M0} and ${accessEnd} <= now()
      and not exists (select 1 from subscriptions s2 where s2.person_id = s.person_id and s2.id <> s.id and ${liveFor("s2", grace)} and ${clubFor("s2", sc, clubPlanIds)})`));
  // для порівняння на плитці: пішли минулого місяця до того самого дня (і досі не повернулись)
  const q14 = run(d.execute(sql`
    select count(distinct s.person_id)::int as c from subscriptions s
    where ${clubSub} and ${notTestSub} and not ${live} and ${accessEnd} >= ${P0} and ${accessEnd} < ${P1}
      and not exists (select 1 from subscriptions s2 where s2.person_id = s.person_id and s2.id <> s.id and ${liveFor("s2", grace)} and ${clubFor("s2", sc, clubPlanIds)})`));
  const q3 = run(d.execute(sql`
    with c as (${classified})
    select
      count(*) filter (where kind = 'subscription_start' and created_at >= ${M0})::int as starts,
      count(*) filter (where kind = 'subscription_start' and created_at >= ${M0} and source = 'zenedu')::int as starts_zen,
      count(*) filter (where kind = 'subscription_start' and created_at >= ${M0} and source = 'hub')::int as starts_hub,
      count(*) filter (where kind = 'subscription_start' and created_at >= ${P0} and created_at < ${P1})::int as starts_prev,
      count(*) filter (where kind = 'subscription_renew' and created_at >= ${M0})::int as renews,
      count(*) filter (where kind = 'subscription_renew' and created_at >= ${P0} and created_at < ${P1})::int as renews_prev
    from c`));
  const q4 = run(d.execute(sql`${cover},
    mo as (select g as m0, g + interval '1 month' as m1 from generate_series(date_trunc('month', now() at time zone 'Europe/Kyiv') - interval '11 months', date_trunc('month', now() at time zone 'Europe/Kyiv'), interval '1 month') g),
    mz as (select to_char(m0, 'YYYY-MM') as m, m0 at time zone 'Europe/Kyiv' as a, least(m1 at time zone 'Europe/Kyiv', now()) as b from mo)
    select mz.m,
      (select count(*) from fl where flow = 'new' and created_at >= mz.a and created_at < mz.b)::int as new,
      (select count(*) from fl where flow = 'new' and is_trial and created_at >= mz.a and created_at < mz.b)::int as new_trial,
      (select count(*) from fl where flow = 'returned' and created_at >= mz.a and created_at < mz.b)::int as returned,
      (select count(*) from fl where flow = 'renew' and created_at >= mz.a and created_at < mz.b)::int as renew,
      (select coalesce(sum(price), 0) from fl where flow = 'new' and created_at >= mz.a and created_at < mz.b)::text as uah_new,
      (select coalesce(sum(price), 0) from fl where flow = 'returned' and created_at >= mz.a and created_at < mz.b)::text as uah_returned,
      (select coalesce(sum(price), 0) from fl where flow = 'renew' and created_at >= mz.a and created_at < mz.b)::text as uah_renew,
      (select coalesce(sum(raw_price), 0) from fl where currency = 'USD' and created_at >= mz.a and created_at < mz.b)::text as usd,
      (select count(distinct person_id) from fl where lapse_at >= mz.a and lapse_at < mz.b and lapse_at <= now())::int as churned,
      (select count(distinct person_id) from fl where created_at <= mz.b and cover_end + interval '3 days' > mz.b)::int as members
    from mz order by mz.m`));
  const q5 = run(d.execute(sql`${cover}
    select
      count(*) filter (where not is_trial and run_end + interval '3 days' between now() - interval '150 days' and now() - interval '3 days')::int as due,
      count(*) filter (where not is_trial and run_end + interval '3 days' between now() - interval '150 days' and now() - interval '3 days' and next_at is not null and next_at <= run_end + interval '10 days')::int as renewed,
      count(*) filter (where is_trial and cover_end + interval '3 days' between now() - interval '150 days' and now() - interval '3 days')::int as trial_due,
      count(*) filter (where is_trial and cover_end + interval '3 days' between now() - interval '150 days' and now() - interval '3 days' and next_at is not null and next_at <= cover_end + interval '10 days')::int as trial_paid,
      -- для «Прорахунку»: продовження за останні 90 днів і середні ціни (у гривнях) пробного та повного місяця
      count(*) filter (where not is_trial and run_end + interval '3 days' between now() - interval '90 days' and now() - interval '3 days')::int as due90,
      count(*) filter (where not is_trial and run_end + interval '3 days' between now() - interval '90 days' and now() - interval '3 days' and next_at is not null and next_at <= run_end + interval '10 days')::int as renewed90,
      coalesce(avg(price) filter (where is_trial and created_at >= now() - interval '90 days'), 0)::float as avg_trial_uah,
      coalesce(avg(price) filter (where not is_trial and days between 28 and 31 and created_at >= now() - interval '90 days'), 0)::float as avg_month_uah
    from fl`));
  const q6 = run(d.execute(sql`${cover}
    select coalesce(sum(price) filter (where created_at >= now() - interval '90 days'), 0)::text as uah,
      count(distinct person_id) filter (where created_at <= now() and cover_end + interval '3 days' > now() - interval '90 days')::int as people,
      coalesce(sum(price) filter (where created_at >= now() - interval '180 days' and created_at < now() - interval '90 days'), 0)::text as uah_prev,
      count(distinct person_id) filter (where created_at <= now() - interval '90 days' and cover_end + interval '3 days' > now() - interval '180 days')::int as people_prev
    from fl`));
  // учасниці за оплатами зараз і минулого місяця в той самий день — для плашки зміни на «Активних учасницях»
  const q16 = run(d.execute(sql`${cover}
    select count(distinct person_id) filter (where created_at <= now() and cover_end + interval '3 days' > now())::int as now,
      count(distinct person_id) filter (where created_at <= ${P1} and cover_end + interval '3 days' > ${P1})::int as prev
    from fl`));
  const q7 = run(d.execute(sql`
    with c as (${classified})
    select to_char(created_at at time zone 'Europe/Kyiv', 'YYYY-MM-DD') as day,
      count(*) filter (where kind = 'subscription_start')::int as starts,
      count(*) filter (where kind = 'subscription_start' and source = 'zenedu')::int as starts_zen,
      count(*) filter (where kind = 'subscription_start' and source = 'hub')::int as starts_hub,
      count(*) filter (where kind = 'subscription_start' and is_trial)::int as trials,
      count(*) filter (where kind = 'subscription_renew')::int as renews,
      coalesce(sum(price), 0)::text as uah
    from c where created_at >= (date_trunc('day', now() at time zone 'Europe/Kyiv') - interval '13 days') at time zone 'Europe/Kyiv'
    group by 1`));
  // конверсії (правило власника 2026-11-24): рахуємо лише тих, у кого вже була спроба списання, щоб показник не «просідав» через свіжі когорти.
  // Пробний → 1-й повний місяць: успішні пробні оплати за 90 днів, у яких пробний період уже закінчився (ZenEdu — 14 днів, Hub — пробні дні оффера);
  //   конвертувалась, якщо наступна оплата клубу (не пробна) прийшла не пізніше ніж за 14 днів після кінця пробного (повторні спроби списання).
  // 1-й → 2-й місяць: перші повні місячні оплати за 180 днів, у яких уже настала дата другого списання (через 31 день);
  //   продовжила, якщо наступна оплата клубу прийшла не пізніше ніж за 14 днів після цієї дати.
  // Запас 1 день — на синхронізацію оплат ZenEdu (раз на годину) і списання вранці.
  const q8 = run(d.execute(sql`
    with c as (${classified}),
    seq as (select c.*, lead(created_at) over w as next_at, lead(is_trial) over w as next_trial, lag(is_trial) over w as prev_trial, lag(created_at) over w as prev_at
      from c window w as (partition by person_id order by created_at, id)),
    x as (select seq.*,
        (not seq.is_trial and seq.monthly and (seq.kind = 'subscription_start' or (seq.prev_trial is true and seq.prev_at > seq.created_at - interval '45 days'))) as first_full,
        seq.created_at + (case when seq.source = 'hub' then coalesce(nullif(pl.trial_days, 0), 14) else 14 end) * interval '1 day' as trial_due,
        seq.created_at + interval '31 days' as month_due
      from seq left join orders oo on oo.id = seq.id left join plans pl on pl.id = oo.plan_id)
    select
      count(*) filter (where is_trial and created_at >= now() - interval '90 days' and trial_due <= now() - interval '1 day')::int as trials,
      count(*) filter (where is_trial and created_at >= now() - interval '90 days' and trial_due <= now() - interval '1 day'
        and next_at is not null and not coalesce(next_trial, false) and next_at <= trial_due + interval '14 days')::int as trials_paid,
      count(*) filter (where is_trial and source = 'zenedu' and created_at >= now() - interval '90 days' and trial_due <= now() - interval '1 day')::int as trials_zen,
      count(*) filter (where is_trial and source = 'zenedu' and created_at >= now() - interval '90 days' and trial_due <= now() - interval '1 day'
        and next_at is not null and not coalesce(next_trial, false) and next_at <= trial_due + interval '14 days')::int as trials_paid_zen,
      count(*) filter (where first_full and created_at >= now() - interval '180 days' and month_due <= now() - interval '1 day')::int as firsts,
      count(*) filter (where first_full and created_at >= now() - interval '180 days' and month_due <= now() - interval '1 day'
        and next_at is not null and not coalesce(next_trial, false) and next_at <= month_due + interval '14 days')::int as firsts_paid
    from x`));
  // пробний → 1-й повний місяць лише для пробних, оформлених через Hub (рішення власника 2026-11-26), з даних самого Hub.
  // Пробна оплата — перша бойова оплата оффера з пробними днями за пробною ціною. Перехід — будь-яка успішна бойова оплата
  // клубу від цієї людини за повною ціною (автосписання, ручна оплата за посиланням, інший оффер клубу) після пробної
  // і не пізніше ніж за 14 днів після кінця пробного. Лише ті, у кого пробний закінчився щонайменше день тому, за 90 днів.
  // Для тих, хто не перейшов, — причина: списання відхилено / скасували / картка не збереглась / списання не було.
  const clubPlans = sql.raw(clubPlanIds.length ? clubPlanIds.join(",") : "0");
  const q15 = run(d.execute(sql`
    with t as (
      select pa.id, pa.person_id, pa.order_id, s.id as sub_id, coalesce(pa.processed_at, pa.created_at) as at,
        coalesce(pa.processed_at, pa.created_at) + pl.trial_days * interval '1 day' as due,
        pl.price * ${rateSql("pl")} as full_uah, s.status, s.cancel_at_period_end, s.payment_method_id
      from payment_attempts pa join plans pl on pl.id = pa.plan_id join subscriptions s on s.id = pa.subscription_id
      where pa.kind = 'first' and pa.mode = 'live' and pa.status in ('approved','refunded') and pl.trial_days > 0 and pa.amount < pl.price
        and coalesce(pa.processed_at, pa.created_at) >= now() - interval '90 days' and ${clubSub}
    ), x as (
      select t.*,
        -- перехід: бойова оплата Hub за повною ціною (автосписання, ручна, інший оффер клубу) — за спробами оплати або замовленнями Hub.
        -- ZenEdu не рахується (рішення власника 2026-11-27): лише ті, хто підписувався через Hub.
        (exists (select 1 from payment_attempts r join plans rp on rp.id = r.plan_id
          where r.person_id = t.person_id and r.id <> t.id and r.mode = 'live' and r.status in ('approved','refunded') and r.kind in ('renewal','manual','first')
            and r.plan_id in (${clubPlans}) and r.amount >= rp.price * 0.5
            and coalesce(r.processed_at, r.created_at) > t.at and coalesce(r.processed_at, r.created_at) <= t.due + interval '14 days')
         or exists (select 1 from orders o where o.person_id = t.person_id and o.status in ('paid','refunded') and o.id is distinct from t.order_id
            and o.source = 'hub' and o.plan_id in (${clubPlans})
            and ${notTestOrder("o")} and o.price * ${rateSql("o")} >= t.full_uah * 0.5
            and coalesce(o.paid_at, o.created_at) > t.at and coalesce(o.paid_at, o.created_at) <= t.due + interval '14 days')) as paid,
        (select count(*) from payment_attempts r where r.subscription_id = t.sub_id and r.kind = 'renewal' and r.mode = 'live')::int as renew_tries,
        (select r.reason from payment_attempts r where r.subscription_id = t.sub_id and r.kind = 'renewal' and r.status in ('declined','error','expired')
          order by r.id desc limit 1) as decline_reason
      from t)
    select count(*) filter (where due <= now() - interval '1 day')::int as trials,
      count(*) filter (where due <= now() - interval '1 day' and paid)::int as trials_paid,
      count(*) filter (where due <= now() - interval '1 day' and renew_tries > 0)::int as charged,
      count(*) filter (where due > now() - interval '1 day')::int as waiting,
      count(*) filter (where due <= now() - interval '1 day' and not paid and decline_reason is not null)::int as declined,
      count(*) filter (where due <= now() - interval '1 day' and not paid and decline_reason is null and (cancel_at_period_end or status in ('cancelled','refunded','paused')))::int as cancelled,
      count(*) filter (where due <= now() - interval '1 day' and not paid and decline_reason is null and not (cancel_at_period_end or status in ('cancelled','refunded','paused')) and payment_method_id is null)::int as no_card,
      count(*) filter (where due <= now() - interval '1 day' and not paid and decline_reason is null and not (cancel_at_period_end or status in ('cancelled','refunded','paused')) and payment_method_id is not null)::int as not_charged,
      (select mode() within group (order by decline_reason) from x where due <= now() - interval '1 day' and not paid and decline_reason is not null) as top_reason
    from x`));
  const q9 = run(d.execute(sql`select o.currency as cur, o.source, coalesce(sum(o.price),0)::text as sum, coalesce(sum(o.price * ${rateSql("o")}),0)::text as uah, count(*)::int as c from orders o
    where o.status = 'paid' and coalesce(o.paid_at, o.created_at) >= ${M0} and ${scopeO} and ${notTestOrder("o")} group by 1, 2`));
  // отримано за поточний календарний місяць (київський час), усі оплачені замовлення (клуб і продукти), без тестових; і минулий місяць до того самого дня
  const q12 = run(d.execute(sql`with b as (select date_trunc('month', now() at time zone 'Europe/Kyiv') as m0,
        (now() at time zone 'Europe/Kyiv') - date_trunc('month', now() at time zone 'Europe/Kyiv') as passed)
    select
      coalesce(sum(o.price * ${rateSql("o")}) filter (where coalesce(o.paid_at, o.created_at) >= b.m0 at time zone 'Europe/Kyiv'), 0)::text as uah,
      coalesce(sum(o.price * ${rateSql("o")}) filter (where o.source = 'zenedu' and coalesce(o.paid_at, o.created_at) >= b.m0 at time zone 'Europe/Kyiv'), 0)::text as zen,
      coalesce(sum(o.price * ${rateSql("o")}) filter (where o.source = 'hub' and coalesce(o.paid_at, o.created_at) >= b.m0 at time zone 'Europe/Kyiv'), 0)::text as hub,
      count(*) filter (where coalesce(o.paid_at, o.created_at) >= b.m0 at time zone 'Europe/Kyiv')::int as c,
      coalesce(sum(o.price * ${rateSql("o")}) filter (where coalesce(o.paid_at, o.created_at) >= (b.m0 - interval '1 month') at time zone 'Europe/Kyiv'
        and coalesce(o.paid_at, o.created_at) < least(b.m0 - interval '1 month' + b.passed, b.m0) at time zone 'Europe/Kyiv'), 0)::text as prev
    from orders o, b
    where o.status = 'paid' and coalesce(o.paid_at, o.created_at) >= (b.m0 - interval '1 month') at time zone 'Europe/Kyiv' and ${scopeO} and ${notTestOrder("o")}`));
  const q10 = run(d.execute(sql`select count(*)::int as total,
      count(*) filter (where started_at >= ${M0})::int as month,
      count(*) filter (where started_at >= ${P0} and started_at < ${P1})::int as prev
    from identities where bot_key = 'hub'`));
  const q11 = run(d.execute(sql`select
      (select max(finished_at) from sync_runs where kind like 'zenedu%' and status = 'done') as ok_at,
      (select row_to_json(x) from (select kind, status, error, started_at, stats from sync_runs where kind like 'zenedu%' order by started_at desc limit 1) x) as last`));
  // ---------- учасниці ----------
  const subs = (await q1).rows as SubRow[];
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

  // пішли цього місяця: доступ закінчився з 1-го числа, і чинної підписки клубу зараз немає
  const [left] = (await q2).rows as { c: number }[];

  // ---------- платежі: нові й продовження ----------
  // разова оплата клубу в Hub — нова, якщо раніше людина клуб не оплачувала, інакше продовження
  // дата платежу — момент оплати (paid_at), а не створення замовлення: замовлення ZenEdu може бути створене раніше, ніж оплачене
  // пробний: старт ZenEdu-оффера «2 тижні»/«пробн…» або перша оплата Hub дешевша за половину ціни оффера
  const period = (await q3).rows[0] as { starts: number; starts_zen: number; starts_hub: number; starts_prev: number; renews: number; renews_prev: number };
  // ---------- динаміка по місяцях (за оплатами) ----------
  // кожна оплата клубу покриває період (місяць / 3 міс. / рік / пробні 2 тижні); +3 дні на продовження.
  // нова — перша оплата людини; повернулась — оплата після перерви (попередній доступ скінчився понад 3 дні тому);
  // продовження — оплата без перерви. Пішла — доступ скінчився (+3 дні) і наступної оплати не було.
  const flowRows = (await q4).rows as { m: string; new: number; new_trial: number; returned: number; renew: number; uah_new: string; uah_returned: string; uah_renew: string; usd: string; churned: number; members: number }[];
  // ймовірності для прогнозу: частка тих, хто продовжив, серед доступів, що закінчились за останні 150 днів
  const [rates] = (await q5).rows as { due: number; renewed: number; trial_due: number; trial_paid: number; due90: number; renewed90: number; avg_trial_uah: number; avg_month_uah: number }[];
  const pRenew = rates?.due ? rates.renewed / rates.due : 0.8;
  const pTrial = rates?.trial_due ? rates.trial_paid / rates.trial_due : 0.5;
  // ARPU за 90 днів: дохід клубу (у гривнях, долари за курсом) за 90 днів / люди, які мали доступ до клубу хоча б день за ці 90 днів
  const [a90] = (await q6).rows as { uah: string; people: number; uah_prev: string; people_prev: number }[];
  const [membersPay] = (await q16).rows as { now: number; prev: number }[];
  const [leftPrev] = (await q14).rows as { c: number }[];

  // останні 14 днів по днях (київський час): нові й продовження
  const daily = (await q7).rows as { day: string; starts: number; starts_zen: number; starts_hub: number; trials: number; renews: number; uah: string }[];
  const last14 = Array.from({ length: 14 }, (_, i) => kyivDay(Date.now() - i * DAY)).map((day) => daily.find((x) => x.day === day) ?? { day, starts: 0, starts_zen: 0, starts_hub: 0, trials: 0, renews: 0, uah: "0" });

  // конверсії (когорти, щоб у кожної людини був час продовжити):
  // пробний → 1-й повний місяць: пробні, розпочаті 17–90 днів тому; продовжила, якщо була наступна оплата клубу
  // 1-й → 2-й місяць: перша повна місячна оплата (старт без пробного або перша оплата після пробного) 34–120 днів тому
  const [conv0] = (await q8).rows as { trials: number; trials_paid: number; trials_zen: number; trials_paid_zen: number; firsts: number; firsts_paid: number }[];
  const [hubTrials] = (await q15).rows as { trials: number; trials_paid: number; charged: number; waiting: number; declined: number; cancelled: number; no_card: number; not_charged: number; top_reason: string | null }[];
  // пробний → 1-й місяць: лише пробні, оформлені через Hub; ZenEdu — окремо для порівняння
  const conv = conv0 ? { ...conv0, trials: hubTrials?.trials ?? 0, trials_paid: hubTrials?.trials_paid ?? 0, trials_waiting: hubTrials?.waiting ?? 0,
    charged: hubTrials?.charged ?? 0,
    lost: { declined: hubTrials?.declined ?? 0, cancelled: hubTrials?.cancelled ?? 0, noCard: hubTrials?.no_card ?? 0, notCharged: hubTrials?.not_charged ?? 0, topReason: hubTrials?.top_reason ?? null } } : undefined;

  // поточний місяць у розрізі валют: скільки з суми прийшло в доларах і кількість оплат
  const rev = (await q9).rows as { cur: string; source: string; sum: string; uah: string; c: number }[];
  const revOf = (cur: string, source?: string) => rev.filter((r) => r.cur === cur && (!source || r.source === source)).reduce((a, r) => a + Number(r.sum), 0);
  const revCount = rev.reduce((a, r) => a + r.c, 0);
  const [mo] = (await q12).rows as { uah: string; zen: string; hub: string; c: number; prev: string }[];
  const month = { uah: Number(mo?.uah ?? 0), zen: Number(mo?.zen ?? 0), hub: Number(mo?.hub ?? 0), count: mo?.c ?? 0, prev: Number(mo?.prev ?? 0) };

  // ---------- Hub-бот ----------
  const [bot] = (await q10).rows as { total: number; month: number; prev: number }[];

  // ---------- прогноз списань ----------
  // ціна продовження після пробного періоду ZenEdu: найчастіша ціна місячних підписок ZenEdu
  const zenMonthly = subs.filter((s) => s.source === "zenedu" && s.period_days >= 28 && s.period_days <= 31).map((s) => Number(s.price));
  const zenRenewPrice = mode(zenMonthly);
  const now = Date.now();
  const charges: { at: number; price: number; currency: string; source: string; p: number }[] = [];
  const horizon = endOfMonthKyiv(2); // поточний місяць і два наступні
  for (const s of subs.filter(autoRenews)) {
    let next = new Date((s.source === "hub" ? s.next_charge_at ?? s.current_period_end : s.current_period_end) ?? 0).getTime();
    if (!next) continue;
    if (next < now) next = now; // ZenEdu: списання вже мало бути, чекаємо в межах 3 днів
    const price = s.source === "zenedu" && s.status === "trialing" ? (zenRenewPrice ?? Number(s.price)) : Number(s.price);
    const step = Math.max(1, s.source === "zenedu" && s.status === "trialing" ? 31 : s.period_days) * DAY;
    // імовірність k-го списання: пробний — спершу конверсія пробного, далі продовження; решта — продовження щоразу
    let p = s.status === "trialing" ? pTrial : pRenew;
    for (let t = next; t < horizon; t += step) { charges.push({ at: t, price: toUah(price, s.currency), currency: s.currency, source: s.source, p }); p *= pRenew; }
  }
  const days14: { day: string; c: number; zen: number; hub: number; uah: number; ends: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const day = kyivDay(now + i * DAY);
    const list = charges.filter((c) => kyivDay(c.at) === day);
    days14.push({ day, c: list.length, zen: list.filter((c) => c.source === "zenedu").length, hub: list.filter((c) => c.source === "hub").length, uah: list.reduce((a, c) => a + c.price, 0), ends: 0 });
  }
  // закінчуються без продовження (скасовані, разові, доступ за посиланням)
  for (const s of subs.filter((x) => !autoRenews(x))) {
    if (!s.current_period_end) continue;
    const day = kyivDay(new Date(s.current_period_end).getTime());
    const row = days14.find((x) => x.day === day); if (row) row.ends++;
  }
  // прогноз по місяцях: очікуване (з імовірностями) і максимум (якщо всі продовжать)
  const forecast = new Map<string, { uah: number; usd: number; c: number; maxUah: number; expC: number }>();
  for (const c of charges) {
    const m = kyivMonth(c.at); const f = forecast.get(m) ?? { uah: 0, usd: 0, c: 0, maxUah: 0, expC: 0 };
    // price уже в гривнях (долари за курсом); usd — частка доларових підписок у доларах для довідки
    f.uah += c.price * c.p; f.maxUah += c.price; if (c.currency === "USD") f.usd += (c.price / USD_UAH) * c.p;
    f.c++; f.expC += c.p; forecast.set(m, f);
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
  const mrrUah = Math.round(tariffRows.reduce((a, t) => a + toUah(t.mrr, t.currency), 0)); // усе в гривнях, долари за курсом
  const mrrUsd = tariffRows.filter((t) => t.currency === "USD").reduce((a, t) => a + t.mrr, 0);

  // ---------- свіжість даних ZenEdu ----------
  const [sync] = (await q11).rows as { ok_at: string | null; last: { kind: string; status: string; error: string | null; started_at: string; stats: Record<string, number> } | null }[];

  return {
    members, zenOnly, hubOnly, both, trialing, pastDue, noRenew, left: left?.c ?? 0,
    last14, conv: conv ?? { trials: 0, trials_paid: 0, trials_waiting: 0, trials_zen: 0, trials_paid_zen: 0, firsts: 0, firsts_paid: 0, charged: 0, lost: { declined: 0, cancelled: 0, noCard: 0, notCharged: 0, topReason: null as string | null } },
    // ARPU: щомісячний дохід (MRR) на учасницю з автопродовженням
    arpu: renewingPersons.size ? Math.round(mrrUah / renewingPersons.size) : 0,
    arpu90Prev: a90?.people_prev ? Math.round(Number(a90.uah_prev) / a90.people_prev) : 0, leftPrev: leftPrev?.c ?? 0,
    arpu90: a90?.people ? Math.round(Number(a90.uah) / a90.people) : 0, arpu90People: a90?.people ?? 0, arpu90Uah: Number(a90?.uah ?? 0),
    // усе нижче — за поточний календарний місяць; *Prev — минулий місяць до того самого дня
    startsMonth: period.starts, startsZen: period.starts_zen, startsHub: period.starts_hub, startsPrev: period.starts_prev, renewsMonth: period.renews, renewsPrev: period.renews_prev,
    month, revUsd: revOf("USD"), revCount, usdRate: USD_UAH,
    membersPay: membersPay ?? { now: 0, prev: 0 },
    bot: bot ?? { total: 0, month: 0, prev: 0 },
    days14, flow: flowRows, pRenew, pTrial, rates: rates ?? { due: 0, renewed: 0, trial_due: 0, trial_paid: 0, due90: 0, renewed90: 0, avg_trial_uah: 0, avg_month_uah: 0 }, forecast: [...forecast.entries()].map(([m, f]) => ({ m, ...f })).sort((a, b) => a.m.localeCompare(b.m)),
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

/**
 * Розбір пробних, оформлених через Hub за 90 днів (для «Конверсій» на дашборді): по кожній людині — коли пробний закінчився,
 * чи є картка, що Hub пробував списати і які оплати клубу були після пробного (Hub і ZenEdu). Щоб було видно, чому не перейшли.
 */
export async function hubTrialDetails(limit = 200) {
  const d = db();
  const chans = (await d.select({ key: schema.resources.key, kind: schema.resources.kind }).from(schema.resources)).filter((r) => r.kind === "telegram_channel" || r.kind === "telegram_group").map((r) => r.key);
  const plans = await d.select({ id: schema.plans.id, ents: schema.plans.entitlements }).from(schema.plans);
  const ids = plans.filter((p) => Object.keys(p.ents ?? {}).some((k) => chans.includes(k))).map((p) => p.id);
  const club = sql.raw(ids.length ? ids.join(",") : "0");
  const r = await d.execute(sql`
    select pa.person_id, coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), 'tg ' || p.telegram_user_id) as name, p.username,
      pl.name as plan, pa.amount::text as trial_amount, pa.currency, coalesce(pa.processed_at, pa.created_at) as at,
      coalesce(pa.processed_at, pa.created_at) + pl.trial_days * interval '1 day' as due,
      s.status, s.cancel_at_period_end, s.payment_method_id is not null as has_card, s.next_charge_at, s.current_period_end,
      (select coalesce(json_agg(json_build_object('at', coalesce(r.processed_at, r.created_at), 'status', r.status, 'amount', r.amount, 'reason', r.reason) order by r.id), '[]'::json)
        from payment_attempts r where r.subscription_id = s.id and r.kind = 'renewal' and r.mode = 'live') as charges,
      (select coalesce(json_agg(json_build_object('at', coalesce(o.paid_at, o.created_at), 'source', o.source, 'type', o.type, 'name', o.offer_name, 'amount', o.price, 'currency', o.currency, 'status', o.status) order by coalesce(o.paid_at, o.created_at)), '[]'::json)
        from orders o where o.person_id = pa.person_id and o.id is distinct from pa.order_id and o.status in ('paid','refunded')
          and o.source = 'hub' and o.plan_id in (${club})
          and coalesce(o.paid_at, o.created_at) > coalesce(pa.processed_at, pa.created_at) - interval '1 day') as orders
    from payment_attempts pa join plans pl on pl.id = pa.plan_id join subscriptions s on s.id = pa.subscription_id join persons p on p.id = pa.person_id
    where pa.kind = 'first' and pa.mode = 'live' and pa.status in ('approved','refunded') and pl.trial_days > 0 and pa.amount < pl.price
      and coalesce(pa.processed_at, pa.created_at) >= now() - interval '90 days' and s.plan_id in (${club})
    order by coalesce(pa.processed_at, pa.created_at) desc limit ${limit}`);
  return r.rows as {
    person_id: number; name: string; username: string | null; plan: string; trial_amount: string; currency: string; at: string; due: string;
    status: string; cancel_at_period_end: boolean; has_card: boolean; next_charge_at: string | null; current_period_end: string | null;
    charges: { at: string; status: string; amount: string; reason: string | null }[];
    orders: { at: string; source: string; type: string | null; name: string | null; amount: string; currency: string; status: string }[];
  }[];
}
