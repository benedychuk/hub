import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ASSISTANT_PROMPT } from "./prompt";
import { buildCard, type CardData } from "./card";
import { chat, llmConfigured, polish, trimToSentence, type ChatMsg, type ToolDef } from "./llm";

/**
 * Асистентка підтримки «Олеся» в Hub-боті (docs/assistant). Етап 1: відповіді, посилання (канал, кабінет, «Щиро», оффер)
 * і звернення команді. Дії з грошима й підписками — етап 2, за окремим вимикачем.
 *
 * Потік: бот кладе людину в чергу (assistant_threads) замість заглушки «Повідомлення отримано…» → щохвилинний cron
 * /api/cron/assistant бере діалоги, де людина не пише вже 20 с, → модель із карткою людини й інструментами → відповідь.
 * Вимикач assistant.enabled за замовчуванням вимкнений: код його не вмикає (правило Hub для автоматики, що пише людям).
 */
const { assistantThreads, assistantTickets, events, settings, identities } = schema;
export const DEFAULT_MODEL = "google/gemini-3.8-flash";
const BUFFER_SEC = 20;               // збираємо кілька повідомлень поспіль в одну відповідь
const TEAM_SILENCE_HOURS = 12;       // команда відповіла сама в «Чатах» — асистентка мовчить
const MAX_REPLIES_PER_HOUR = 8;      // захист від зациклення / спаму
const MAX_CHANNEL_LINKS_PER_DAY = 2; // нове посилання в канал — не частіше
// Етап 2 (дії з підпискою Hub), ліміти з інтерв'ю власника — перевіряє код, а не модель
const REFUND_MAX_DAYS = 14;          // повернення — лише останнього платежу, не давніше 14 днів
const REFUNDS_PER_DAY = 5;           // на всіх за добу
const REFUNDS_PER_PERSON = 2;        // третє повернення людині — відмова
const EXTEND_MAX_DAYS = 14;          // компенсація днями за раз
const EXTEND_EVERY_DAYS = 30;        // компенсація людині — не частіше
const ACTIONS_PER_PERSON_DAY = 3;    // дій, що змінюють підписку чи доступ, на людину за добу

