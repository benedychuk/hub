import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { GrammyError, InlineKeyboard, InputMediaBuilder } from "grammy";
import { createHmac } from "crypto";
import { db, schema } from "@/db";
import { payLink } from "./payments";
import type { BroadcastAudience, BroadcastButton } from "@/db/schema";
import { getBot, BOT_KEY, appUrl, botToken } from "./bot";
import { adminTelegramId } from "./auth";
import { addTag, enroll, processDue, onCommand, stopEnrollment, escapeHtml } from "./funnels";

const { broadcasts, broadcastRecipients, broadcastClicks, persons, identities, media, events, funnelEnrollments, offers } = schema;

export type Broadcast = typeof broadcasts.$inferSelect;
export type Recipient = typeof broadcastRecipients.$inferSelect;

export const BUTTON_COLORS: { key: NonNullable<BroadcastButton["color"]>; label: string; style?: "primary" | "success" | "danger" }[] = [
  { key: "default", label: "Звичайна" }, { key: "primary", label: "Синя", style: "primary" }, { key: "success", label: "Зелена", style: "success" }, { key: "danger", label: "Червона", style: "danger" },
];
export const STATUS_UA: Record<string, [string, string]> = { draft: ["Чернетка", "mute"], scheduled: ["Заплановано", "moon"], sending: ["Надсилається", "warn"], sent: ["Надіслано", "good"], cancelled: ["Скасовано", "mute"], deleted: ["Видалено", "crit"], failed: ["Помилка", "crit"] };
export const SUB_STATUSES: [string, string][] = [["active", "Active"], ["trialing", "Trial"], ["past_due", "Past due"], ["cancelled", "Cancelled"], ["expired", "Expired"], ["none", "Без підписки"]];

// ---------- аудиторія ----------
/** Умова вибору людей: усі, хто запустив Hub-бот і не заблокував його, звужена фільтрами. Псевдоніми: p = persons, i = identities. */
export function audienceWhere(a: BroadcastAudience) {
  const parts = [sql`i.bot_key = ${BOT_KEY} and i.chat_id is not null and i.blocked_at is null`];
  if (a.onlyAdmin) parts.push(sql`p.telegram_user_id = ${adminTelegramId()}`);
  if (a.customer === "customer") parts.push(sql`exists (select 1 from orders o where o.person_id = p.id and o.status = 'paid')`);
  if (a.customer === "not") parts.push(sql`not exists (select 1 from orders o where o.person_id = p.id and o.status = 'paid')`);
  if (a.subStatus?.length) {
    const st = a.subStatus.filter((s) => s !== "none"); const none = a.subStatus.includes("none");
    const cur = sql`(select s.status from subscriptions s where s.person_id = p.id order by (s.status in ('active','trialing','past_due')) desc, s.updated_at desc limit 1)`;
    const c = st.length ? sql`${cur} in (${sql.join(st.map((x) => sql`${x}`), sql`, `)})` : sql`false`;
    parts.push(none ? sql`(${c} or ${cur} is null)` : c);
  }
  if (a.tagsAny?.length) parts.push(sql`p.tags ?| array[${sql.join(a.tagsAny.map((t) => sql`${t}`), sql`, `)}]::text[]`);
  if (a.tagsAll?.length) parts.push(sql`p.tags @> ${JSON.stringify(a.tagsAll)}::jsonb`);
  if (a.tagsNone?.length) parts.push(sql`not (p.tags ?| array[${sql.join(a.tagsNone.map((t) => sql`${t}`), sql`, `)}]::text[])`);
  if (a.funnelIn?.length) parts.push(sql`exists (select 1 from funnel_enrollments e where e.person_id = p.id and e.funnel_id in (${sql.join(a.funnelIn.map((x) => sql`${x}`), sql`, `)}))`);
  if (a.funnelNotIn?.length) parts.push(sql`not exists (select 1 from funnel_enrollments e where e.person_id = p.id and e.funnel_id in (${sql.join(a.funnelNotIn.map((x) => sql`${x}`), sql`, `)}))`);
  if (a.planIds?.length) parts.push(sql`exists (select 1 from subscriptions s where s.person_id = p.id and s.status in ('active','trialing','past_due') and s.plan_id in (${sql.join(a.planIds.map((x) => sql`${x}`), sql`, `)}))`);
  if (a.offerIds?.length) parts.push(sql`exists (select 1 from subscriptions s where s.person_id = p.id and s.status in ('active','trialing','past_due') and s.offer_id in (${sql.join(a.offerIds.map((x) => sql`${x}`), sql`, `)}))`);
  if (a.entitlements?.length) parts.push(sql`exists (select 1 from entitlements en where en.person_id = p.id and en.revoked_at is null and (en.valid_until is null or en.valid_until > now()) and en.resource_key in (${sql.join(a.entitlements.map((x) => sql`${x}`), sql`, `)}))`);
  if (a.activeDays) parts.push(sql`coalesce(i.last_message_at, i.started_at) > now() - (${a.activeDays}::int * interval '1 day')`);
  if (a.startedAfter) parts.push(sql`i.started_at >= ${a.startedAfter}::text::timestamptz`);
  if (a.startedBefore) parts.push(sql`i.started_at < ${a.startedBefore}::text::timestamptz + interval '1 day'`);
  if (a.excludeIds?.length) parts.push(sql`p.id not in (${sql.join(a.excludeIds.map((x) => sql`${x}`), sql`, `)})`);
  let w = sql.join(parts, sql` and `);
  if (a.includeIds?.length) w = sql`((${w}) or (p.id in (${sql.join(a.includeIds.map((x) => sql`${x}`), sql`, `)}) and i.bot_key = ${BOT_KEY} and i.chat_id is not null and i.blocked_at is null))`;
  return w;
}

