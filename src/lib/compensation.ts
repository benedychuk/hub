import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { accessGraceHours, subscriptionAllowsSql } from "./access-rule";
import { enforcedChannelKeys, hasEntitlement, inviteNow } from "./telegram-access";
import { shchyroSettings, SHCHYRO_BOT_URL } from "./shchyro";
import { sendToPerson } from "./bot";

/**
 * Вибачення й компенсація тим, хто оплатив через Hub, але через технічну помилку отримав доступ не одразу.
 * Дні без доступу рахуються від оплати до моменту, коли доступ реально відкрився:
 *  - «Щиро» — перша подія shchyro.granted пізніше ніж за 30 хв після оплати;
 *  - канал — перше успішне запрошення пізніше ніж за 1 год після оплати (або запрошення не було зовсім).
 * Компенсація — подовження підписки Hub на стільки днів (більше з двох). Кожна підписка отримує вибачення один раз
 * (подія access.apology_sent). Це ручна дія адміністратора з підтвердженням, автоматично нічого не надсилається.
 */
export type ApologyCandidate = {
  personId: number; name: string; firstName: string | null; telegramUserId: number; subscriptionId: number; plan: string;
  paidAt: Date; currentEnd: Date | null; days: number; shchyroLateDays: number; channelLateDays: number;
  shchyro: boolean; channels: { key: string; name: string }[]; newEnd: Date | null;
  /** «Щиро» входить в оффер, але ще не відкрито (автоматика вимкнена або черга): вибачення чекає, щоб людина отримала все разом */
  shchyroPending: boolean;
};
const DAY = 86400_000;
// цілі дні на користь людини, але без «+1» за кілька хвилин понад рівну кількість діб
const ceilDays = (ms: number) => Math.max(1, Math.ceil(ms / DAY - 0.05));

export async function apologyCandidates(): Promise<ApologyCandidate[]> {
  const d = db(); const grace = await accessGraceHours();
  const subs = (await d.execute(sql`
    select s.id, s.person_id, s.current_period_end, s.plan_id, pl.name as plan, pl.entitlements as ents, p.telegram_user_id, p.first_name,
      coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.username, p.telegram_user_id::text) as name,
      (select min(pa.processed_at) from payment_attempts pa where pa.subscription_id = s.id and pa.mode = 'live' and pa.status = 'approved') as paid_at
    from subscriptions s join plans pl on pl.id = s.plan_id join persons p on p.id = s.person_id
    where s.source = 'hub' and ${sql.raw(subscriptionAllowsSql("s", grace))}
      and exists (select 1 from payment_attempts pa where pa.subscription_id = s.id and pa.mode = 'live' and pa.status = 'approved')
      and not exists (select 1 from events ev where ev.type = 'access.apology_sent' and (ev.payload->>'subscriptionId')::int = s.id)
    order by s.id`)).rows as { id: number; person_id: number; current_period_end: string | null; plan: string; ents: Record<string, string> | null; telegram_user_id: string | number; first_name: string | null; name: string; paid_at: string | null }[];
  if (!subs.length) return [];
  const st = await shchyroSettings(); const pushed = new Set(st.pushedIds);
  const chanNames = new Map((await d.select({ key: schema.resources.key, name: schema.resources.name }).from(schema.resources)).map((r) => [r.key, r.name]));
  const out: ApologyCandidate[] = [];
  for (const s of subs) {
    const paidAt = new Date(s.paid_at ?? Date.now()); const pid = s.person_id; const tg = Number(s.telegram_user_id);
    // «Щиро»: доступ є зараз, але відкрився із запізненням
    let shchyroLateDays = 0, shchyro = false, shchyroPending = false;
    const wantsShchyro = await hasEntitlementOrPlan(pid, st.resourceKey, s.ents);
    if (wantsShchyro && !pushed.has(tg)) { shchyroPending = true; shchyroLateDays = ceilDays(Date.now() - paidAt.getTime()); }
    if (wantsShchyro && pushed.has(tg)) {
      const [g] = (await d.execute(sql`select min(created_at) as at from events where person_id = ${pid} and type = 'shchyro.granted'`)).rows as { at: string | null }[];
      const grantedAt = g?.at ? new Date(g.at).getTime() : null;
      if (grantedAt && grantedAt - paidAt.getTime() > 30 * 60_000) { shchyroLateDays = ceilDays(grantedAt - paidAt.getTime()); shchyro = true; }
    }
    // канали оффера з увімкненою автоматикою, куди людина ще не зайшла
    let channelLateDays = 0; const channels: { key: string; name: string }[] = [];
    const keys = await enforcedChannelKeys(Object.keys(s.ents ?? {}));
    for (const key of keys) {
      if (!(await hasEntitlement(pid, key))) continue;
      const [m] = (await d.execute(sql`select status from memberships where person_id = ${pid} and resource_key = ${key}`)).rows as { status: string }[];
      const [inv] = (await d.execute(sql`select min(created_at) as at from events where person_id = ${pid} and type = 'channel.invited' and payload->>'resource' = ${key} and created_at >= ${paidAt.toISOString()}`)).rows as { at: string | null }[];
      const firstInvite = inv?.at ? new Date(inv.at).getTime() : null;
      const late = (firstInvite ?? Date.now()) - paidAt.getTime();
      if (late > 3600_000) channelLateDays = Math.max(channelLateDays, ceilDays(late));
      if (m?.status !== "joined") channels.push({ key, name: chanNames.get(key) ?? key });
    }
    const days = Math.max(shchyroLateDays, channelLateDays);
    if (!days && !channels.length && !shchyroPending) continue;
    const currentEnd = s.current_period_end ? new Date(s.current_period_end) : null;
    out.push({ personId: pid, name: s.name, firstName: s.first_name, telegramUserId: tg, subscriptionId: s.id, plan: s.plan, paidAt, currentEnd, days, shchyroLateDays, channelLateDays, shchyro, channels, newEnd: currentEnd && days ? new Date(currentEnd.getTime() + days * DAY) : currentEnd, shchyroPending });
  }
  return out;
}
async function hasEntitlementOrPlan(pid: number, key: string, ents: Record<string, string> | null) {
  return Boolean(ents && key in ents) || hasEntitlement(pid, key);
}

