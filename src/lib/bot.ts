import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { and, desc, eq, sql } from "drizzle-orm";
import { createHash } from "crypto";
import { db, schema } from "@/db";
import { adminTelegramId } from "./auth";
import { onBroadcastButton } from "./broadcasts";
import { payLink, cancelAtEnd, resumeSub, paymentsAllowedFor } from "./payments";
import { grantByLink, priceLabel, accessLabel } from "./offers";
import { coverFile, escapeHtml } from "./funnels";
import { enroll, matchEntry, onButtonClick, stopAllForPerson, enrollDirectAccess, onFreeText, onCommand, processDue, sendIntro } from "./funnels";
import { onChatMember, onJoinRequest, onMyChatMember } from "./telegram-access";

const { persons, identities, subscriptions, plans, events, bots, media } = schema;

export const BOT_KEY = "hub";

export function botToken() {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return t;
}
export function webhookSecret() { return createHash("sha256").update("wh:" + botToken()).digest("hex").slice(0, 48); }
export function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (process.env.VERCEL_URL) return "https://" + process.env.VERCEL_URL;
  return "http://localhost:3000";
}

const money = (p: string | number, cur: string) => `${Number(p).toLocaleString("uk-UA")} ${cur === "USD" ? "$" : cur === "EUR" ? "€" : "грн"}`;
const STATUS_UA: Record<string, string> = { trialing: "пробний період", active: "активна", past_due: "очікує оплати", paused: "на паузі", cancelled: "скасована", expired: "завершена" };

async function upsertFrom(from: { id: number; first_name?: string; last_name?: string; username?: string }, chatId: number) {
  const d = db();
  const r = await d.insert(persons).values({ telegramUserId: from.id, firstName: from.first_name ?? null, lastName: from.last_name ?? null, username: from.username ?? null, lastActiveAt: new Date() })
    .onConflictDoUpdate({ target: persons.telegramUserId, set: { firstName: from.first_name ?? null, lastName: from.last_name ?? null, username: from.username ?? null, lastActiveAt: new Date(), updatedAt: new Date() } })
    .returning({ id: persons.id });
  const personId = r[0].id;
  await d.insert(identities).values({ personId, botKey: BOT_KEY, chatId, lastMessageAt: new Date() })
    .onConflictDoUpdate({ target: [identities.personId, identities.botKey], set: { chatId, lastMessageAt: new Date(), blockedAt: null } });
  return personId;
}