export async function countAudience(a: BroadcastAudience) {
  const r = await db().execute(sql`select count(distinct p.id)::int as c from persons p join identities i on i.person_id = p.id where ${audienceWhere(a)}`);
  return Number((r.rows[0] as { c: number }).c);
}
export type AudienceRow = { id: number; first_name: string | null; last_name: string | null; username: string | null; telegram_user_id: number; customer: boolean; sub_status: string | null };
export async function previewAudience(a: BroadcastAudience, limit = 50, offset = 0) {
  const r = await db().execute(sql`select distinct p.id, p.first_name, p.last_name, p.username, p.telegram_user_id,
      exists (select 1 from orders o where o.person_id = p.id and o.status = 'paid') as customer,
      (select s.status from subscriptions s where s.person_id = p.id order by (s.status in ('active','trialing','past_due')) desc, s.updated_at desc limit 1) as sub_status
    from persons p join identities i on i.person_id = p.id where ${audienceWhere(a)} order by p.id desc limit ${limit} offset ${offset}`);
  return r.rows as AudienceRow[];
}

/** Знімок отримувачів: фіксує список у момент планування чи надсилання. Повторний виклик лише додає нових. */
export async function snapshotRecipients(id: number) {
  const d = db();
  const [b] = await d.select().from(broadcasts).where(eq(broadcasts.id, id)); if (!b) return 0;
  await d.execute(sql`insert into broadcast_recipients (broadcast_id, person_id, status) select distinct ${id}::int, p.id, 'pending' from persons p join identities i on i.person_id = p.id where ${audienceWhere(b.audience)} on conflict do nothing`);
  const [t] = await d.select({ c: sql<number>`count(*)::int` }).from(broadcastRecipients).where(eq(broadcastRecipients.broadcastId, id));
  await d.update(broadcasts).set({ totalCount: t.c, updatedAt: new Date() }).where(eq(broadcasts.id, id));
  return t.c;
}

