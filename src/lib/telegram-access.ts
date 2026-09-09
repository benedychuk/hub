import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { InlineKeyboard } from "grammy";
import { db, schema } from "@/db";
import { getBot, BOT_KEY } from "./bot";

const { resources, entitlements, memberships, identities, persons, events, subscriptions, plans, settings } = schema;

export type ChannelConfig = {
  chatId?: string; joinMode?: "invite" | "request"; inviteTtlHours?: number; graceDays?: number;
  inviteText?: string; kickText?: string; remindDays?: number; note?: string;
  enforce?: boolean; // автоматика доступу: посилання тим, хто має право, і виключення тих, хто не має. Вимкнено = лише спостереження
};

const CHANNEL_KINDS = ["telegram_channel", "telegram_group"];

async function channelResources() {
  const rows = await db().select().from(resources).where(and(inArray(resources.kind, CHANNEL_KINDS), eq(resources.isActive, true)));
  return rows.map((r) => ({ r, cfg: (r.config ?? {}) as ChannelConfig })).filter((x) => x.cfg.chatId);
}
/** Лише канали, де власник явно увімкнув автоматику доступу. */
async function enforcedResources() { return (await channelResources()).filter((x) => x.cfg.enforce === true); }

async function sendTo(personId: number, text: string, kb?: InlineKeyboard) {
  const [idn] = await db().select().from(identities).where(and(eq(identities.personId, personId), eq(identities.botKey, BOT_KEY)));
  if (!idn?.chatId || idn.blockedAt) return false;
  await getBot().api.sendMessage(idn.chatId, text, { reply_markup: kb, link_preview_options: { is_disabled: true } });
  return true;
}

/** Чинне право людини на ресурс (ручне або з підписки Hub). */
export async function hasEntitlement(personId: number, resourceKey: string) {
  const now = new Date();
  const [e] = await db().select({ id: entitlements.id }).from(entitlements)
    .where(and(eq(entitlements.personId, personId), eq(entitlements.resourceKey, resourceKey), isNull(entitlements.revokedAt), or(isNull(entitlements.validUntil), gt(entitlements.validUntil, now)))).limit(1);
  return Boolean(e);
}

/**
 * Породжує права з активних підписок Hub (тариф → права) і закриває їх, коли підписка завершилась.
 * Права з джерелом subscription живуть рівно стільки, скільки період плюс grace ресурсу.
 */
export async function syncEntitlementsFromSubscriptions() {
  const d = db();
  const rows = await d.select({ s: subscriptions, ents: plans.entitlements }).from(subscriptions).innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.source, "hub"));
  const res = await d.select().from(resources);
  const grace = (key: string) => Number(((res.find((r) => r.key === key)?.config ?? {}) as ChannelConfig).graceDays ?? 0);
  let granted = 0, closed = 0;
  for (const { s, ents } of rows) {
    const active = ["active", "trialing", "past_due"].includes(s.status);
    for (const key of Object.keys(ents ?? {})) {
      const until = s.currentPeriodEnd ? new Date(s.currentPeriodEnd.getTime() + grace(key) * 86400000) : null;
      const [ex] = await d.select().from(entitlements).where(and(eq(entitlements.personId, s.personId), eq(entitlements.resourceKey, key), eq(entitlements.subscriptionId, s.id), isNull(entitlements.revokedAt)));
      if (active) {
        if (!ex) { await d.insert(entitlements).values({ personId: s.personId, resourceKey: key, subscriptionId: s.id, grantedBy: "subscription", quota: ents?.[key] || null, validUntil: until }); granted++; }
        else if ((ex.validUntil?.getTime() ?? 0) !== (until?.getTime() ?? 0)) await d.update(entitlements).set({ validUntil: until }).where(eq(entitlements.id, ex.id));
      } else if (ex && ex.validUntil && ex.validUntil < new Date()) { await d.update(entitlements).set({ revokedAt: new Date() }).where(eq(entitlements.id, ex.id)); closed++; }
    }
  }
  return { granted, closed };
}

