import { sql } from "drizzle-orm";
import { db } from "@/db";
import { clubAccess } from "../club";
import { zenHubConflicts } from "../conflicts";

/**
 * Картка людини для асистентки: усе, що потрібно для рішення, коротким текстом (дати — за Києвом).
 * Лише читає. Повертає також структуровані дані, якими користуються інструменти (id підписок, платежів).
 */
const kyiv = (v: string | Date | null | undefined, time = false) => v ? new Date(v).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric", ...(time ? { hour: "2-digit", minute: "2-digit" } : {}) }) : "—";
const STATUS: Record<string, string> = { active: "активна", trialing: "пробний період", past_due: "списання не пройшло", cancelled: "скасована", paused: "на паузі", refunded: "повернено кошти", expired: "закінчилась" };

export type CardData = {
  personId: number; name: string; firstName: string | null; telegramUserId: number;
  hubSubs: { id: number; plan: string; status: string; end: string | null; cancelAtEnd: boolean }[];
  lastHubPayment: { attemptId: number; amount: string; currency: string; at: string; subscriptionId: number | null; daysAgo: number } | null;
  refundsCount: number; clubMember: boolean; channelKeys: string[]; hasShchyro: boolean; hasCabinet: boolean;
  offers: { id: number; name: string; price: string; currency: string }[];
};

