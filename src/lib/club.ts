import { sql } from "drizzle-orm";
import { db } from "@/db";
import { accessGraceHours, subscriptionAllowsSql, ZEN_GRACE_HOURS } from "./access-rule";
import { teamTelegramIds } from "./auth";

/**
 * Єдине правило «учасниця клубу» для платформи кабінету, етерів і перевірок доступу.
 * Доступ є, якщо хоч одне:
 *  - чинна підписка ZenEdu (за єдиним правилом доступу; для ZenEdu — 7 днів запасу, див. access-rule);
 *  - чинна підписка Hub на оффер клубу (оффер відкриває канал чи групу), оплачена бойово або видана за посиланням доступу/вручну;
 *  - чинне право на канал чи групу клубу (вручну, збережене після зміни оффера тощо);
 *  - людина з команди Hub (ADMIN_TELEGRAM_ID, користувачі панелі з Telegram) або тестувальник оплат.
 * Доступ безстроковий, поки діє підписка; щойно вона закінчилась (і минув грейс) — доступу немає.
 * hadClub — людина колись мала підписку клубу: колишній учасниці кабінет не відкриває пробний період знову.
 */
export type ClubAccess = { member: boolean; via: "zenedu" | "hub" | "grant" | "team" | null; until: Date | null; plan: string | null; hadClub: boolean; refunded: boolean };

export async function clubAccess(personId: number | null | undefined): Promise<ClubAccess> {
  const none: ClubAccess = { member: false, via: null, until: null, plan: null, hadClub: false, refunded: false };
  if (!personId) return none;
  const d = db(); const grace = await accessGraceHours();
  const allow = sql.raw(subscriptionAllowsSql("s", grace));
  const clubPlan = sql`exists (select 1 from plans pl, resources r where pl.id = s.plan_id and r.kind in ('telegram_channel','telegram_group') and pl.entitlements ? r.key)`;
  // тестова оплата Hub без бойової — не клуб (тестувальники отримують доступ як команда)
  const notTestOnly = sql`not (exists (select 1 from payment_attempts pa where pa.subscription_id = s.id and pa.mode = 'test') and not exists (select 1 from payment_attempts pa where pa.subscription_id = s.id and pa.mode = 'live'))`;
  const rows = (await d.execute(sql`
    select s.source, s.status, s.current_period_end, ${allow} as live, coalesce(pl.name, zo.name) as plan,
      (s.current_period_end + ((case when s.source = 'zenedu' then ${sql.raw(String(Math.max(Math.round(grace), ZEN_GRACE_HOURS)))} else ${sql.raw(String(Math.round(grace)))} end) * interval '1 hour')) as access_end
    from subscriptions s left join plans pl on pl.id = s.plan_id left join offers zo on zo.id = s.offer_id
    where s.person_id = ${personId} and (s.source = 'zenedu' or (s.source = 'hub' and ${clubPlan} and ${notTestOnly}))
    order by ${allow} desc, s.current_period_end desc nulls first`)).rows as { source: string; status: string; current_period_end: string | null; live: boolean; plan: string | null; access_end: string | null }[];
  const hadClub = rows.length > 0;
  const refunded = rows.some((r) => r.status === "refunded");
  const live = rows.filter((r) => r.live);
  if (live.length) {
    const forever = live.some((r) => !r.current_period_end);
    const until = forever ? null : new Date(Math.max(...live.map((r) => new Date(r.access_end!).getTime())));
    return { member: true, via: live[0].source === "zenedu" ? "zenedu" : "hub", until, plan: live[0].plan ?? (live[0].source === "zenedu" ? "Клуб (ZenEdu)" : "Клуб"), hadClub, refunded };
  }
  const [ent] = (await d.execute(sql`select e.valid_until from entitlements e join resources r on r.key = e.resource_key
    where e.person_id = ${personId} and r.kind in ('telegram_channel','telegram_group') and e.revoked_at is null and (e.valid_until is null or e.valid_until > now())
    order by e.valid_until desc nulls first limit 1`)).rows as { valid_until: string | null }[];
  if (ent) return { member: true, via: "grant", until: ent.valid_until ? new Date(ent.valid_until) : null, plan: "Клуб", hadClub, refunded };
  const [p] = (await d.execute(sql`select telegram_user_id from persons where id = ${personId}`)).rows as { telegram_user_id: string | number }[];
  const tg = Number(p?.telegram_user_id ?? 0);
  if (tg) {
    const team = await teamTelegramIds();
    const [t] = (await d.execute(sql`select value from settings where key = 'payments.testers'`)).rows as { value: unknown }[];
    const testers = Array.isArray(t?.value) ? (t.value as unknown[]).map(Number) : [];
    if (team.has(tg) || testers.includes(tg)) return { member: true, via: "team", until: null, plan: "Команда клубу", hadClub, refunded };
  }
  return { ...none, hadClub, refunded };
}

/**
 * SQL-умова «людина <personIdExpr> — учасниця клубу зараз» за тим самим правилом, що clubAccess
 * (для статистики й списків; команда й тестувальники — за переданими Telegram ID).
 */
export async function clubMemberSql(personIdExpr: string) {
  const grace = await accessGraceHours();
  const team = [...(await teamTelegramIds())];
  const [t] = (await db().execute(sql`select value from settings where key = 'payments.testers'`)).rows as { value: unknown }[];
  const ids = [...team, ...(Array.isArray(t?.value) ? (t.value as unknown[]).map(Number) : [])].filter((n) => Number.isSafeInteger(n) && n > 0);
  const allow = subscriptionAllowsSql("s", grace);
  return sql.raw(`(exists (select 1 from subscriptions s where s.person_id = ${personIdExpr} and ${allow}
      and (s.source = 'zenedu' or (s.source = 'hub'
        and exists (select 1 from plans pl, resources r where pl.id = s.plan_id and r.kind in ('telegram_channel','telegram_group') and pl.entitlements ? r.key)
        and not (exists (select 1 from payment_attempts pa where pa.subscription_id = s.id and pa.mode = 'test') and not exists (select 1 from payment_attempts pa where pa.subscription_id = s.id and pa.mode = 'live')))))
    or exists (select 1 from entitlements e join resources r on r.key = e.resource_key where e.person_id = ${personIdExpr} and r.kind in ('telegram_channel','telegram_group') and e.revoked_at is null and (e.valid_until is null or e.valid_until > now()))
    ${ids.length ? `or exists (select 1 from persons tp where tp.id = ${personIdExpr} and tp.telegram_user_id in (${ids.join(",")}))` : ""})`);
}
