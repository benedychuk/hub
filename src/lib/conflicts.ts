import { sql } from "drizzle-orm";
import { db } from "@/db";
import { accessGraceHours, subscriptionAllowsSql } from "./access-rule";

/**
 * Конфлікти на стику ZenEdu і Hub: людина має доступ за одним джерелом, а інше йому заважає або дублює.
 * Лише показуємо (нікому нічого не надсилаємо й нічого не змінюємо): що робити — у підказці до кожного виду.
 *
 *  removed_by_other — має чинне право Hub на канал, але її виключив або заблокував інший адміністратор (найчастіше бот ZenEdu,
 *                     бо в ZenEdu підписки немає). Hub автоматично не запрошує вдруге, щоб не ходити по колу з ZenEdu.
 *  banned           — має право Hub, але в каналі заблокована (бан ZenEdu після кінця старої підписки): посилання для неї
 *                     «неактивне». Hub тепер знімає блокування перед кожним запрошенням; тут — ті, кому ще не надіслали нове.
 *  not_joined       — має право Hub понад добу, але так і не в каналі (посилання не доставлено, прострочене, помилка Telegram, автоматика вимкнена).
 *  no_right         — чинна оплачена підписка Hub на оффер клубу, а права на канал немає (збій синхронізації прав).
 *  double_paying    — платить і в ZenEdu (підписка активна, не скасована), і в Hub одночасно.
 */
export type ConflictKind = "removed_by_other" | "banned" | "not_joined" | "no_right" | "double_paying";
export type Conflict = { kind: ConflictKind; personId: number; name: string; username: string | null; telegramUserId: number; resourceKey: string | null; detail: string; at: string | null };

export const CONFLICT_LABELS: Record<ConflictKind, { title: string; hint: string }> = {
  removed_by_other: { title: "Виключив інший бот", hint: "Оплатила в Hub, але її виключив інший адміністратор каналу (найчастіше бот ZenEdu, бо там підписки немає). Надішліть посилання ще раз; якщо повториться — приберіть її з учасників каналу в ZenEdu." },
  banned: { title: "Заблокована в каналі", hint: "Блокування лишилось від ZenEdu після кінця старої підписки, тому посилання для неї «неактивне». «Надіслати посилання» спершу знімає блокування." },
  not_joined: { title: "Не зайшла в канал", hint: "Право Hub є понад добу, але в каналі її немає. Причина — у рядку; «Надіслати посилання» видає нове." },
  no_right: { title: "Підписка без права", hint: "Оплачена підписка Hub чинна, а права на канал немає. Зазвичай виправляє найближчий тік; якщо ні — видайте доступ вручну в картці людини." },
  double_paying: { title: "Платить двічі", hint: "Активні підписки і в ZenEdu, і в Hub. Скасуйте одну з них (зазвичай ZenEdu), щоб людина не платила двічі." },
};

const NAME = sql.raw(`coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.username, p.telegram_user_id::text)`);
const ACTIVE_RIGHT = (alias: string) => sql.raw(`${alias}.revoked_at is null and (${alias}.valid_until is null or ${alias}.valid_until > now())`);

type Row = { person_id: number; name: string; username: string | null; telegram_user_id: string | number; resource_key: string | null; detail: string | null; at: string | null };
const map = (kind: ConflictKind, rows: Row[]): Conflict[] => rows.map((r) => ({ kind, personId: r.person_id, name: r.name, username: r.username, telegramUserId: Number(r.telegram_user_id), resourceKey: r.resource_key, detail: r.detail ?? "", at: r.at }));