export async function buildCard(personId: number): Promise<{ text: string; data: CardData }> {
  const d = db();
  const q = async <T,>(s: ReturnType<typeof sql>) => (await d.execute(s)).rows as T[];
  const [p] = await q<{ id: number; first_name: string | null; last_name: string | null; username: string | null; telegram_user_id: string | number; created_at: string }>(sql`select id, first_name, last_name, username, telegram_user_id, created_at from persons where id = ${personId}`);
  if (!p) throw new Error("людину не знайдено");
  const [club, subs, orders, attempts, mems, ents, shchyro, cab, streams, tickets, actions, offers, conflicts] = await Promise.all([
    clubAccess(personId),
    q<{ id: number; source: string; name: string | null; status: string; kind: string; period_days: number; current_period_end: string | null; cancel_at_period_end: boolean; next_charge_at: string | null; price: string; currency: string }>(sql`
      select s.id, s.source, coalesce(pl.name, zo.name) as name, s.status, s.kind, s.period_days, s.current_period_end, s.cancel_at_period_end, s.next_charge_at, s.price::text, s.currency
      from subscriptions s left join plans pl on pl.id = s.plan_id left join offers zo on zo.id = s.offer_id where s.person_id = ${personId} order by s.current_period_end desc nulls first limit 10`),
    q<{ source: string; offer_name: string | null; price: string; currency: string; at: string; type: string | null; status: string }>(sql`
      select o.source, coalesce(o.offer_name, pl.name) as offer_name, o.price::text, o.currency, coalesce(o.paid_at, o.created_at) as at, o.type, o.status
      from orders o left join plans pl on pl.id = o.plan_id where o.person_id = ${personId} order by coalesce(o.paid_at, o.created_at) desc limit 8`),
    q<{ id: number; amount: string; currency: string; status: string; kind: string; at: string; subscription_id: number | null; plan: string | null }>(sql`
      select pa.id, pa.amount::text, pa.currency, pa.status, pa.kind, coalesce(pa.processed_at, pa.created_at) as at, pa.subscription_id, pl.name as plan
      from payment_attempts pa left join plans pl on pl.id = pa.plan_id
      where pa.person_id = ${personId} and pa.mode = 'live' and pa.status in ('approved','refunded') and pa.kind in ('first','renewal','manual') order by coalesce(pa.processed_at, pa.created_at) desc limit 8`),
    q<{ resource_key: string; name: string; status: string }>(sql`select m.resource_key, r.name, m.status from memberships m join resources r on r.key = m.resource_key where m.person_id = ${personId}`),
    q<{ resource_key: string; name: string; kind: string; valid_until: string | null }>(sql`select e.resource_key, r.name, r.kind, e.valid_until from entitlements e join resources r on r.key = e.resource_key where e.person_id = ${personId} and e.revoked_at is null and (e.valid_until is null or e.valid_until > now())`),
    import("../shchyro").then((m) => m.shchyroEntitledFor(personId)).catch(() => null),
    q<{ id: number }>(sql`select id from onboarding_accounts where person_id = ${personId} limit 1`),
    import("../streams").then(async (m) => ({ cur: await m.cabinetStream(), arch: await m.cabinetArchive() })).catch(() => ({ cur: null, arch: [] })),
    q<{ id: number; kind: string; status: string; summary: string; team_note: string | null; created_at: string }>(sql`select id, kind, status, summary, team_note, created_at from assistant_tickets where person_id = ${personId} order by created_at desc limit 5`),
    q<{ type: string; payload: Record<string, unknown>; created_at: string }>(sql`select type, payload, created_at from events where person_id = ${personId} and type like 'assistant.%' order by created_at desc limit 8`),
    q<{ id: number; name: string; price: string; currency: string; payment_type: string; period: string; interval_count: number }>(sql`select id, name, price::text, currency, payment_type, period, interval_count from plans where is_active and show_in_bot and (sales_end_at is null or sales_end_at > now()) order by sort_order, id limit 15`),
    zenHubConflicts().then((all) => all.filter((c) => c.personId === personId)).catch(() => []),
  ]);
  const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.username || "—";
  const hubSubs = subs.filter((s) => s.source === "hub").map((s) => ({ id: s.id, plan: s.name ?? "Підписка Hub", status: s.status, end: s.current_period_end, cancelAtEnd: s.cancel_at_period_end }));
  const lastOk = attempts.find((a) => a.status === "approved");
  const refundsCount = attempts.filter((a) => a.status === "refunded").length;
  const channelEnts = ents.filter((e) => e.kind === "telegram_channel" || e.kind === "telegram_group");
  const PER: Record<string, string> = { day: "дн", week: "тиж", month: "міс", quarter: "кв", year: "р" };
  const lines = [
    `ЛЮДИНА: ${name}${p.username ? ` (@${p.username})` : ""}, Telegram ID ${p.telegram_user_id}, у Hub з ${kyiv(p.created_at)}. Зараз ${kyiv(new Date(), true)} (Київ).`,
    `КЛУБ: ${club.member ? `доступ є (${club.via === "zenedu" ? "підписка ZenEdu" : club.via === "hub" ? "підписка Hub" : club.via === "grant" ? "право на канал" : "команда"}${club.until ? `, до ${kyiv(club.until)}` : ""})` : club.hadClub ? "доступу немає: підписка закінчилась" : "підписки клубу не було"}${club.refunded ? "; раніше було повернення коштів" : ""}.`,
    `ПІДПИСКИ:${subs.length ? "" : " немає"}`,
    ...subs.map((s) => `- [${s.source === "hub" ? `Hub #${s.id}` : "ZenEdu"}] ${s.name ?? "—"}: ${STATUS[s.status] ?? s.status}${s.current_period_end ? `, оплачено до ${kyiv(s.current_period_end)}` : ""}${s.cancel_at_period_end ? ", автопродовження скасовано" : s.source === "hub" && s.kind === "subscription" && s.next_charge_at ? `, наступне списання ${kyiv(s.next_charge_at)}` : ""}, ${s.price} ${s.currency}/${s.period_days} дн`),
    `ОПЛАТИ (останні):${orders.length ? "" : " немає"}`,
    ...orders.map((o) => `- ${kyiv(o.at, true)} [${o.source === "hub" ? "Hub" : "ZenEdu"}] ${o.offer_name ?? "—"}: ${o.price} ${o.currency}${o.status !== "paid" ? ` (${o.status})` : ""}`),
    `ПЛАТЕЖІ HUB:${attempts.length ? "" : " немає"}`,
    ...attempts.map((a) => `- #${a.id} ${kyiv(a.at, true)} ${a.amount} ${a.currency} ${a.plan ?? ""} ${a.status === "refunded" ? "(ПОВЕРНЕНО)" : ""}`.trim()),
    `ПОВЕРНЕНЬ КОШТІВ РАНІШЕ: ${refundsCount}.`,
    `КАНАЛ КЛУБУ: ${channelEnts.length ? `право Hub є (${channelEnts.map((e) => `${e.name}${e.valid_until ? ` до ${kyiv(e.valid_until)}` : ""}`).join(", ")})` : "права Hub немає (учасниць ZenEdu в канал пускає ZenEdu)"}; у каналі: ${mems.length ? mems.map((m) => `${m.name} - ${m.status === "joined" ? "в каналі" : m.status === "invited" ? "запрошена, не зайшла" : m.status === "kicked" ? "виключена/заблокована" : "немає"}`).join(", ") : "даних немає"}.`,
    ...(conflicts.length ? [`КОНФЛІКТИ ДОСТУПУ: ${conflicts.map((c) => `${c.kind}: ${c.detail}`).join("; ")}.`] : []),
    `«ЩИРО»: ${shchyro ? "доступ є" : "доступу немає"}.`,
    `КАБІНЕТ ПЛАТФОРМИ: ${cab.length ? "є" : "ще немає (створиться при вході)"}.`,
    `ЕТЕРИ: ${streams.cur ? `найближчий «${streams.cur.title}» ${kyiv(streams.cur.starts_at, true)} (${streams.cur.state === "live" ? "іде зараз" : streams.cur.state === "today" ? "сьогодні" : streams.cur.state === "recent" ? "уже відбувся" : "заплановано"})` : "найближчого немає в системі"}; записи в кабінеті: ${streams.arch.length ? streams.arch.map((a) => `«${a.title}» ${kyiv(a.starts_at)}`).join(", ") : "немає"}.`,
    `ЗВЕРНЕННЯ ДО КОМАНДИ:${tickets.length ? "" : " не було"}`,
    ...tickets.map((t) => `- #${t.id} ${kyiv(t.created_at, true)} [${t.kind}, ${t.status === "open" ? "відкрите" : t.status === "done" ? "вирішене" : "відхилене"}] ${t.summary.slice(0, 200)}${t.team_note ? `\n  ВКАЗІВКА КОМАНДИ: ${t.team_note}` : ""}`),
    ...(actions.length ? ["ТВОЇ ДІЇ РАНІШЕ:", ...actions.map((a) => `- ${kyiv(a.created_at, true)} ${String(a.payload?.label ?? a.type)}`)] : []),
    `ЩО МОЖНА ЗАПРОПОНУВАТИ (send_offer, plan_id):${offers.length ? "" : " офферів немає"}`,
    ...offers.map((o) => `- plan_id ${o.id}: ${o.name}, ${o.price} ${o.currency}${o.payment_type === "subscription" ? `/${o.interval_count > 1 ? o.interval_count + " " : ""}${PER[o.period] ?? o.period}` : " разово"}`),
  ];
  const lastHubPayment = lastOk ? { attemptId: lastOk.id, amount: lastOk.amount, currency: lastOk.currency, at: lastOk.at, subscriptionId: lastOk.subscription_id, daysAgo: (Date.now() - new Date(lastOk.at).getTime()) / 86400_000 } : null;
  return {
    text: lines.join("\n"),
    data: { personId, name, firstName: p.first_name, telegramUserId: Number(p.telegram_user_id), hubSubs, lastHubPayment, refundsCount, clubMember: club.member, channelKeys: channelEnts.map((e) => e.resource_key), hasShchyro: Boolean(shchyro), hasCabinet: cab.length > 0, offers: offers.map((o) => ({ id: o.id, name: o.name, price: o.price, currency: o.currency })) },
  };
}