// ---------- зміст ----------
type Person = typeof persons.$inferSelect;
/** Змінні в тексті: {first_name} {last_name} {name} {username} {telegram_id}. Значення екрануються для HTML. */
export function renderText(text: string, p: Person) {
  const v: Record<string, string> = {
    first_name: p.firstName ?? "", last_name: p.lastName ?? "", name: [p.firstName, p.lastName].filter(Boolean).join(" ") || p.username || "",
    username: p.username ? "@" + p.username : "", telegram_id: String(p.telegramUserId),
  };
  return text.replace(/\{(first_name|last_name|name|username|telegram_id)\}/g, (_, k) => escapeHtml(v[k] ?? ""));
}

function sign(payload: string) { return createHmac("sha256", process.env.SESSION_SECRET ?? botToken()).update("bc:" + payload).digest("hex").slice(0, 16); }
/** Токен редиректу для кнопки-посилання: r<recipientId> або p<broadcastId> (перегляд), номер кнопки, підпис. */
export function linkToken(kind: "r" | "p", id: number, btn: number) { const p = `${kind}${id}.${btn}`; return `${p}.${sign(p)}`; }
export function parseLinkToken(token: string) {
  const m = token.match(/^([rp])(\d+)\.(\d+)\.([a-f0-9]{16})$/); if (!m) return null;
  if (sign(`${m[1]}${m[2]}.${m[3]}`) !== m[4]) return null;
  return { kind: m[1] as "r" | "p", id: Number(m[2]), btn: Number(m[3]) };
}

