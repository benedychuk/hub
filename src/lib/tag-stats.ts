import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { teamTelegramIds } from "./auth";

/**
 * Маркетинг → «Лід-магніти і статті»: скільки людей купили протягом N годин після того, як отримали тег.
 *
 * Час присвоєння тегу — перша подія в журналі за всю історію людини:
 *   tag.added   — воронки, посилання, кнопки розсилок, автоматизації, етери (пишеться давно);
 *   tag.tracked — решта джерел, лише для статистики (не запускає автоматизації): вручну в картці,
 *                 платформа (онбординг), ZenEdu (помічаємо новий тег під час щогодинної синхронізації, тому час ±1 год).
 * Відсікання: не рахуємо тих, хто на момент тегу вже був у клубі (підписка, що діяла саме тоді, а не зараз),
 * і команду з тестувальниками.
 */
export const ZEN_TAG_SLACK_HOURS = 1;

/** Записати момент присвоєння тегів для статистики (без запуску автоматизацій). at — якщо відомий точніший час. */
export async function trackTags(personId: number | null | undefined, tags: string[], source: string, at?: Date | null, payload: Record<string, unknown> = {}) {
  const list = [...new Set(tags.map((t) => String(t ?? "").trim()).filter(Boolean))];
  if (!personId || !list.length) return;
  await db().insert(schema.events).values(list.map((tag) => ({ personId, type: "tag.tracked", source, payload: { tag, ...payload }, ...(at ? { createdAt: at } : {}) }))).catch(() => null);
}

/** SQL: людина <p> була учасницею клубу в момент <t> (історично, за підпискою й оплатою, що покривала цей момент). */
function memberAtSql(p: string, t: string) {
  return `(exists (select 1 from subscriptions s where s.person_id = ${p} and s.status <> 'refunded'
      and (s.source = 'zenedu' or (s.source = 'hub' and exists (select 1 from plans pl, resources r where pl.id = s.plan_id and r.kind in ('telegram_channel','telegram_group') and pl.entitlements ? r.key)))
      and coalesce(s.started_at, s.created_at) <= ${t}
      and (s.kind = 'grant' and (s.current_period_end is null or s.current_period_end > ${t})
        or exists (select 1 from orders o where o.person_id = ${p} and o.status = 'paid' and coalesce(o.paid_at, o.created_at) <= ${t}
          and coalesce(o.paid_at, o.created_at) > ${t} - (greatest(s.period_days, 1) + 3) * interval '1 day')))
    or exists (select 1 from entitlements e join resources r on r.key = e.resource_key where e.person_id = ${p} and e.granted_by = 'manual'
      and r.kind in ('telegram_channel','telegram_group') and e.created_at <= ${t} and (e.revoked_at is null or e.revoked_at > ${t}) and (e.valid_until is null or e.valid_until > ${t})))`;
}

export type TagQuery = { from: Date; to: Date; hours: number; tag?: string | null };
export type TagRow = { tag: string; got: number; members: number; base: number; buyers: number; revenue: number; sources: string };
export type BuyerRow = { person_id: number; name: string; username: string | null; tag_at: string; paid_at: string; offer: string | null; price: string; currency: string; mins: number; approx: boolean };

/** Базовий CTE: перший тег людини (за всю історію), що припав на період; член клубу на той момент; перша покупка у вікні. */
async function base(q: TagQuery) {
  const team = [...(await teamTelegramIds())].filter((n) => Number.isSafeInteger(n) && n > 0);
  const [t] = (await db().execute(sql`select value from settings where key = 'payments.testers'`)).rows as { value: unknown }[];
  const skip = [...team, ...(Array.isArray(t?.value) ? (t.value as unknown[]).map(Number) : [])].filter((n) => Number.isSafeInteger(n) && n > 0);
  const tagFilter = q.tag ? sql`and e.payload->>'tag' = ${q.tag}` : sql``;
  return sql`
    first_tag as (
      select e.payload->>'tag' as tag, e.person_id, min(e.created_at) as at,
        bool_and(e.type = 'tag.tracked' and e.source = 'zenedu') as approx, string_agg(distinct e.source, ',') as src
      from events e where e.type in ('tag.added','tag.tracked') and e.person_id is not null and coalesce(e.payload->>'tag', '') <> '' ${tagFilter}
      group by 1, 2
    ),
    t as (
      select ft.tag, ft.person_id, ft.at, ft.approx, ft.src,
        ft.at - (case when ft.approx then ${ZEN_TAG_SLACK_HOURS} else 0 end) * interval '1 hour' as at0
      from first_tag ft join persons p on p.id = ft.person_id
      where ft.at >= ${q.from.toISOString()}::timestamptz and ft.at < ${q.to.toISOString()}::timestamptz
        ${skip.length ? sql.raw(`and p.telegram_user_id not in (${skip.join(",")})`) : sql``}
    ),
    tm as (select t.*, ${sql.raw(memberAtSql("t.person_id", "t.at0"))} as member from t),
    buy as (
      select distinct on (tm.tag, tm.person_id) tm.tag, tm.person_id, tm.at, tm.approx, coalesce(o.paid_at, o.created_at) as paid_at,
        coalesce(o.offer_name, ofr.name, pl.name) as offer, o.price, o.currency
      from tm join orders o on o.person_id = tm.person_id and o.status = 'paid' and o.price > 0
        and coalesce(o.paid_at, o.created_at) >= tm.at0 and coalesce(o.paid_at, o.created_at) < tm.at + ${q.hours} * interval '1 hour'
      left join offers ofr on ofr.id = o.offer_id left join plans pl on pl.id = o.plan_id
      where not tm.member
      order by tm.tag, tm.person_id, coalesce(o.paid_at, o.created_at)
    )`;
}