/** Надсилає вибачення, подовжує підписку на дні без доступу, видає нові посилання в канал. */
export async function sendApologies(onlyPersonIds?: number[]) {
  // хто ще чекає на «Щиро» — пропускаємо: вибачення одне, тож надсилаємо, коли доступ уже відкрито
  const d = db(); const list = (await apologyCandidates()).filter((c) => !c.shchyroPending && (!onlyPersonIds?.length || onlyPersonIds.includes(c.personId)));
  let sent = 0, undelivered = 0, invites = 0, extended = 0;
  for (const c of list) {
    if (c.days > 0) {
      await d.execute(sql`update subscriptions set current_period_end = current_period_end + ${c.days} * interval '1 day',
        next_charge_at = case when next_charge_at is not null then next_charge_at + ${c.days} * interval '1 day' end, updated_at = now() where id = ${c.subscriptionId}`);
      await d.insert(schema.events).values({ personId: c.personId, type: "access.compensated", source: "hub", payload: { subscriptionId: c.subscriptionId, days: c.days, until: c.newEnd?.toISOString() ?? null } });
      extended++;
    }
    const lines = [
      `${c.firstName ? `${c.firstName}, в` : "В"}ибачте, будь ласка! Через технічну помилку після оплати доступ відкрився не одразу. Ми все виправили:`,
      ...(c.shchyro ? ["— «Щиро» вже відкрито, кнопка нижче;"] : []),
      ...(c.channels.length ? [`— нове посилання в ${c.channels.length > 1 ? "канали" : "канал"} клубу — у наступному повідомленні.`] : []),
      ...(c.days > 0 ? [`\nОплачені дні без доступу ми додали до вашої підписки: +${c.days} дн.${c.newEnd ? `, тепер вона діє до ${c.newEnd.toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv" })}` : ""}.`] : []),
      "\nДякуємо за терпіння!",
    ];
    const ok = await sendToPerson(c.personId, lines.join("\n"), { buttons: c.shchyro ? [{ text: "Відкрити «Щиро»", url: SHCHYRO_BOT_URL }] : undefined }).catch(() => false);
    if (ok) sent++; else undelivered++;
    for (const ch of c.channels) { const r = await inviteNow(c.personId, ch.key).catch(() => ({ ok: false })); if (r.ok) invites++; }
    await d.insert(schema.events).values({ personId: c.personId, type: "access.apology_sent", source: "hub", payload: { subscriptionId: c.subscriptionId, days: c.days, shchyro: c.shchyro, channels: c.channels.map((x) => x.key), delivered: ok } });
  }
  return { total: list.length, sent, undelivered, invites, extended };
}