let _bot: Bot | null = null;
export function getBot() {
  if (_bot) return _bot;
  const bot = new Bot(botToken());

  bot.command("start", async (ctx) => {
    if (!ctx.from) return;
    const personId = await upsertFrom(ctx.from, ctx.chat.id);
    const payload = ctx.match?.toString() || "";
    await db().insert(events).values({ personId, type: "bot.start", source: "hub", payload: { payload } });
    if (/^o_\d+$/.test(payload)) { await sendOfferMessage(ctx.chat.id, personId, Number(payload.slice(2))); return; } // оффер у боті: оформлення + кнопка оплати
    if (payload.startsWith("g_")) { // посилання доступу до оффера без оплати
      const r = await grantByLink(payload.slice(2), personId);
      await ctx.reply(r.ok ? `Доступ до «${r.plan.name}» відкрито${r.until ? ` до ${r.until.toLocaleDateString("uk-UA")}` : ""}. Матеріали з'являться в цьому боті за хвилину.` : r.reason);
      await processDue(5); return;
    }
    if (payload) { const f = await matchEntry("start", payload); if (f) { if (await sendIntro(f.id, personId)) return; await enroll(f.id, personId, "start:" + payload); await processDue(5); return; } }
    if (await enrollDirectAccess(personId)) { await processDue(5); return; }
    const sub = await db().select().from(subscriptions).where(eq(subscriptions.personId, personId)).orderBy(desc(subscriptions.updatedAt)).limit(1);
    const active = sub[0] && ["active", "trialing", "past_due"].includes(sub[0].status);
    const kb = new InlineKeyboard().text("Мої підписки", "subs").row().text("Тарифи", "plans");
    await ctx.reply(
      `Привіт, ${ctx.from.first_name ?? ""}! Це бот клубу Марії Кравчук.\n\n` +
      (active ? `Ваша підписка ${STATUS_UA[sub[0].status]}${sub[0].currentPeriodEnd ? `, наступне списання ${sub[0].currentPeriodEnd.toLocaleDateString("uk-UA")}` : ""}.` : "Підписки поки немає. Подивіться тарифи нижче."),
      { reply_markup: kb },
    );
  });

  type Ctx = { from?: { id: number; first_name?: string; last_name?: string; username?: string }; chat?: { id: number }; reply: (t: string, o?: object) => Promise<unknown> };
  const periodWord = (days: number) => days >= 360 ? "рік" : days >= 90 ? `${Math.round(days / 30)} міс` : days >= 28 ? "міс" : days >= 7 ? `${Math.round(days / 7)} тиж` : `${days} дн`;
  const showSubs = async (ctx: Ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const personId = await upsertFrom(ctx.from, ctx.chat.id);
    const subs = await db().select({ s: subscriptions, pl: plans }).from(subscriptions).leftJoin(plans, eq(plans.id, subscriptions.planId)).where(eq(subscriptions.personId, personId)).orderBy(desc(subscriptions.updatedAt));
    if (!subs.length) { await ctx.reply("Підписок поки немає. Натисніть «Тарифи», щоб обрати."); return; }
    const kb = new InlineKeyboard();
    const lines = subs.map(({ s, pl }) => {
      const name = pl?.name ?? (s.source === "zenedu" ? "Підписка клубу" : "Підписка Hub");
      const live = ["active", "trialing", "past_due"].includes(s.status);
      const until = s.currentPeriodEnd ? s.currentPeriodEnd.toLocaleDateString("uk-UA") : null;
      let line: string;
      if (s.kind === "grant") line = `• ${name} — доступ ${until ? `до ${until}` : "безстроково"}${live ? "" : ` (${STATUS_UA[s.status] ?? s.status})`}`;
      else if (s.kind === "one_time") line = `• ${name} — ${money(s.price, s.currency)} разово — ${STATUS_UA[s.status] ?? s.status}` + (until ? `\n  доступ до ${until}` : "");
      else line = `• ${name} — ${money(s.price, s.currency)} / ${periodWord(s.periodDays)} — ${STATUS_UA[s.status] ?? s.status}` + (until && live ? `\n  наступне списання: ${until}` : "") + `\n  оплат: ${s.paymentsCount} · джерело: ${s.source === "zenedu" ? "ZenEdu" : "Hub"}`;
      if (s.source === "hub" && s.kind === "subscription") {
        if (live) {
          if (s.cancelAtPeriodEnd) kb.text(`Відновити продовження: ${name}`, `sub:resume:${s.id}`).row(); else kb.text(`Вимкнути продовження: ${name}`, `sub:cancel:${s.id}`).row();
          if (pl) kb.url(`Змінити картку: ${name}`, payLink(personId, pl.key, "card")).row();
        } else if (["expired", "cancelled", "paused"].includes(s.status)) kb.text(`Відновити підписку: ${name}`, `sub:resume:${s.id}`).row();
      }
      return line + (s.cancelAtPeriodEnd && live ? "\n  продовження вимкнено: доступ до кінця оплаченого періоду" : "");
    });
    kb.text("Тарифи", "plans");
    await ctx.reply("Ваші підписки:\n\n" + lines.join("\n\n"), { reply_markup: kb });
  };
  bot.callbackQuery(/^sub:(cancel|resume)(?::(\d+))?$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from || !ctx.chat) return;
    const personId = await upsertFrom(ctx.from, ctx.chat.id);
    const id = Number(ctx.match[2] ?? 0);
    const [hub] = await db().select().from(subscriptions).where(and(eq(subscriptions.personId, personId), eq(subscriptions.source, "hub"), id ? eq(subscriptions.id, id) : eq(subscriptions.kind, "subscription"))).orderBy(desc(subscriptions.updatedAt)).limit(1);
    if (!hub) { await ctx.reply("Підписки Hub ще немає. Оберіть тариф: /plans"); return; }
    if (ctx.match[1] === "cancel") await cancelAtEnd(hub.id, "bot"); else await resumeSub(hub.id, "bot");
  });
  bot.command("subscriptions", (ctx) => showSubs(ctx as unknown as Ctx));
  bot.callbackQuery("subs", async (ctx) => { await ctx.answerCallbackQuery(); await showSubs(ctx as unknown as Ctx); });

  const showPlans = async (ctx: Ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const personId = await upsertFrom(ctx.from, ctx.chat.id);
    const list = await db().select().from(plans).where(and(eq(plans.isActive, true), eq(plans.showInBot, true))).orderBy(plans.sortOrder, plans.id);
    if (!list.length) { await ctx.reply("Тарифи ще не налаштовані."); return; }
    const text = list.map((p) => `${p.isFeatured ? "⭐ " : ""}${p.name} — ${priceLabel(p)}${p.paymentType === "one_time" ? ` разово · доступ ${accessLabel(p)}` : ""}` + (p.paymentType !== "one_time" && p.trialDays ? `\n  пробний: ${p.trialDays} дн${p.trialPrice ? ` за ${money(p.trialPrice, p.currency)}` : ""}` : "")).join("\n\n");
    const allowed = await paymentsAllowedFor(personId);
    if (!allowed) { await ctx.reply("Тарифи клубу:\n\n" + text + "\n\nОплата в цьому боті з'явиться після переїзду з ZenEdu."); return; }
    const kb = new InlineKeyboard();
    for (const p of list) kb.url(`${p.design?.buttonText || "Оплатити"}: ${p.name} · ${money(p.price, p.currency)}`, payLink(personId, p.key, "first")).row();
    await ctx.reply("Тарифи клубу:\n\n" + text + "\n\nОплата на захищеній сторінці WayForPay. Скасувати можна будь-коли: /subscriptions.", { reply_markup: kb });
  };
  bot.command("plans", (ctx) => showPlans(ctx as unknown as Ctx));
  bot.callbackQuery("plans", async (ctx) => { await ctx.answerCallbackQuery(); await showPlans(ctx as unknown as Ctx); });

  bot.callbackQuery(/^bc(p?):(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const p = await db().select({ id: persons.id }).from(persons).where(eq(persons.telegramUserId, ctx.from.id));
    if (p[0]) { const reply = await onBroadcastButton(ctx.match[1] ? "p" : "r", Number(ctx.match[2]), Number(ctx.match[3]), p[0].id); if (reply) await ctx.reply(reply, { link_preview_options: { is_disabled: true } }); }
  });
  bot.callbackQuery(/^fstart:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const p = await db().select({ id: persons.id }).from(persons).where(eq(persons.telegramUserId, ctx.from.id));
    if (p[0]) { await enroll(Number(ctx.match[1]), p[0].id, "intro"); await processDue(5); }
  });
  bot.callbackQuery(/^fs:(\d+)(?::(\d+))?$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const p = await db().select({ id: persons.id }).from(persons).where(eq(persons.telegramUserId, ctx.from.id));
    if (p[0]) { const reply = await onButtonClick(Number(ctx.match[1]), Number(ctx.match[2] ?? 0), p[0].id); if (reply) await ctx.reply(reply); }
  });

  bot.on("message", async (ctx) => {
    if (!ctx.from) return;
    const personId = await upsertFrom(ctx.from, ctx.chat.id);
    const m = ctx.message;
    // Медіа від адміністратора потрапляє в бібліотеку і далі використовується у кроках воронок і розсилках.
    const adminId = adminTelegramId();
    const med = m.video_note ? { kind: "video_note", f: m.video_note, w: m.video_note.length, h: m.video_note.length, d: m.video_note.duration }
      : m.photo ? { kind: "photo", f: m.photo[m.photo.length - 1], w: m.photo[m.photo.length - 1].width, h: m.photo[m.photo.length - 1].height }
      : m.video ? { kind: "video", f: m.video, w: m.video.width, h: m.video.height, d: m.video.duration, mime: m.video.mime_type }
      : m.animation ? { kind: "animation", f: m.animation, w: m.animation.width, h: m.animation.height, d: m.animation.duration }
      : m.voice ? { kind: "voice", f: m.voice, d: m.voice.duration } : m.audio ? { kind: "audio", f: m.audio, d: m.audio.duration, mime: m.audio.mime_type }
      : m.document ? { kind: "document", f: m.document, mime: m.document.mime_type } : m.sticker ? { kind: "sticker", f: m.sticker } : null;
    await db().insert(events).values({ personId, type: "bot.message", source: "hub", payload: { text: m.text ?? m.caption ?? null, message_id: m.message_id, media: med ? { kind: med.kind, file_id: med.f.file_id } : null } });
    if (med && ctx.from.id === adminId) {
      const f = med.f as { file_id: string; file_unique_id: string; file_size?: number; file_name?: string };
      const [row] = await db().insert(media).values({ kind: med.kind, fileId: f.file_id, fileUniqueId: f.file_unique_id, title: f.file_name ?? null, caption: m.caption ?? null, width: med.w ?? null, height: med.h ?? null, duration: med.d ?? null, fileSize: f.file_size ?? null, mimeType: med.mime ?? null, fromPersonId: personId })
        .onConflictDoUpdate({ target: media.fileUniqueId, set: { fileId: f.file_id, caption: m.caption ?? null } }).returning({ id: media.id });
      const label: Record<string, string> = { video_note: "кружечок", photo: "фото", video: "відео", animation: "GIF", voice: "голосове", audio: "аудіо", document: "файл", sticker: "стікер" };
      await ctx.reply(`Збережено в бібліотеку медіа: ${label[med.kind] ?? med.kind} #${row.id}${med.w ? ` · ${med.w}×${med.h}` : ""}${med.d ? ` · ${med.d} с` : ""}. Його можна вставити в крок воронки або розсилку.`);
      return;
    }
    if (m.text && /^(стоп|stop)$/i.test(m.text.trim())) { const n = await stopAllForPerson(personId, "keyword:stop"); if (n) { await ctx.reply("Добре, більше не надсилатиму цю серію повідомлень."); return; } }
    if (m.text?.startsWith("/")) { const r = await onCommand(personId, m.text.slice(1).split(/[\s@]/)[0]); if (r !== null) { if (r) await ctx.reply(r); return; } }
    if (m.text || m.caption || med) { if (await onFreeText(personId, m.text ?? m.caption ?? `[${med?.kind ?? "медіа"}]`)) { await ctx.reply("Дякую, відповідь збережено 🤍"); return; } }
    if (m.text) { const f = await matchEntry("keyword", m.text); if (f) { await enroll(f.id, personId, "keyword"); await processDue(5); return; } }
    await ctx.reply("Дякую! Повідомлення отримано, команда відповість у робочі години.");
  });

  bot.on("chat_member", async (ctx) => {
    const u = ctx.chatMember;
    await onChatMember(u.chat.id, u.new_chat_member.user, u.new_chat_member.status, u.invite_link?.name);
  });
  bot.on("chat_join_request", async (ctx) => {
    await onJoinRequest(ctx.chatJoinRequest.chat.id, ctx.chatJoinRequest.from);
  });

  bot.on("my_chat_member", async (ctx) => {
    const st = ctx.myChatMember.new_chat_member.status;
    if (ctx.myChatMember.chat.type !== "private") { await onMyChatMember(ctx.myChatMember.chat as { id: number; title?: string; type: string }, st); return; }
    const from = ctx.from; if (!from) return;
    const p = await db().select({ id: persons.id }).from(persons).where(eq(persons.telegramUserId, from.id));
    if (!p[0]) return;
    await db().update(identities).set({ blockedAt: st === "kicked" ? new Date() : null }).where(and(eq(identities.personId, p[0].id), eq(identities.botKey, BOT_KEY)));
    await db().insert(events).values({ personId: p[0].id, type: st === "kicked" ? "bot.blocked" : "bot.unblocked", source: "hub", payload: {} });
  });

  bot.catch((err) => { console.error("bot error", err.message); });
  _bot = bot;
  return bot;
}

