import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { and, desc, eq, sql } from "drizzle-orm";
import { createHash } from "crypto";
import { db, schema } from "@/db";
import { enroll, matchEntry, markClick } from "./funnels";

const { persons, identities, subscriptions, plans, events, bots } = schema;

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
    if (payload) { const f = await matchEntry("start", payload); if (f) { await enroll(f.id, personId, "start:" + payload); return; } }
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

  bot.callbackQuery(/^fs:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    const p = await db().select({ id: persons.id }).from(persons).where(eq(persons.telegramUserId, ctx.from.id));
    if (p[0]) await markClick(Number(ctx.match[1]), p[0].id);
  });

  bot.on("message", async (ctx) => {
    if (!ctx.from) return;
    const personId = await upsertFrom(ctx.from, ctx.chat.id);
    await db().insert(events).values({ personId, type: "bot.message", source: "hub", payload: { text: ctx.message.text ?? null, message_id: ctx.message.message_id, has_media: !ctx.message.text } });
    if (ctx.message.text) { const f = await matchEntry("keyword", ctx.message.text); if (f) { await enroll(f.id, personId, "keyword"); return; } }
    await ctx.reply("Дякую! Повідомлення отримано, команда відповість у робочі години.");
  });

  bot.on("my_chat_member", async (ctx) => {
    const st = ctx.myChatMember.new_chat_member.status;
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