export type AssistantSettings = { enabled: boolean; actions: boolean; model: string; notes: string };
export async function assistantSettings(): Promise<AssistantSettings> {
  const rows = await db().select().from(settings).where(sql`${settings.key} in ('assistant.enabled','assistant.actions','assistant.model','assistant.notes')`);
  const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { enabled: v["assistant.enabled"] === true, actions: v["assistant.actions"] === true, model: typeof v["assistant.model"] === "string" && v["assistant.model"] ? String(v["assistant.model"]) : DEFAULT_MODEL, notes: typeof v["assistant.notes"] === "string" ? String(v["assistant.notes"]) : "" };
}
export async function setAssistantSetting(key: "enabled" | "actions" | "model" | "notes" | "lastError", value: unknown) {
  await db().insert(settings).values({ key: `assistant.${key}`, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

/** Бот: повідомлення, на яке раніше йшла заглушка. true — асистентка відповість сама (черга), false — стара відповідь. */
export async function assistantTake(personId: number) {
  try {
    if (!llmConfigured() || !(await assistantSettings()).enabled) return false;
    const now = new Date();
    await db().insert(assistantThreads).values({ personId, pendingSince: now, lastInAt: now, reason: "message", updatedAt: now })
      .onConflictDoUpdate({ target: assistantThreads.personId, set: { pendingSince: sql`coalesce(${assistantThreads.pendingSince}, ${now})`, lastInAt: now, reason: sql`coalesce(${assistantThreads.reason}, 'message')`, updatedAt: now } });
    return true;
  } catch { return false; }
}
/** Команда дала вказівку у зверненні — асистентка обробляє діалог знову (без очікування буфера). */
export async function assistantWake(personId: number) {
  const now = new Date();
  await db().insert(assistantThreads).values({ personId, pendingSince: now, lastInAt: new Date(0), reason: "team_note", updatedAt: now })
    .onConflictDoUpdate({ target: assistantThreads.personId, set: { pendingSince: sql`coalesce(${assistantThreads.pendingSince}, ${now})`, reason: "team_note", updatedAt: now } });
}

// ---------- журнал ----------
async function logAction(personId: number, kind: string, label: string, extra: Record<string, unknown> = {}) {
  await db().insert(events).values({ personId, type: "assistant.action", source: "assistant", payload: { kind, label, ...extra } });
}
export async function createTicket(personId: number, t: { kind: string; priority?: string; silent?: boolean; summary: string }) {
  const d = db();
  // те саме відкрите звернення за добу — доповнюємо, а не плодимо нові
  const [open] = await d.select().from(assistantTickets).where(and(eq(assistantTickets.personId, personId), eq(assistantTickets.status, "open"), eq(assistantTickets.kind, t.kind), sql`${assistantTickets.createdAt} > now() - interval '1 day'`)).limit(1);
  if (open) {
    const stamp = new Date().toLocaleString("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" });
    await d.update(assistantTickets).set({ summary: `${open.summary}\n[${stamp}] ${t.summary}`.slice(0, 4000), priority: t.priority === "urgent" ? "urgent" : open.priority }).where(eq(assistantTickets.id, open.id));
    return open.id;
  }
  const [r] = await d.insert(assistantTickets).values({ personId, kind: t.kind, priority: t.priority === "urgent" ? "urgent" : "normal", silent: Boolean(t.silent), summary: t.summary.slice(0, 4000) }).returning({ id: assistantTickets.id });
  await d.insert(events).values({ personId, type: "assistant.handoff", source: "assistant", payload: { ticketId: r.id, kind: t.kind, priority: t.priority ?? "normal", silent: Boolean(t.silent), label: `Передала команді: ${t.summary.slice(0, 120)}` } });
  return r.id;
}

// ---------- інструменти ----------
const KINDS = ["crisis", "personal", "refund", "cancel", "zenedu", "access", "payment", "tech", "sales", "other"];
const TOOLS: ToolDef[] = [
  { type: "function", function: { name: "send_channel_link", description: "Надіслати людині нове одноразове посилання в канал клубу (знімає старе блокування, якщо було). Лише якщо в картці є право Hub на канал.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "send_cabinet_link", description: "Додати до відповіді кнопку входу в особистий кабінет платформи (одноразове посилання).", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "send_shchyro_link", description: "Додати до відповіді кнопку на бот «Щиро».", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "send_offer", description: "Надіслати людині оффер з кнопкою оплати. plan_id - лише з розділу картки ЩО МОЖНА ЗАПРОПОНУВАТИ.", parameters: { type: "object", properties: { plan_id: { type: "integer" } }, required: ["plan_id"] } } },
  { type: "function", function: { name: "handoff", description: "Передати звернення команді в Hub. silent=true - людині нічого не відповідати. priority=urgent - криза чи загроза.", parameters: { type: "object", properties: { kind: { type: "string", enum: KINDS }, priority: { type: "string", enum: ["normal", "urgent"] }, silent: { type: "boolean" }, summary: { type: "string", description: "Що просить людина; що ти перевірила і зробила; що потрібно від команди." } }, required: ["kind", "summary"] } } },
];
type Btn = { text: string; url: string };
// after — окремі повідомлення (посилання в канал, оффер), які йдуть ПІСЛЯ тексту асистентки, щоб «кнопка нижче» було правдою
type Ctx = { personId: number; card: CardData; buttons: Btn[]; handedOff: boolean; silent: boolean; crisis?: boolean; actionsOn?: boolean; did: string[]; after: (() => Promise<void>)[] };

async function runTool(name: string, args: Record<string, unknown>, c: Ctx): Promise<string> {
  if (ACTION_TOOLS.some((t) => t.function.name === name)) return c.actionsOn ? runActionTool(name, args, c) : "Цей інструмент вимкнено. Передай команді (handoff).";
  const d = db();
  switch (name) {
    case "send_channel_link": {
      if (!c.card.channelKeys.length) return "Не виконано: права Hub на канал немає. Якщо підписка ZenEdu чинна - handoff (kind=access).";
      const [n] = (await d.execute(sql`select count(*)::int as c from events where person_id = ${c.personId} and type = 'assistant.action' and payload->>'kind' = 'channel_link' and created_at > now() - interval '1 day'`)).rows as { c: number }[];
      if ((n?.c ?? 0) >= MAX_CHANNEL_LINKS_PER_DAY) return "Не виконано: за добу вже надіслано 2 посилання. Передай команді (handoff kind=tech).";
      const { inviteNow } = await import("../telegram-access");
      const keys = [...c.card.channelKeys];
      c.after.push(async () => {
        for (const key of keys) {
          const r = await inviteNow(c.personId, key);
          if (r.ok) await logAction(c.personId, "channel_link", "Надіслала нове посилання в канал", { resource: key });
          else await createTicket(c.personId, { kind: "tech", summary: `Асистентка пообіцяла нове посилання в канал, але його не вдалося створити: ${r.reason}. Надішліть посилання вручну.` });
        }
      });
      c.did.push("посилання в канал");
      return "Посилання в канал буде надіслано окремим повідомленням одразу ПІСЛЯ твоєї відповіді (тобто нижче).";
    }
    case "send_cabinet_link": {
      const { onboardingConfigured, magicLinkFor } = await import("../onboarding");
      if (!onboardingConfigured()) return "Не виконано: кабінет не налаштовано. Передай команді.";
      c.buttons.push({ text: "Відкрити кабінет", url: magicLinkFor(c.personId) });
      await logAction(c.personId, "cabinet_link", "Надіслала посилання в кабінет"); c.did.push("посилання в кабінет");
      return "Кнопку входу в кабінет буде додано до твоєї відповіді.";
    }
    case "send_shchyro_link": {
      const { SHCHYRO_BOT_URL } = await import("../shchyro");
      c.buttons.push({ text: "Відкрити «Щиро»", url: SHCHYRO_BOT_URL });
      await logAction(c.personId, "shchyro_link", "Надіслала посилання на «Щиро»"); c.did.push("посилання на «Щиро»");
      return "Кнопку на «Щиро» буде додано до твоєї відповіді.";
    }
    case "send_offer": {
      const planId = Number(args.plan_id);
      const offer = c.card.offers.find((o) => o.id === planId);
      if (!offer) return "Не виконано: такого оффера немає в картці. Назви ціну і передай команді.";
      const [idn] = await d.select().from(identities).where(and(eq(identities.personId, c.personId), eq(identities.botKey, "hub")));
      if (!idn?.chatId) return "Не виконано: немає чату з людиною.";
      const { sendOfferMessage } = await import("../bot");
      c.after.push(async () => { await sendOfferMessage(Number(idn.chatId), c.personId, planId); await logAction(c.personId, "offer", `Надіслала оффер «${offer.name}»`, { planId }); });
      c.did.push(`оффер «${offer.name}»`);
      return "Оффер з кнопкою оплати буде надіслано окремим повідомленням одразу ПІСЛЯ твоєї відповіді (тобто нижче).";
    }
    case "handoff": {
      const kind = KINDS.includes(String(args.kind)) ? String(args.kind) : "other";
      const priority = args.priority === "urgent" || kind === "crisis" ? "urgent" : "normal";
      const silent = Boolean(args.silent);
      const id = await createTicket(c.personId, { kind, priority, silent, summary: String(args.summary ?? "").trim() || "без опису" });
      c.handedOff = true; if (silent) c.silent = true; if (kind === "crisis") c.crisis = true;
      return `Звернення #${id} передано команді${silent ? "; людині нічого не відповідай (фінальна відповідь порожня)" : ""}.`;
    }
  }
  return "Невідомий інструмент.";
}

// ---------- етап 2: дії з підпискою Hub (вимикач assistant.actions, за замовчуванням вимкнений) ----------
const ACTION_TOOLS: ToolDef[] = [
  { type: "function", function: { name: "cancel_renewal", description: "Скасувати автопродовження підписки Hub (доступ лишається до кінця оплаченого періоду). subscription_id - номер Hub # із картки.", parameters: { type: "object", properties: { subscription_id: { type: "integer" }, reason: { type: "string", description: "причина зі слів людини" } }, required: ["subscription_id"] } } },
  { type: "function", function: { name: "pause", description: "Поставити підписку Hub на паузу: доступ закривається одразу, списання зупиняються, доки людина не відновить.", parameters: { type: "object", properties: { subscription_id: { type: "integer" } }, required: ["subscription_id"] } } },
  { type: "function", function: { name: "extend", description: "Подовжити підписку Hub на кілька днів як компенсацію (до 14 днів; одній людині не частіше ніж раз на 30 днів).", parameters: { type: "object", properties: { subscription_id: { type: "integer" }, days: { type: "integer" }, reason: { type: "string" } }, required: ["subscription_id", "days", "reason"] } } },
  { type: "function", function: { name: "refund_last", description: "Повернути кошти за ОСТАННІЙ платіж Hub (не давніше 14 днів): доступ закривається одразу, підписка скасовується. Лише якщо людина наполягає і відмовилась від компенсації днями.", parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] } } },
];
async function actionsToday(personId: number) {
  const [r] = (await db().execute(sql`select count(*)::int as c from events where person_id = ${personId} and type = 'assistant.action' and payload->>'kind' in ('cancel','pause','extend','refund') and created_at > now() - interval '1 day'`)).rows as { c: number }[];
  return r?.c ?? 0;
}
/** Підписка Hub цієї людини з картки (інструмент не може торкнутися чужої чи ZenEdu). */
function ownHubSub(c: Ctx, id: unknown) {
  return c.card.hubSubs.find((s) => s.id === Number(id)) ?? null;
}
async function runActionTool(name: string, args: Record<string, unknown>, c: Ctx): Promise<string> {
  const d = db(); const fmt = (v: string | Date | null) => v ? new Date(v).toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv" }) : "—";
  if (await actionsToday(c.personId) >= ACTIONS_PER_PERSON_DAY) return "Не виконано: ліміт дій для цієї людини на добу. Передай команді (handoff).";
  const pay = await import("../payments");
  if (name === "cancel_renewal" || name === "pause" || name === "extend") {
    const s = ownHubSub(c, args.subscription_id);
    if (!s) return "Не виконано: такої підписки Hub у картці немає (ZenEdu скасовує лише команда - handoff kind=zenedu).";
    if (name === "cancel_renewal") {
      if (s.cancelAtEnd) return `Автопродовження вже скасовано; доступ діє до ${fmt(s.end)}.`;
      if (!["active", "trialing", "past_due"].includes(s.status)) return "Не виконано: підписка не активна, скасовувати нічого.";
      await pay.cancelAtEnd(s.id, "assistant", { silent: true });
      await logAction(c.personId, "cancel", `Скасувала автопродовження «${s.plan}»`, { subscriptionId: s.id, reason: String(args.reason ?? "") });
      c.did.push("скасування автопродовження");
      return `Готово: автопродовження скасовано, списань більше не буде; доступ діє до ${fmt(s.end)}. Повідом людині це сама.`;
    }
    if (name === "pause") {
      if (!["active", "trialing", "past_due"].includes(s.status)) return "Не виконано: підписка не активна.";
      await pay.pauseSub(s.id, "assistant", { silent: true });
      await logAction(c.personId, "pause", `Поставила на паузу «${s.plan}»`, { subscriptionId: s.id });
      c.did.push("пауза");
      return "Готово: підписка на паузі, доступ закрито, списань не буде. Відновити можна командою /subscriptions або написавши нам.";
    }
    const days = Math.round(Number(args.days));
    if (!(days >= 1 && days <= EXTEND_MAX_DAYS)) return `Не виконано: можна від 1 до ${EXTEND_MAX_DAYS} днів.`;
    const [prev] = (await d.execute(sql`select 1 from events where person_id = ${c.personId} and type = 'assistant.action' and payload->>'kind' = 'extend' and created_at > now() - (${EXTEND_EVERY_DAYS} * interval '1 day') limit 1`)).rows;
    if (prev) return "Не виконано: компенсацію цій людині вже давали за останні 30 днів. Передай команді (handoff).";
    if (!s.end || !["active", "trialing", "past_due", "cancelled"].includes(s.status)) return "Не виконано: у підписки немає оплаченого періоду. Передай команді.";
    const [u] = await d.update(schema.subscriptions).set({ currentPeriodEnd: sql`${schema.subscriptions.currentPeriodEnd} + ${days} * interval '1 day'`, nextChargeAt: sql`case when ${schema.subscriptions.nextChargeAt} is not null then ${schema.subscriptions.nextChargeAt} + ${days} * interval '1 day' end`, updatedAt: new Date() })
      .where(and(eq(schema.subscriptions.id, s.id), eq(schema.subscriptions.personId, c.personId), eq(schema.subscriptions.source, "hub"))).returning();
    await d.insert(events).values({ personId: c.personId, type: "access.compensated", source: "assistant", payload: { subscriptionId: s.id, days, until: u?.currentPeriodEnd ?? null, reason: String(args.reason ?? "") } });
    const { syncEntitlementsFromSubscriptions } = await import("../telegram-access"); await syncEntitlementsFromSubscriptions().catch(() => null);
    await logAction(c.personId, "extend", `Подовжила «${s.plan}» на ${days} дн.`, { subscriptionId: s.id, days, reason: String(args.reason ?? "") });
    c.did.push(`+${days} дн.`);
    return `Готово: доступ подовжено на ${days} дн., тепер діє до ${fmt(u?.currentPeriodEnd ?? null)}${u?.nextChargeAt ? `; наступне списання ${fmt(u.nextChargeAt)}` : ""}.`;
  }
  if (name === "refund_last") {
    const p = c.card.lastHubPayment;
    if (!p) return "Не виконано: успішних платежів Hub немає. Якщо платила в ZenEdu - handoff kind=zenedu.";
    if (p.daysAgo > REFUND_MAX_DAYS) return `Не виконано: останній платіж був ${Math.floor(p.daysAgo)} дн. тому, повернення можливе лише протягом ${REFUND_MAX_DAYS} днів. Запропонуй скасувати автопродовження.`;
    if (c.card.refundsCount >= REFUNDS_PER_PERSON) return "Не виконано: цій людині вже двічі повертали кошти, третє повернення - відмова за правилами. Ввічливо відмов.";
    const [day] = (await d.execute(sql`select count(*)::int as c from events where type = 'assistant.action' and payload->>'kind' = 'refund' and created_at > now() - interval '1 day'`)).rows as { c: number }[];
    if ((day?.c ?? 0) >= REFUNDS_PER_DAY) return "Не виконано: денний ліміт повернень вичерпано. Передай команді (handoff kind=refund) і скажи людині, що команда оформить повернення.";
    // збій мережі чи WayForPay — так само, як відмова: звернення команді, людині не обіцяємо того, що не відбулося
    const r = await pay.refundAttempt(p.attemptId, "Повернення за запитом (асистентка)", true).catch((e) => ({ ok: false, reason: String(e).slice(0, 160), revoked: false }));
    if (!r.ok) { await createTicket(c.personId, { kind: "refund", summary: `Повернення не пройшло автоматично (${r.reason}): платіж #${p.attemptId}, ${p.amount} ${p.currency}. Можливо, картку закрито — потрібне повернення за реквізитами.` }); c.handedOff = true; return "Не вдалося повернути автоматично (можливо, картку закрито). Звернення передано команді; скажи людині, що команда зв'яжеться щодо повернення."; }
    await logAction(c.personId, "refund", `Повернула ${p.amount} ${p.currency} (платіж #${p.attemptId}), доступ закрито`, { attemptId: p.attemptId, amount: p.amount, reason: String(args.reason ?? "") });
    c.did.push("повернення коштів");
    return `Готово: ${p.amount} ${p.currency} повернено, доступ закрито, підписку скасовано. Скажи людині, що зарахування на картку робить банк, зазвичай 1-3 робочі дні.`;
  }
  return "Невідомий інструмент.";
}

// ---------- обробка діалогу ----------
type Hist = { type: string; source: string; text: string | null; media: string | null; at: string };
async function history(personId: number) {
  const rows = (await db().execute(sql`select type, source, payload->>'text' as text, payload->'media'->>'kind' as media, created_at as at from events
    where person_id = ${personId} and type in ('bot.message','bot.reply') order by created_at desc limit 24`)).rows as Hist[];
  return rows.reverse();
}

async function addUsage(input: number, output: number) {
  const key = `assistant.usage:${new Date().toISOString().slice(0, 10)}`;
  await db().execute(sql`insert into settings (key, value) values (${key}, ${JSON.stringify({ calls: 1, input, output })}::jsonb)
    on conflict (key) do update set value = jsonb_build_object('calls', coalesce((settings.value->>'calls')::int, 0) + 1, 'input', coalesce((settings.value->>'input')::int, 0) + ${input}, 'output', coalesce((settings.value->>'output')::int, 0) + ${output}), updated_at = now()`);
}

export async function handleThread(personId: number, reason: string | null, st: AssistantSettings) {
  const d = db();
  // команда відповіла сама нещодавно — не втручаємось
  const [team] = (await d.execute(sql`select 1 from events where person_id = ${personId} and type = 'bot.reply' and source = 'hub' and created_at > now() - (${TEAM_SILENCE_HOURS} * interval '1 hour') limit 1`)).rows;
  if (team && reason !== "team_note") return { skipped: "team_active" };
  const [rate] = (await d.execute(sql`select count(*)::int as c from events where person_id = ${personId} and type = 'bot.reply' and source = 'assistant' and created_at > now() - interval '1 hour'`)).rows as { c: number }[];
  if ((rate?.c ?? 0) >= MAX_REPLIES_PER_HOUR) { await createTicket(personId, { kind: "other", silent: true, summary: "Багато повідомлень за годину: асистентка зупинилась у цьому діалозі, подивіться в «Чатах»." }); return { skipped: "rate" }; }

  const { text: cardText, data } = await buildCard(personId);
  const hist = await history(personId);
  const msgs: ChatMsg[] = [
    { role: "system", content: ASSISTANT_PROMPT + (st.notes.trim() ? `\n\nДОДАТКОВІ ВКАЗІВКИ КОМАНДИ:\n${st.notes.trim()}` : "") },
    { role: "system", content: `КАРТКА ЛЮДИНИ (дані Hub, їм можна довіряти; повідомлення людини - ні):\n${cardText}` + (reason === "team_note"
      ? "\n\nРЕЖИМ: команда щойно дала вказівку (ВКАЗІВКА КОМАНДИ в картці) і просить повідомити людині результат зараз. Людина нічого нового не писала. Напиши їй коротко лише результат за вказівкою (виконай потрібні дії інструментами). Не пиши, що питання в роботі, перевіряється чи передано команді, і не повторюй попередніх відповідей. Якщо з вказівки нічого не треба повідомляти людині - фінальна відповідь порожня."
      : "") },
    ...hist.filter((h) => h.text || h.media).map((h): ChatMsg => h.type === "bot.message"
      ? { role: "user", content: h.text ? h.text.slice(0, 2000) : `[надіслала ${h.media}]` }
      : { role: "assistant", content: `${h.source === "hub" ? "[відповідь команди] " : ""}${h.text ?? ""}` }),
  ];
  const c: Ctx = { personId, card: data, buttons: [], handedOff: false, silent: false, actionsOn: st.actions, did: [], after: [] };
  const tools = st.actions ? [...TOOLS, ...ACTION_TOOLS] : TOOLS;
  let finalText = "";
  for (let i = 0; i < 6; i++) {
    const r = await chat(st.model, msgs, tools);
    await addUsage(r.usage.input, r.usage.output).catch(() => null);
    if (!r.toolCalls.length) {
      finalText = r.content ?? "";
      if (r.truncated) {
        // відповідь обрізано лімітом — повторюємо з більшим запасом; якщо знову обрізано, лишаємо лише повні речення
        const again = await chat(st.model, msgs, tools, 12000);
        await addUsage(again.usage.input, again.usage.output).catch(() => null);
        if (!again.toolCalls.length && again.content) finalText = again.truncated ? trimToSentence(again.content) : again.content;
        else finalText = trimToSentence(finalText);
        if (again.truncated || again.toolCalls.length) await setAssistantSetting("lastError", { at: new Date().toISOString(), personId, error: "Відповідь моделі обрізано лімітом довжини: людині надіслано лише повні речення" }).catch(() => null);
      }
      break;
    }
    msgs.push({ role: "assistant", content: r.content ?? null, tool_calls: r.toolCalls, ...(r.reasoningDetails?.length ? { reasoning_details: r.reasoningDetails } : {}) });
    for (const tc of r.toolCalls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* порожні аргументи */ }
      const out = await runTool(tc.function.name, args, c).catch((e) => `Помилка: ${String(e).slice(0, 200)}`);
      msgs.push({ role: "tool", tool_call_id: tc.id, content: out });
    }
  }
  // криза — без смайликів; інакше не більше 2, без крапок у кінці абзаців
  const text = c.silent ? "" : polish(finalText, { maxEmoji: c.crisis ? 0 : 2 });
  if (text) {
    const { sendToPersonMsg } = await import("../bot");
    const mid = await sendToPersonMsg(personId, text, { buttons: c.buttons, disablePreview: true }).catch(() => null);
    await d.insert(events).values({ personId, type: mid ? "bot.reply" : "bot.reply_failed", source: "assistant", payload: { text, buttons: c.buttons.map((b) => b.text), did: c.did, message_id: mid } });
  } else if (!c.handedOff && reason !== "team_note") {
    await createTicket(personId, { kind: "other", silent: true, summary: "Асистентка не сформувала відповідь: подивіться діалог у «Чатах»." });
  }
  // окремі повідомлення (посилання в канал, оффер) — після тексту; і навіть якщо тексту немає, обіцяне не губиться
  for (const f of c.after) await f().catch((e) => createTicket(personId, { kind: "tech", summary: `Не вдалося надіслати обіцяне повідомлення: ${String(e).slice(0, 160)}` }));
  return { replied: Boolean(text), handedOff: c.handedOff, did: c.did };
}

const FALLBACK = "Дякую, повідомлення отримала. Перевіряю інформацію і повернуся з відповіддю";
async function fallbackReply(personId: number) {
  // не частіше разу на годину, щоб під час збою не повторювати те саме
  const [r] = (await db().execute(sql`select 1 from events where person_id = ${personId} and type = 'bot.reply' and source = 'assistant' and payload->>'fallback' = 'true' and created_at > now() - interval '1 hour' limit 1`)).rows;
  if (r) return;
  const { sendToPersonMsg } = await import("../bot");
  const mid = await sendToPersonMsg(personId, FALLBACK).catch(() => null);
  await db().insert(events).values({ personId, type: mid ? "bot.reply" : "bot.reply_failed", source: "assistant", payload: { text: FALLBACK, fallback: true, message_id: mid } });
}

/** Cron: обробити діалоги в черзі в межах бюджету часу. */
export async function processAssistant(budgetMs = 45_000) {
  const t0 = Date.now();
  if (!llmConfigured()) return { skipped: "no_key" };
  const st = await assistantSettings();
  if (!st.enabled) return { skipped: "disabled" };
  let done = 0, failed = 0;
  while (Date.now() - t0 < budgetMs) {
    // атомарно забираємо один діалог: тік, що накладеться, його не візьме
    const [row] = (await db().execute(sql`
      with c as (select person_id, reason from assistant_threads
        where pending_since is not null and (reason = 'team_note' or last_in_at < now() - (${BUFFER_SEC} * interval '1 second'))
        order by pending_since limit 1 for update skip locked)
      update assistant_threads t set pending_since = null, reason = null, last_run_at = now(), updated_at = now() from c
      where t.person_id = c.person_id returning t.person_id, c.reason`)).rows as { person_id: number; reason: string | null }[];
    if (!row) break;
    try { await handleThread(row.person_id, row.reason, st); done++; }
    catch (e) {
      failed++;
      const err = String(e instanceof Error ? e.message : e).slice(0, 400);
      await setAssistantSetting("lastError", { at: new Date().toISOString(), personId: row.person_id, error: err }).catch(() => null);
      if (row.reason === "team_note") {
        // вказівку команди не вдалося виконати — людині нічого не пишемо, команда бачить причину
        await createTicket(row.person_id, { kind: "tech", silent: true, summary: `Асистентка не змогла виконати вказівку команди (помилка: ${err}). Людині нічого не надіслано.` }).catch(() => null);
      } else {
        // людина не лишається без відповіді: коротке підтвердження, а питання — команді
        await createTicket(row.person_id, { kind: "tech", summary: `Асистентка не змогла відповісти (помилка: ${err}). Людині надіслано «отримала, перевіряю» — потрібна відповідь команди.` }).catch(() => null);
        await fallbackReply(row.person_id).catch(() => null);
      }
    }
  }
  return { done, failed };
}

// ---------- для панелі ----------
export async function ticketList(status: "open" | "closed") {
  return (await db().execute(sql`select t.*, coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.username, p.telegram_user_id::text) as name, p.username
    from assistant_tickets t join persons p on p.id = t.person_id
    where ${status === "open" ? sql`t.status = 'open'` : sql`t.status <> 'open'`}
    order by ${status === "open" ? sql`(t.priority = 'urgent') desc, t.created_at` : sql`t.resolved_at desc nulls last`} limit 200`)).rows as { id: number; person_id: number; priority: string; silent: boolean; kind: string; summary: string; status: string; team_note: string | null; resolved_by: string | null; resolved_at: string | null; created_at: string; name: string; username: string | null }[];
}
export async function actionLog(limit = 200) {
  return (await db().execute(sql`select e.id, e.person_id, e.type, e.payload, e.created_at, coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.username, p.telegram_user_id::text) as name
    from events e join persons p on p.id = e.person_id
    where e.source = 'assistant' and e.type in ('assistant.action','assistant.handoff','bot.reply','bot.reply_failed')
    order by e.created_at desc limit ${limit}`)).rows as { id: number; person_id: number; type: string; payload: Record<string, unknown>; created_at: string; name: string }[];
}
export async function assistantStats() {
  const d = db();
  const [t] = (await d.execute(sql`select count(*) filter (where status = 'open')::int as open, count(*) filter (where status = 'open' and priority = 'urgent')::int as urgent,
    (select count(*) from events where source = 'assistant' and type = 'bot.reply' and created_at > now() - interval '1 day')::int as replies24,
    (select count(*) from events where type = 'assistant.action' and created_at > now() - interval '1 day')::int as actions24
    from assistant_tickets`)).rows as { open: number; urgent: number; replies24: number; actions24: number }[];
  const usage = (await d.select().from(settings).where(sql`${settings.key} like 'assistant.usage:%'`)).map((r) => ({ day: r.key.slice(16), ...(r.value as { calls: number; input: number; output: number }) }));
  const month = new Date().toISOString().slice(0, 7);
  const m = usage.filter((u) => u.day.startsWith(month)).reduce((a, u) => ({ calls: a.calls + u.calls, input: a.input + u.input, output: a.output + u.output }), { calls: 0, input: 0, output: 0 });
  const today = usage.find((u) => u.day === new Date().toISOString().slice(0, 10)) ?? { calls: 0, input: 0, output: 0 };
  return { ...t, month: m, today };
}
/** Остання помилка ШІ (для «Асистент → Налаштування»): коли, з ким, текст від OpenRouter. */
export async function assistantLastError() {
  const [r] = await db().select().from(settings).where(eq(settings.key, "assistant.lastError"));
  return (r?.value as { at: string; personId: number; error: string } | undefined) ?? null;
}
export async function openTicketCount() {
  try { const [r] = (await db().execute(sql`select count(*)::int as c from assistant_tickets where status = 'open'`)).rows as { c: number }[]; return r?.c ?? 0; } catch { return 0; }
}