/** Повідомлення оффера в боті (ZenEdu «Bot payment»): зображення, заголовок, опис, ціна й персональна кнопка оплати. */
export async function sendOfferMessage(chatId: number, personId: number, planId: number) {
  const api = getBot().api;
  const [pl] = await db().select().from(plans).where(eq(plans.id, planId));
  if (!pl || !pl.isActive) { await api.sendMessage(chatId, "Цей оффер зараз недоступний."); return false; }
  const d = pl.design ?? {};
  const title = d.titleMode === "custom" && d.title ? d.title : pl.name;
  const allowed = await paymentsAllowedFor(personId);
  const text = `<b>${escapeHtml(title)}</b>` + (d.description ? "\n\n" + d.description : "") + `\n\n${escapeHtml(priceLabel(pl))}${pl.paymentType === "one_time" ? ` · доступ ${escapeHtml(accessLabel(pl))}` : ""}` + (allowed ? "" : "\n\nОплата в цьому боті з'явиться після переїзду з ZenEdu.");
  const kb = allowed ? new InlineKeyboard().url(d.buttonText || "Оплатити", payLink(personId, pl.key, "first")) : undefined;
  const photo = coverFile(d.image);
  if (photo && text.length <= 1024) await api.sendPhoto(chatId, photo, { caption: text, parse_mode: "HTML", reply_markup: kb });
  else { if (photo) await api.sendPhoto(chatId, photo); await api.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: kb, link_preview_options: { is_disabled: true } }); }
  await db().insert(events).values({ personId, type: "offer.shown", source: "hub", payload: { planId } });
  return true;
}