export function keyboardFor(b: Broadcast, ref: { kind: "r" | "p"; id: number }) {
  if (!b.buttons?.length) return undefined;
  const kb = new InlineKeyboard();
  b.buttons.forEach((btn, i) => {
    const style = BUTTON_COLORS.find((c) => c.key === (btn.color ?? "default"))?.style;
    const cb = `bc${ref.kind === "p" ? "p" : ""}:${ref.id}:${i}`;
    type Btn = Parameters<InlineKeyboard["add"]>[0];
    let row: Btn;
    if (btn.type === "link" || btn.type === "payment") {
      const url = btn.url && (/^https?:\/\//i.test(btn.url) || btn.url.startsWith("hub:")) ? btn.url : ""; // hub:<key> — оффер Hub, персональне посилання підставляється при кліку
      row = btn.directLink && url && !url.startsWith("hub:") ? { text: btn.text, url } : url ? { text: btn.text, url: `${appUrl()}/r/${linkToken(ref.kind, ref.id, i)}` } : { text: btn.text, callback_data: cb };
    } else if (btn.type === "miniapp" && btn.url) row = { text: btn.text, web_app: { url: btn.url } };
    else row = { text: btn.text, callback_data: cb };
    kb.add(style ? { ...row, style } : row).row();
  });
  return kb;
}

const CAPTIONABLE = ["photo", "video", "animation", "audio", "voice", "document"];
type Media = typeof media.$inferSelect;

/** Надсилає розсилку одній людині. Повертає id повідомлень або кидає помилку Telegram. */
export async function sendBroadcastMessage(b: Broadcast, chatId: number, person: Person, meds: Media[], ref: { kind: "r" | "p"; id: number }) {
  const api = getBot().api;
  const body = renderText(b.text ?? "", person);
  const kb = keyboardFor(b, ref);
  const opts = { protect_content: b.protectContent, parse_mode: "HTML" as const };
  const ordered = (b.attachments ?? []).map((id) => meds.find((m) => m.id === id)).filter(Boolean) as Media[];
  const captionable = ordered.filter((m) => CAPTIONABLE.includes(m.kind));
  const others = ordered.filter((m) => !captionable.includes(m));
  const ids: number[] = []; let mainId: number | null = null;
  for (const m of others) {
    const r = m.kind === "video_note" ? await api.sendVideoNote(chatId, m.fileId, { protect_content: b.protectContent }) : await api.sendSticker(chatId, m.fileId, { protect_content: b.protectContent });
    ids.push(r.message_id);
  }
  const withCaption = b.attachedToText && captionable.length >= 1 && body.length <= 1024;
  if (captionable.length === 1) {
    const m = captionable[0]; const caption = withCaption && body ? body : undefined; const rm = withCaption || !body ? kb : undefined;
    const sp = { has_spoiler: b.spoiler };
    const r = m.kind === "photo" ? await api.sendPhoto(chatId, m.fileId, { caption, reply_markup: rm, ...opts, ...sp })
      : m.kind === "video" ? await api.sendVideo(chatId, m.fileId, { caption, reply_markup: rm, ...opts, ...sp })
      : m.kind === "animation" ? await api.sendAnimation(chatId, m.fileId, { caption, reply_markup: rm, ...opts, ...sp })
      : m.kind === "audio" ? await api.sendAudio(chatId, m.fileId, { caption, reply_markup: rm, ...opts })
      : m.kind === "voice" ? await api.sendVoice(chatId, m.fileId, { caption, reply_markup: rm, ...opts })
      : await api.sendDocument(chatId, m.fileId, { caption, reply_markup: rm, ...opts });
    if (rm) mainId = r.message_id; else ids.push(r.message_id);
    if (rm && caption) return { mainId, extra: ids };
    if (rm && !body) return { mainId, extra: ids };
  } else if (captionable.length > 1) {
    const group = captionable.filter((m) => ["photo", "video"].includes(m.kind)).slice(0, 10);
    if (group.length > 1) {
      const albumCaption = withCaption && !kb && Boolean(body); // підпис на альбомі лише без кнопок, інакше текст із кнопками йде окремо
      const items = group.map((m, i) => { const cap = albumCaption && i === 0 ? { caption: body, parse_mode: "HTML" as const } : {}; return m.kind === "photo" ? InputMediaBuilder.photo(m.fileId, { has_spoiler: b.spoiler, ...cap }) : InputMediaBuilder.video(m.fileId, { has_spoiler: b.spoiler, ...cap }); });
      const r = await api.sendMediaGroup(chatId, items, { protect_content: b.protectContent }); r.forEach((x) => ids.push(x.message_id));
    }
    for (const m of captionable.filter((m) => !group.includes(m))) {
      const r = m.kind === "audio" ? await api.sendAudio(chatId, m.fileId, opts) : m.kind === "voice" ? await api.sendVoice(chatId, m.fileId, opts) : m.kind === "animation" ? await api.sendAnimation(chatId, m.fileId, opts) : await api.sendDocument(chatId, m.fileId, opts);
      ids.push(r.message_id);
    }
    if (withCaption && !kb && body && group.length > 1) return { mainId: ids[0], extra: ids.slice(1) };
  }
  if (body || kb) {
    const r = await api.sendMessage(chatId, body || "…", { reply_markup: kb, link_preview_options: { is_disabled: b.disablePreview }, ...opts });
    mainId = r.message_id;
  } else if (ids.length) mainId = ids.shift()!;
  return { mainId, extra: ids };
}

// ---------- відправка чергою ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PER_SECOND = 20; // ліміт Telegram ~30/с для різних чатів; тримаємо запас

function classifyError(e: unknown): { kind: "blocked" | "retry" | "fatal"; msg: string; retryAfter?: number } {
  if (e instanceof GrammyError) {
    const d = e.description.toLowerCase();
    if (e.error_code === 403 || d.includes("chat not found") || d.includes("user is deactivated") || d.includes("bot was blocked")) return { kind: "blocked", msg: e.description };
    if (e.error_code === 429) return { kind: "retry", msg: e.description, retryAfter: e.parameters?.retry_after ?? 2 };
    if (e.error_code >= 500) return { kind: "retry", msg: e.description };
    return { kind: "fatal", msg: e.description };
  }
  const msg = String(e).slice(0, 200);
  return { kind: /fetch|network|timeout|ECONNRESET/i.test(msg) ? "retry" : "fatal", msg };
}

/** Головний цикл: переводить заплановані в надсилання, розсилає порціями в межах бюджету часу, завершує, чистить видалені. */
export async function processBroadcasts(budgetMs = 45_000) {
  const d = db(); const t0 = Date.now(); const left = () => budgetMs - (Date.now() - t0);
  const now = new Date();
  // 1. заплановані, чий час настав
  const due = await d.select().from(broadcasts).where(and(eq(broadcasts.status, "scheduled"), lte(broadcasts.scheduledAt, now)));
  for (const b of due) { await snapshotRecipients(b.id); await d.update(broadcasts).set({ status: "sending", startedAt: now, updatedAt: now }).where(and(eq(broadcasts.id, b.id), eq(broadcasts.status, "scheduled"))); }
  // 2. зависли в «sending» понад 10 хв (функція перервалась): не надсилаємо повторно, щоб не було дублів
  await d.execute(sql`update broadcast_recipients set status = 'failed', error = 'перервано під час надсилання' where status = 'sending' and claimed_at < now() - interval '10 minutes'`);
  let sent = 0, failed = 0;
  const active = await d.select().from(broadcasts).where(eq(broadcasts.status, "sending")).orderBy(asc(broadcasts.startedAt));
  for (const b of active) {
    const meds = b.attachments?.length ? await d.select().from(media).where(inArray(media.id, b.attachments)) : [];
    while (left() > 3000) {
      const claimed = (await d.execute(sql`update broadcast_recipients set status = 'sending', claimed_at = now(), attempts = attempts + 1
        where id in (select id from broadcast_recipients where broadcast_id = ${b.id} and status = 'pending' order by id limit 20 for update skip locked) returning id, person_id, attempts`)).rows as { id: number; person_id: number; attempts: number }[];
      if (!claimed.length) break;
      const people = await d.select({ p: persons, chatId: identities.chatId, blockedAt: identities.blockedAt }).from(persons).innerJoin(identities, and(eq(identities.personId, persons.id), eq(identities.botKey, BOT_KEY))).where(inArray(persons.id, claimed.map((c) => c.person_id)));
      for (const c of claimed) {
        const row = people.find((x) => x.p.id === c.person_id);
        if (!row?.chatId || row.blockedAt) { await d.update(broadcastRecipients).set({ status: "failed", error: "бот не запущений або заблокований" }).where(eq(broadcastRecipients.id, c.id)); failed++; continue; }
        const started = Date.now();
        try {
          const r = await sendBroadcastMessage(b, row.chatId, row.p, meds, { kind: "r", id: c.id });
          await d.update(broadcastRecipients).set({ status: "sent", telegramMessageId: r.mainId, extraMessageIds: r.extra, sentAt: new Date(), error: null }).where(eq(broadcastRecipients.id, c.id));
          sent++;
        } catch (e) {
          const ce = classifyError(e);
          if (ce.kind === "blocked") { await d.update(broadcastRecipients).set({ status: "failed", error: ce.msg }).where(eq(broadcastRecipients.id, c.id)); await d.update(identities).set({ blockedAt: new Date() }).where(and(eq(identities.personId, c.person_id), eq(identities.botKey, BOT_KEY))); failed++; }
          else if (ce.kind === "retry" && c.attempts < 3) { await d.update(broadcastRecipients).set({ status: "pending", error: ce.msg }).where(eq(broadcastRecipients.id, c.id)); if (ce.retryAfter) await sleep(Math.min(ce.retryAfter, 5) * 1000); }
          else { await d.update(broadcastRecipients).set({ status: "failed", error: ce.msg }).where(eq(broadcastRecipients.id, c.id)); failed++; }
        }
        const wait = 1000 / PER_SECOND - (Date.now() - started); if (wait > 0) await sleep(wait);
        if (left() < 1500) break;
      }
      await refreshCounts(b.id);
    }
    // завершено, якщо не лишилось pending/sending
    const [rest] = await d.select({ c: sql<number>`count(*)::int` }).from(broadcastRecipients).where(and(eq(broadcastRecipients.broadcastId, b.id), inArray(broadcastRecipients.status, ["pending", "sending"])));
    if (rest.c === 0) { await refreshCounts(b.id); await d.update(broadcasts).set({ status: "sent", finishedAt: new Date(), updatedAt: new Date() }).where(eq(broadcasts.id, b.id)); }
    if (left() < 3000) break;
  }
  // 3. видалення у підписників (до 48 год після надсилання)
  let deleted = 0;
  if (left() > 3000) {
    const rows = (await d.execute(sql`select r.id, r.telegram_message_id, r.extra_message_ids, i.chat_id from broadcast_recipients r join broadcasts b on b.id = r.broadcast_id
      join identities i on i.person_id = r.person_id and i.bot_key = ${BOT_KEY} where b.status = 'deleted' and r.status = 'sent' and r.deleted_at is null limit 200`)).rows as { id: number; telegram_message_id: number | null; extra_message_ids: number[]; chat_id: number | null }[];
    for (const r of rows) {
      for (const mid of [r.telegram_message_id, ...(r.extra_message_ids ?? [])]) if (mid && r.chat_id) await getBot().api.deleteMessage(r.chat_id, mid).catch(() => null);
      await d.update(broadcastRecipients).set({ status: "deleted", deletedAt: new Date() }).where(eq(broadcastRecipients.id, r.id)); deleted++;
      await sleep(40); if (left() < 1500) break;
    }
  }
  return { due: due.length, active: active.length, sent, failed, deleted };
}

export async function refreshCounts(id: number) {
  await db().execute(sql`update broadcasts set
    total_count = (select count(*) from broadcast_recipients r where r.broadcast_id = ${id}),
    sent_count = (select count(*) from broadcast_recipients r where r.broadcast_id = ${id} and r.status in ('sent','deleted')),
    failed_count = (select count(*) from broadcast_recipients r where r.broadcast_id = ${id} and r.status = 'failed'),
    clicked_count = (select count(*) from broadcast_recipients r where r.broadcast_id = ${id} and r.clicked_at is not null),
    updated_at = now() where id = ${id}`);
}

// ---------- кліки й дії кнопок ----------
async function recordClick(recipientId: number, btn: number) {
  const d = db();
  const [r] = await d.select().from(broadcastRecipients).where(eq(broadcastRecipients.id, recipientId)); if (!r) return null;
  await d.insert(broadcastClicks).values({ broadcastId: r.broadcastId, recipientId, personId: r.personId, button: btn });
  if (!r.clickedAt) await d.update(broadcastRecipients).set({ clickedAt: new Date(), clickedButton: btn }).where(eq(broadcastRecipients.id, recipientId));
  await refreshCounts(r.broadcastId);
  const [b] = await d.select().from(broadcasts).where(eq(broadcasts.id, r.broadcastId));
  const button = b?.buttons?.[btn];
  if (button) { for (const t of button.tags ?? []) await addTag(r.personId, t, "broadcast", { broadcastId: r.broadcastId, button: button.text }); await d.insert(events).values({ personId: r.personId, type: "broadcast.click", source: "broadcast", payload: { broadcastId: r.broadcastId, name: b!.name, button: button.text } }); }
  return { r, b, button };
}

/** Клік по кнопці-посиланню через редирект /r/<token>. Повертає URL або null. */
export async function resolveLink(token: string) {
  const t = parseLinkToken(token); if (!t) return null;
  if (t.kind === "p") { const [b] = await db().select().from(broadcasts).where(eq(broadcasts.id, t.id)); return b?.buttons?.[t.btn]?.url ?? null; }
  const res = await recordClick(t.id, t.btn);
  const url = res?.button?.url ?? null;
  if (url?.startsWith("hub:") && res) return payLink(res.r.personId, url.slice(4), "first"); // оффер Hub: персональне посилання на оплату
  return url;
}

/** Кнопка-дія (callback bc:<recipientId>:<idx> або bcp:<broadcastId>:<idx> для перегляду). Повертає текст відповіді або null. */
export async function onBroadcastButton(kind: "r" | "p", id: number, btn: number, personId: number): Promise<string | null> {
  const d = db();
  let b: Broadcast | undefined; let recipient: Recipient | null = null;
  if (kind === "p") [b] = await d.select().from(broadcasts).where(eq(broadcasts.id, id));
  else { const res = await recordClick(id, btn); b = res?.b; recipient = res?.r ?? null; }
  const button = b?.buttons?.[btn]; if (!b || !button) return null;
  const replies: string[] = [];
  for (const a of button.actions ?? []) {
    try {
      if (a.type === "send_text" && a.text) { const [p] = await d.select().from(persons).where(eq(persons.id, personId)); const [i] = await d.select().from(identities).where(and(eq(identities.personId, personId), eq(identities.botKey, BOT_KEY))); if (i?.chatId && p) await getBot().api.sendMessage(i.chatId, renderText(a.text, p), { parse_mode: "HTML", protect_content: b.protectContent }); }
      else if (a.type === "call_command" && a.command) { const r = await onCommand(personId, a.command.replace(/^\//, "")); if (r) replies.push(r); }
      else if (a.type === "add_funnel" && a.funnelId) { await enroll(a.funnelId, personId, "broadcast"); await processDue(5); }
      else if (a.type === "remove_funnel" && a.funnelId) { const rows = await d.select({ id: funnelEnrollments.id }).from(funnelEnrollments).where(and(eq(funnelEnrollments.funnelId, a.funnelId), eq(funnelEnrollments.personId, personId), eq(funnelEnrollments.status, "active"))); for (const e of rows) await stopEnrollment(e.id, "broadcast"); }
      else if (a.type === "add_tags") for (const t of a.tags ?? []) await addTag(personId, t, "broadcast", { broadcastId: b.id });
      else if (a.type === "remove_tags" && a.tags?.length) { await d.update(persons).set({ tags: sql`(select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(${persons.tags}) x where not (x <@ ${JSON.stringify(a.tags)}::jsonb))` }).where(eq(persons.id, personId)); await d.insert(events).values({ personId, type: "tag.removed", source: "broadcast", payload: { tags: a.tags, broadcastId: b.id } }); }
      else if (a.type === "add_offer" && a.offerId) { const [o] = await d.select().from(offers).where(eq(offers.id, a.offerId)); await addTag(personId, `offer:${a.offerId}`, "broadcast", { broadcastId: b.id }); if (o?.link) replies.push(`${o.name}\n${o.link}`); }
      else if (a.type === "delete_message" && recipient) { const [i] = await d.select().from(identities).where(and(eq(identities.personId, personId), eq(identities.botKey, BOT_KEY))); for (const mid of [recipient.telegramMessageId, ...(recipient.extraMessageIds ?? [])]) if (mid && i?.chatId) await getBot().api.deleteMessage(i.chatId, mid).catch(() => null); await d.update(broadcastRecipients).set({ status: "deleted", deletedAt: new Date() }).where(eq(broadcastRecipients.id, recipient.id)); }
    } catch (e) { await d.insert(events).values({ personId, type: "broadcast.action_error", source: "broadcast", payload: { broadcastId: b.id, action: a.type, error: String(e).slice(0, 200) } }); }
  }
  return replies.length ? replies.join("\n\n") : null;
}

// ---------- керування ----------
/** Перегляд: надсилає розсилку адміністратору без запису в отримувачі. */
export async function previewToAdmin(id: number) {
  const d = db();
  const [b] = await d.select().from(broadcasts).where(eq(broadcasts.id, id)); if (!b) return "Розсилку не знайдено";
  const [row] = await d.select({ p: persons, chatId: identities.chatId }).from(persons).innerJoin(identities, and(eq(identities.personId, persons.id), eq(identities.botKey, BOT_KEY))).where(eq(persons.telegramUserId, adminTelegramId()));
  if (!row?.chatId) return "Натисніть /start у Hub-боті з акаунта ADMIN_TELEGRAM_ID";
  const meds = b.attachments?.length ? await d.select().from(media).where(inArray(media.id, b.attachments)) : [];
  try { await sendBroadcastMessage(b, row.chatId, row.p, meds, { kind: "p", id: b.id }); return null; } catch (e) { return String(e).slice(0, 300); }
}

export async function startSending(id: number) {
  const d = db();
  const [b] = await d.select().from(broadcasts).where(eq(broadcasts.id, id)); if (!b || !["draft", "scheduled"].includes(b.status)) return;
  await snapshotRecipients(id);
  await d.update(broadcasts).set({ status: "sending", scheduledAt: b.scheduledAt ?? new Date(), startedAt: new Date(), updatedAt: new Date() }).where(eq(broadcasts.id, id));
}
export async function schedule(id: number, at: Date) {
  const d = db();
  await d.update(broadcasts).set({ status: "scheduled", scheduledAt: at, updatedAt: new Date() }).where(and(eq(broadcasts.id, id), inArray(broadcasts.status, ["draft", "scheduled"])));
  await resnapshot(id);
}
/** Перебудувати список запланованої розсилки після зміни фільтрів: прибирає тих, хто ще не отримав і більше не підходить, додає нових. */
export async function resnapshot(id: number) {
  await db().delete(broadcastRecipients).where(and(eq(broadcastRecipients.broadcastId, id), eq(broadcastRecipients.status, "pending")));
  return snapshotRecipients(id);
}
export async function cancelScheduled(id: number) {
  const d = db();
  await d.delete(broadcastRecipients).where(and(eq(broadcastRecipients.broadcastId, id), eq(broadcastRecipients.status, "pending")));
  await d.update(broadcasts).set({ status: "draft", scheduledAt: null, totalCount: 0, updatedAt: new Date() }).where(and(eq(broadcasts.id, id), eq(broadcasts.status, "scheduled")));
}
/** Видалити у підписників: можливо лише впродовж 48 год після надсилання (обмеження Telegram). Саме видалення робить тік порціями. */
export async function deleteFromSubscribers(id: number) {
  const d = db();
  const [b] = await d.select().from(broadcasts).where(eq(broadcasts.id, id)); if (!b || b.status !== "sent") return "Видаляти можна лише надіслану розсилку";
  if (b.finishedAt && Date.now() - b.finishedAt.getTime() > 48 * 3600_000) return "Минуло понад 48 годин: Telegram більше не дозволяє видаляти ці повідомлення";
  await d.update(broadcasts).set({ status: "deleted", deletedAt: new Date(), updatedAt: new Date() }).where(eq(broadcasts.id, id));
  return null;
}
export async function duplicate(id: number) {
  const d = db();
  const [b] = await d.select().from(broadcasts).where(eq(broadcasts.id, id)); if (!b) return null;
  const [n] = await d.insert(broadcasts).values({ name: `${b.name} (копія)`, botKey: b.botKey, audience: b.audience, text: b.text, attachments: b.attachments, attachedToText: b.attachedToText, spoiler: b.spoiler, buttons: b.buttons, protectContent: b.protectContent, disablePreview: b.disablePreview, status: "draft" }).returning({ id: broadcasts.id });
  return n.id;
}

/** Статистика для списку. */
export function deliveredLabel(b: Broadcast) { return ["sending", "sent", "deleted"].includes(b.status) || (b.status === "failed") ? `${b.sentCount} / ${b.totalCount}` : b.status === "scheduled" ? `0 / ${b.totalCount}` : ""; }
export function clickedLabel(b: Broadcast) { if (!b.buttons?.length || !b.sentCount) return "—"; return `${Math.round((b.clickedCount / b.sentCount) * 100)}%`; }