/** Видає одноразове посилання в канал усім, хто має право, але ще не в каналі. */
export async function processGrants(limit = 30) {
  const d = db();
  const bot = getBot();
  let invited = 0, skipped = 0, failed = 0;
  for (const { r, cfg } of await enforcedResources()) {
    const now = new Date();
    const due = await d.execute(sql`
      select distinct e.person_id from entitlements e
      left join memberships m on m.person_id = e.person_id and m.resource_key = e.resource_key
      where e.resource_key = ${r.key} and e.revoked_at is null and (e.valid_until is null or e.valid_until > now())
        and (m.id is null or m.status in ('none','left','kicked') or (m.status = 'invited' and m.invite_expires_at < now()))
      limit ${limit}`);
    for (const row of due.rows as { person_id: number }[]) {
      const pid = row.person_id;
      try {
        const ttl = Number(cfg.inviteTtlHours ?? 24);
        const expire = Math.floor(now.getTime() / 1000) + ttl * 3600;
        const link = cfg.joinMode === "request"
          ? await bot.api.createChatInviteLink(cfg.chatId!, { name: `p${pid}`, expire_date: expire, creates_join_request: true })
          : await bot.api.createChatInviteLink(cfg.chatId!, { name: `p${pid}`, expire_date: expire, member_limit: 1 });
        const text = (cfg.inviteText || `Доступ відкрито: ${r.name}.\nПосилання одноразове і діє ${ttl} год.`);
        const ok = await sendTo(pid, text, new InlineKeyboard().url(`Увійти: ${r.name}`, link.invite_link));
        await d.insert(memberships).values({ personId: pid, resourceKey: r.key, status: "invited", inviteLink: link.invite_link, inviteExpiresAt: new Date(expire * 1000), invitedAt: now, note: ok ? null : "людина не запускала Hub-бот, посилання не доставлено", updatedAt: now })
          .onConflictDoUpdate({ target: [memberships.personId, memberships.resourceKey], set: { status: "invited", inviteLink: link.invite_link, inviteExpiresAt: new Date(expire * 1000), invitedAt: now, note: ok ? null : "людина не запускала Hub-бот, посилання не доставлено", updatedAt: now } });
        await d.insert(events).values({ personId: pid, type: ok ? "channel.invited" : "channel.invite_undelivered", source: "hub", payload: { resource: r.key } });
        if (ok) invited++; else skipped++;
      } catch (e) {
        failed++;
        await d.insert(events).values({ personId: pid, type: "channel.invite_failed", source: "hub", payload: { resource: r.key, error: String(e).slice(0, 200) } });
      }
      await new Promise((res) => setTimeout(res, 60));
    }
  }
  return { invited, skipped, failed };
}

/** Виключає з каналу тих, хто в ньому, але права більше не має. Людина може повернутись за новим посиланням. */
export async function processRevocations(limit = 30) {
  const d = db();
  const bot = getBot();
  let kicked = 0, failed = 0;
  for (const { r, cfg } of await enforcedResources()) {
    const due = await d.execute(sql`
      select m.person_id, p.telegram_user_id from memberships m join persons p on p.id = m.person_id
      where m.resource_key = ${r.key} and m.status = 'joined'
        and not exists (select 1 from entitlements e where e.person_id = m.person_id and e.resource_key = m.resource_key and e.revoked_at is null and (e.valid_until is null or e.valid_until > now()))
      limit ${limit}`);
    for (const row of due.rows as { person_id: number; telegram_user_id: number }[]) {
      try {
        await bot.api.banChatMember(cfg.chatId!, row.telegram_user_id);
        await bot.api.unbanChatMember(cfg.chatId!, row.telegram_user_id, { only_if_banned: true });
        await d.update(memberships).set({ status: "kicked", kickedAt: new Date(), updatedAt: new Date() }).where(and(eq(memberships.personId, row.person_id), eq(memberships.resourceKey, r.key)));
        await d.insert(events).values({ personId: row.person_id, type: "channel.kicked", source: "hub", payload: { resource: r.key } });
        await sendTo(row.person_id, cfg.kickText || `Термін доступу до «${r.name}» завершився. Щоб повернутись, поновіть підписку: /plans`).catch(() => null);
        kicked++;
      } catch (e) {
        failed++;
        await d.insert(events).values({ personId: row.person_id, type: "channel.kick_failed", source: "hub", payload: { resource: r.key, error: String(e).slice(0, 200) } });
      }
      await new Promise((res) => setTimeout(res, 60));
    }
  }
  return { kicked, failed };
}

