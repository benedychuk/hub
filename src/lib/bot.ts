import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { and, desc, eq, sql } from "drizzle-orm";
import { createHash } from "crypto";
import { db, schema } from "@/db";
import { adminTelegramId } from "./auth";
import { onBroadcastButton } from "./broadcasts";
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
  const showSubs = async (ctx: Ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const personId = await upsertFrom(ctx.from, ctx.chat.id);
    const subs = await db().select().from(subscriptions).where(eq(subscriptions.personId, personId)).orderBy(desc(subscriptions.updatedAt));
    if (!subs.length) { await ctx.reply("Підписок поки немає. Натисніть «Тарифи», щоб обрати."); return; }
    const lines = subs.map((s) => `• ${money(s.price, s.currency)} / ${s.periodDays >= 360 ? "рік" : s.periodDays >= 90 ? "3 міс" : s.periodDays <= 14 ? "2 тижні" : "міс"} — ${STATUS_UA[s.status] ?? s.status}` +
      (s.currentPeriodEnd && ["active", "trialing", "past_due"].includes(s.status) ? `\n  наступне списання: ${s.currentPeriodEnd.toLocaleDateString("uk-UA")}` : "") +
      `\n  оплат: ${s.paymentsCount} · джерело: ${s.source === "zenedu" ? "ZenEdu" : "Hub"}`);
    await ctx.reply("Ваші підписки:\n\n" + lines.join("\n\n") + "\n\nСкасувати або поставити на паузу можна буде тут, коли підписка переїде в Hub.");
  };
  bot.command("subscriptions", (ctx) => showSubs(ctx as unknown as Ctx));
  bot.callbackQuery("subs", async (ctx) => { await ctx.answerCallbackQuery(); await showSubs(ctx as unknown as Ctx); });

  const showPlans = async (ctx: { reply: (t: string, o?: object) => Promise<unknown> }) => {
    const list = await db().select().from(plans).where(eq(plans.isActive, true)).orderBy(plans.sortOrder, plans.id);
    if (!list.length) { await ctx.reply("Тарифи ще не налаштовані."); return; }
    const per: Record<string, string> = { month: "міс", quarter: "3 міс", year: "рік" };
    const text = list.map((p) => `${p.isFeatured ? "⭐ " : ""}${p.name} — ${money(p.price, p.currency)} / ${per[p.period] ?? p.period}` + (p.trialDays ? `\n  пробний: ${p.trialDays} дн${p.trialPrice ? ` за ${money(p.trialPrice, p.currency)}` : ""}` : "") + `\n  ${Object.keys(p.entitlements).length} прав доступу`).join("\n\n");
    await ctx.reply("Тарифи клубу:\n\n" + text + "\n\nОплата в цьому боті з'явиться після переїзду з ZenEdu.");
  };
  bot.command("plans", (ctx) => showPlans(ctx));
  bot.callbackQuery("plans", async (ctx) => { await ctx.answerCallbackQuery(); await showPlans(ctx); });

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

export async function sendToPerson(personId: number, text: string, opts: { buttons?: { text: string; url: string }[]; protect?: boolean; disablePreview?: boolean } = {}) {
  const idn = await db().select().from(identities).where(and(eq(identities.personId, personId), eq(identities.botKey, BOT_KEY)));
  if (!idn[0]?.chatId || idn[0].blockedAt) return false;
  const kb = opts.buttons?.length ? new InlineKeyboard() : undefined;
  opts.buttons?.forEach((b) => kb!.url(b.text, b.url).row());
  await getBot().api.sendMessage(idn[0].chatId, text, { reply_markup: kb, protect_content: opts.protect, link_preview_options: { is_disabled: opts.disablePreview ?? true } });
  return true;
}

export { sql };