/** Зведення по всіх тегах за період (або по одному). Гривні: USD за курсом дашборда не перераховуємо — лише UAH-сума. */
export async function tagConversion(q: TagQuery, limit = 200): Promise<TagRow[]> {
  const r = await db().execute(sql`with ${await base(q)}
    select tm.tag, count(*)::int as got, count(*) filter (where tm.member)::int as members, count(*) filter (where not tm.member)::int as base,
      count(b.person_id)::int as buyers, coalesce(sum(b.price) filter (where b.currency = 'UAH'), 0)::float as revenue,
      string_agg(distinct tm.src, ',') as sources
    from tm left join buy b on b.tag = tm.tag and b.person_id = tm.person_id
    group by tm.tag order by count(*) filter (where not tm.member) desc, tm.tag limit ${limit}`);
  return (r.rows as TagRow[]).map((x) => ({ ...x, sources: [...new Set(String(x.sources ?? "").split(",").filter(Boolean))].join(",") }));
}

/** Хто купив після тегу (для одного тегу). */
export async function tagBuyers(q: TagQuery & { tag: string }): Promise<BuyerRow[]> {
  const r = await db().execute(sql`with ${await base(q)}
    select b.person_id, coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), 'tg ' || p.telegram_user_id) as name, p.username,
      b.at as tag_at, b.paid_at, b.offer, b.price::text as price, b.currency, greatest(0, round(extract(epoch from (b.paid_at - b.at)) / 60))::int as mins, b.approx
    from buy b join persons p on p.id = b.person_id order by b.paid_at desc limit 500`);
  return r.rows as BuyerRow[];
}

/** Усі теги з журналу (для підказки в полі вибору), найчастіші за останні 90 днів зверху. */
export async function knownTags() {
  const r = await db().execute(sql`select e.payload->>'tag' as tag, count(distinct e.person_id)::int as n from events e
    where e.type in ('tag.added','tag.tracked') and e.created_at > now() - interval '90 days' and coalesce(e.payload->>'tag', '') <> '' group by 1 order by 2 desc limit 300`);
  return r.rows as { tag: string; n: number }[];
}

// ---------- тег для тих, у кого автосписання WayForPay не пройшло і хто так і не оплатив ----------
export const WFP_FAILED_TAG = "WFP_failed";
/** Люди з відмовою автосписання «Cardholder session expired» (бойові), після якої не було жодної успішної оплати Hub за повну ціну. */
const wfpFailedSql = sql`
  with f as (
    select r.person_id, min(coalesce(r.processed_at, r.created_at)) as first_fail
    from payment_attempts r
    where r.mode = 'live' and r.kind = 'renewal' and r.status in ('expired','declined','error') and r.reason ilike '%session expired%'
    group by r.person_id)
  select f.person_id from f
  where not exists (select 1 from payment_attempts ok join plans pl on pl.id = ok.plan_id
      where ok.person_id = f.person_id and ok.mode = 'live' and ok.status = 'approved' and ok.kind in ('renewal','manual','first')
        and ok.amount >= pl.price * 0.5 and coalesce(ok.processed_at, ok.created_at) > f.first_fail)`;
export async function wfpFailedCount() {
  const r = await db().execute(sql`select count(*)::int as c from (${wfpFailedSql}) x`);
  return Number((r.rows[0] as { c: number }).c);
}
/** Ставить тег (без запуску автоматизацій і без повідомлень людям). Повертає, скільки людей отримали тег уперше. */
export async function tagWfpFailed() {
  const ids = ((await db().execute(wfpFailedSql)).rows as { person_id: number }[]).map((x) => x.person_id);
  if (!ids.length) return 0;
  const tag = JSON.stringify([WFP_FAILED_TAG]);
  const fresh = (await db().execute(sql`update persons set tags = coalesce(tags, '[]'::jsonb) || ${tag}::jsonb, updated_at = now()
    where id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) and not coalesce(tags, '[]'::jsonb) @> ${tag}::jsonb returning id`)).rows as { id: number }[];
  for (const r of fresh) await trackTags(r.id, [WFP_FAILED_TAG], "manual", null, { reason: "wfp_session_expired" });
  return fresh.length;
}