/** Звірка: питаємо Telegram про кожного, хто за нашими даними в каналі. */
export async function reconcile(limit = 200) {
  const d = db();
  const bot = getBot();
  let checked = 0, fixed = 0;
  for (const { r, cfg } of await channelResources()) {
    const rows = await d.select({ m: memberships, tg: persons.telegramUserId }).from(memberships).innerJoin(persons, eq(persons.id, memberships.personId))
      .where(and(eq(memberships.resourceKey, r.key), inArray(memberships.status, ["joined", "invited"]))).limit(limit);
    for (const { m, tg } of rows) {
      try {
        const cm = await bot.api.getChatMember(cfg.chatId!, tg);
        const inChat = ["member", "administrator", "creator", "restricted"].includes(cm.status);
        const next = inChat ? "joined" : m.status === "joined" ? (cm.status === "kicked" ? "kicked" : "left") : m.status;
        if (next !== m.status) { fixed++; await d.update(memberships).set({ status: next, joinedAt: inChat ? m.joinedAt ?? new Date() : m.joinedAt, leftAt: next === "left" ? new Date() : m.leftAt, lastCheckedAt: new Date(), updatedAt: new Date() }).where(eq(memberships.id, m.id)); }
        else await d.update(memberships).set({ lastCheckedAt: new Date() }).where(eq(memberships.id, m.id));
        checked++;
      } catch { /* людина невідома чату — лишаємо як є */ }
      await new Promise((res) => setTimeout(res, 40));
    }
  }
  await d.insert(settings).values({ key: "reconcile.last", value: { at: new Date().toISOString(), checked, fixed } }).onConflictDoUpdate({ target: settings.key, set: { value: { at: new Date().toISOString(), checked, fixed }, updatedAt: new Date() } });
  return { checked, fixed };
}

/** Обробка апдейту chat_member: вступ або вихід учасника. */
export async function onChatMember(chatId: number, user: { id: number; first_name?: string; last_name?: string; username?: string }, newStatus: string, inviteName?: string) {
  const d = db();
  const list = await channelResources();
  const hit = list.find((x) => String(x.cfg.chatId) === String(chatId));
  if (!hit) return;
  const [p] = await d.insert(persons).values({ telegramUserId: user.id, firstName: user.first_name ?? null, lastName: user.last_name ?? null, username: user.username ?? null })
    .onConflictDoUpdate({ target: persons.telegramUserId, set: { updatedAt: new Date() } }).returning({ id: persons.id });
  const inChat = ["member", "administrator", "creator", "restricted"].includes(newStatus);
  const expectedPid = inviteName?.match(/^p(\d+)$/)?.[1];
  const note = expectedPid && Number(expectedPid) !== p.id ? `посилання видавалось людині #${expectedPid}` : null;
  const status = inChat ? "joined" : newStatus === "kicked" ? "kicked" : "left";
  await d.insert(memberships).values({ personId: p.id, resourceKey: hit.r.key, status, joinedAt: inChat ? new Date() : null, leftAt: inChat ? null : new Date(), note, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [memberships.personId, memberships.resourceKey], set: { status, joinedAt: inChat ? new Date() : sql`${memberships.joinedAt}`, leftAt: inChat ? null : new Date(), note, updatedAt: new Date() } });
  await d.insert(events).values({ personId: p.id, type: inChat ? "channel.joined" : "channel.left", source: "hub", payload: { resource: hit.r.key, via: inviteName ?? null, note } });
  if (inChat && !(await hasEntitlement(p.id, hit.r.key)) && hit.cfg.joinMode !== "request") {
    // зайшов без права (переслане посилання чи чужий інвайт) — виключаємо на наступному тіку
    await d.insert(events).values({ personId: p.id, type: "channel.joined_without_access", source: "hub", payload: { resource: hit.r.key } });
  }
}