/** Усі конфлікти; resourceKey — лише для цього каналу (подвійна оплата — для каналів, які дає оффер Hub). */
export async function zenHubConflicts(resourceKey?: string): Promise<Conflict[]> {
  const d = db(); const grace = await accessGraceHours();
  const allow = sql.raw(subscriptionAllowsSql("s", grace));
  const chans = sql`(select key from resources where kind in ('telegram_channel','telegram_group') and is_active ${resourceKey ? sql`and key = ${resourceKey}` : sql``})`;
  const live = sql`exists (select 1 from payment_attempts pa where pa.subscription_id = s.id and pa.mode = 'live' and pa.status = 'approved')`;
  const notInChat = sql`not exists (select 1 from memberships mj where mj.person_id = e.person_id and mj.resource_key = e.resource_key and mj.status = 'joined')`;

  const removed = (await d.execute(sql`
    select distinct on (e.person_id, e.resource_key) e.person_id, e.resource_key, ${NAME} as name, p.username, p.telegram_user_id,
      case when (x.payload->>'banned')::boolean then 'заблокував' else 'виключив' end || ' адміністратор ' || coalesce(x.payload->>'by', '?') as detail, x.created_at as at
    from entitlements e join persons p on p.id = e.person_id
    join events x on x.person_id = e.person_id and x.type = 'channel.removed_by_other' and x.payload->>'resource' = e.resource_key and x.created_at > now() - interval '60 days'
    where e.resource_key in ${chans} and ${ACTIVE_RIGHT("e")} and ${notInChat}
      and not exists (select 1 from events j where j.person_id = e.person_id and j.type = 'channel.joined' and j.payload->>'resource' = e.resource_key and j.created_at > x.created_at)
    order by e.person_id, e.resource_key, x.created_at desc`)).rows as Row[];
  const removedKeys = new Set(removed.map((r) => `${r.person_id}:${r.resource_key}`));

  const banned = ((await d.execute(sql`
    select distinct on (e.person_id, e.resource_key) e.person_id, e.resource_key, ${NAME} as name, p.username, p.telegram_user_id,
      'у Telegram заблокована' || case when m.kicked_at is not null then ' з ' || to_char(m.kicked_at at time zone 'Europe/Kyiv', 'DD.MM.YYYY') else '' end as detail, m.updated_at as at
    from entitlements e join persons p on p.id = e.person_id
    join memberships m on m.person_id = e.person_id and m.resource_key = e.resource_key and m.status = 'kicked'
    where e.resource_key in ${chans} and ${ACTIVE_RIGHT("e")}
      and not exists (select 1 from events u where u.person_id = e.person_id and u.type = 'channel.unbanned' and u.payload->>'resource' = e.resource_key and u.created_at > m.updated_at)
    order by e.person_id, e.resource_key`)).rows as Row[]).filter((r) => !removedKeys.has(`${r.person_id}:${r.resource_key}`));
  const bannedKeys = new Set(banned.map((r) => `${r.person_id}:${r.resource_key}`));

  const notJoined = ((await d.execute(sql`
    select distinct on (e.person_id, e.resource_key) e.person_id, e.resource_key, ${NAME} as name, p.username, p.telegram_user_id,
      case
        when last.type = 'channel.invite_undelivered' then 'не запускала Hub-бот: посилання нікуди доставити'
        when last.type = 'channel.invite_failed' then 'Telegram не дав створити посилання: ' || left(coalesce(last.payload->>'error', ''), 80)
        when m.status = 'left' then 'вийшла з каналу (сама або її виключили без бану)'
        when m.status = 'invited' and m.invite_expires_at < now() then 'посилання прострочене, не зайшла'
        when m.status = 'invited' then 'посилання надіслано, ще не зайшла'
        when coalesce((r.config->>'enforce')::boolean, false) = false then 'автоматика каналу вимкнена: Hub посилань не надсилає'
        else 'посилання ще не надсилалось'
      end as detail, e.created_at as at
    from entitlements e join persons p on p.id = e.person_id join resources r on r.key = e.resource_key
    left join memberships m on m.person_id = e.person_id and m.resource_key = e.resource_key
    left join lateral (select ev.type, ev.payload from events ev where ev.person_id = e.person_id and ev.type in ('channel.invited','channel.invite_undelivered','channel.invite_failed') and ev.payload->>'resource' = e.resource_key order by ev.created_at desc limit 1) last on true
    where e.resource_key in ${chans} and ${ACTIVE_RIGHT("e")} and e.created_at < now() - interval '1 day' and ${notInChat}
      and coalesce(m.status, 'none') <> 'kicked'
    order by e.person_id, e.resource_key, e.created_at`)).rows as Row[]).filter((r) => !removedKeys.has(`${r.person_id}:${r.resource_key}`) && !bannedKeys.has(`${r.person_id}:${r.resource_key}`));

  const noRight = (await d.execute(sql`
    select distinct on (s.person_id, r.key) s.person_id, r.key as resource_key, ${NAME} as name, p.username, p.telegram_user_id,
      'оффер «' || pl.name || '», підписка до ' || coalesce(to_char(s.current_period_end at time zone 'Europe/Kyiv', 'DD.MM.YYYY'), 'безстроково') as detail, s.started_at as at
    from subscriptions s join persons p on p.id = s.person_id join plans pl on pl.id = s.plan_id
    join resources r on pl.entitlements ? r.key and r.key in ${chans}
    where s.source = 'hub' and ${allow} and ${live}
      and not exists (select 1 from entitlements e where e.person_id = s.person_id and e.resource_key = r.key and ${ACTIVE_RIGHT("e")})
    order by s.person_id, r.key`)).rows as Row[];

  const double = (await d.execute(sql`
    select distinct on (s.person_id) s.person_id, r.key as resource_key, ${NAME} as name, p.username, p.telegram_user_id,
      'ZenEdu: «' || coalesce(zo.name, 'клуб') || '» до ' || coalesce(to_char(z.current_period_end at time zone 'Europe/Kyiv', 'DD.MM.YYYY'), '—')
        || '; Hub: «' || pl.name || '» до ' || coalesce(to_char(s.current_period_end at time zone 'Europe/Kyiv', 'DD.MM.YYYY'), '—') as detail, s.started_at as at
    from subscriptions s join persons p on p.id = s.person_id join plans pl on pl.id = s.plan_id
    join resources r on pl.entitlements ? r.key and r.key in ${chans}
    join subscriptions z on z.person_id = s.person_id and z.source = 'zenedu' and z.status in ('active','trialing') and not coalesce(z.cancel_at_period_end, false)
      and (z.current_period_end is null or z.current_period_end > now())
    left join offers zo on zo.id = z.offer_id
    where s.source = 'hub' and s.status in ('active','trialing') and not coalesce(s.cancel_at_period_end, false) and ${allow} and ${live}
    order by s.person_id, r.key`)).rows as Row[];

  return [...map("removed_by_other", removed), ...map("banned", banned), ...map("not_joined", notJoined), ...map("no_right", noRight), ...map("double_paying", double)];
}