export function botWebhook() {
  return webhookCallback(getBot(), "std/http", { secretToken: webhookSecret() });
}

export async function installWebhook() {
  const bot = getBot();
  const url = `${appUrl()}/api/telegram/${BOT_KEY}`;
  await bot.api.setWebhook(url, { secret_token: webhookSecret(), allowed_updates: ["message", "callback_query", "my_chat_member", "chat_member", "chat_join_request"], drop_pending_updates: false });
  await bot.api.setMyCommands([
    { command: "start", description: "Почати" },
    { command: "subscriptions", description: "Мої підписки" },
    { command: "plans", description: "Тарифи" },
  ]);
  const me = await bot.api.getMe();
  await db().insert(bots).values({ key: BOT_KEY, name: me.first_name, username: me.username, role: "club", webhookSetAt: new Date() })
    .onConflictDoUpdate({ target: bots.key, set: { name: me.first_name, username: me.username, webhookSetAt: new Date() } });
  return { url, username: me.username };
}

export async function webhookInfo() {
  try { return await getBot().api.getWebhookInfo(); } catch (e) { return { error: String(e) }; }
}

export async function sendToPerson(personId: number, text: string, opts: { buttons?: { text: string; url: string }[]; protect?: boolean; disablePreview?: boolean; html?: boolean } = {}) {
  const idn = await db().select().from(identities).where(and(eq(identities.personId, personId), eq(identities.botKey, BOT_KEY)));
  if (!idn[0]?.chatId || idn[0].blockedAt) return false;
  const kb = opts.buttons?.length ? new InlineKeyboard() : undefined;
  opts.buttons?.forEach((b) => kb!.url(b.text, b.url).row());
  await getBot().api.sendMessage(idn[0].chatId, text, { reply_markup: kb, protect_content: opts.protect, parse_mode: opts.html ? "HTML" : undefined, link_preview_options: { is_disabled: opts.disablePreview ?? true } });
  return true;
}

export { sql };