/** Заявка на вступ (режим request): схвалюємо лише за наявності права. */
export async function onJoinRequest(chatId: number, user: { id: number; first_name?: string; last_name?: string; username?: string }) {
  const d = db();
  const list = await enforcedResources(); // без увімкненої автоматики заявки лишаються на розгляд адміністраторам чату
  const hit = list.find((x) => String(x.cfg.chatId) === String(chatId));
  if (!hit) return;
  const [p] = await d.select({ id: persons.id }).from(persons).where(eq(persons.telegramUserId, user.id));
  const ok = p ? await hasEntitlement(p.id, hit.r.key) : false;
  if (ok) await getBot().api.approveChatJoinRequest(chatId, user.id); else await getBot().api.declineChatJoinRequest(chatId, user.id);
  if (p) await d.insert(events).values({ personId: p.id, type: ok ? "channel.request_approved" : "channel.request_declined", source: "hub", payload: { resource: hit.r.key } });
}

/** Бот додали чи прибрали з каналу або групи: запам'ятовуємо чат, щоб показати його в панелі. */
export async function onMyChatMember(chat: { id: number; title?: string; type: string }, status: string) {
  const d = db();
  const [row] = await d.select().from(settings).where(eq(settings.key, "known_chats"));
  const list = ((row?.value as { id: number; title: string; type: string; status: string; at: string }[]) ?? []).filter((c) => c.id !== chat.id);
  list.push({ id: chat.id, title: chat.title ?? String(chat.id), type: chat.type, status, at: new Date().toISOString() });
  await d.insert(settings).values({ key: "known_chats", value: list }).onConflictDoUpdate({ target: settings.key, set: { value: list, updatedAt: new Date() } });
}

/** Перевірка прав бота в чаті ресурсу. */
export async function botRightsIn(chatId: string) {
  try {
    const bot = getBot();
    const me = await bot.api.getMe();
    const chat = await bot.api.getChat(chatId);
    const cm = await bot.api.getChatMember(chatId, me.id);
    const admin = cm.status === "administrator" || cm.status === "creator";
    const rights = cm.status === "administrator" ? { invite: cm.can_invite_users, restrict: cm.can_restrict_members } : { invite: admin, restrict: admin };
    return { ok: admin && Boolean(rights.invite) && Boolean(rights.restrict), title: (chat as { title?: string }).title ?? chatId, status: cm.status, ...rights };
  } catch (e) { return { ok: false, error: String(e).slice(0, 160) }; }
}

export async function channelStats(resourceKey: string) {
  const d = db();
  const [withRight] = await d.select({ c: sql<number>`count(distinct person_id)::int` }).from(entitlements).where(and(eq(entitlements.resourceKey, resourceKey), isNull(entitlements.revokedAt), or(isNull(entitlements.validUntil), gt(entitlements.validUntil, new Date()))));
  const byStatus = await d.select({ status: memberships.status, c: sql<number>`count(*)::int` }).from(memberships).where(eq(memberships.resourceKey, resourceKey)).groupBy(memberships.status);
  const st = Object.fromEntries(byStatus.map((x) => [x.status, x.c]));
  const [extra] = await d.execute(sql`select count(*)::int as c from memberships m where m.resource_key = ${resourceKey} and m.status = 'joined' and not exists (select 1 from entitlements e where e.person_id = m.person_id and e.resource_key = m.resource_key and e.revoked_at is null and (e.valid_until is null or e.valid_until > now()))`).then((r) => r.rows as { c: number }[]);
  return { withRight: withRight.c, joined: st.joined ?? 0, invited: st.invited ?? 0, kicked: st.kicked ?? 0, left: st.left ?? 0, withoutRight: extra?.c ?? 0 };
}

/** Тік: права з підписок → запрошення → виключення. */
export async function accessTick() {
  const ents = await syncEntitlementsFromSubscriptions();
  const grants = await processGrants();
  const revocations = await processRevocations();
  return { ...ents, ...grants, ...revocations };
}
