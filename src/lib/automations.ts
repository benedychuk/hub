import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { adminTelegramId } from "./auth";
import { enroll, addTag, stopEnrollment } from "./funnels";
import { getBot, sendToPerson } from "./bot";

/**
 * Автоматизації «тригер → дії». Тригери — події з журналу `events` (оплата, підписка, воронка, тег, бот),
 * які щохвилинний тік читає після курсора. Тому правило спрацьовує однаково, звідки б подія не прийшла.
 *
 * Запобіжники (CLAUDE.md): загальний вимикач `automations.enabled` вимкнений за замовчуванням; поки він вимкнений,
 * курсор іде за новими подіями, тож після вмикання історія не обробляється. Кожне правило має власний вимикач.
 * Не більше LIMIT_PER_HOUR спрацювань на людину за годину; тег не ставиться повторно; вхід у воронку,
 * де людина вже є, нічого не робить, тож ланцюжки правил не зациклюються.
 * Події ZenEdu (імпорт і вебхук) тригерами не є: імпорт приносить історію, а не нові дії людей.
 */

const { automations, events, persons, plans, funnels, funnelEnrollments, subscriptions, paymentAttempts, settings } = schema;
const KEYS = { enabled: "automations.enabled", cursor: "automations.cursor" } as const;
const LIMIT_PER_HOUR = 30;

export type TriggerKey =
  | "payment_success" | "subscription_started" | "subscription_renewed" | "trial_converted" | "payment_failed"
  | "subscription_not_renewed" | "subscription_cancelled" | "subscription_paused" | "access_granted" | "access_ended"
  | "funnel_started" | "funnel_finished" | "tag_added" | "bot_started";
export type FilterKind = "offer" | "funnel" | "tag" | null;
export const TRIGGERS: { key: TriggerKey; label: string; group: string; filter: FilterKind; hint: string }[] = [
  { key: "payment_success", group: "Оплати", label: "Оплата оффера", filter: "offer", hint: "будь-яка успішна оплата через Hub: перша, продовження або разова" },
  { key: "subscription_started", group: "Оплати", label: "Підписку оформлено", filter: "offer", hint: "перша оплата оффера-підписки" },
  { key: "subscription_renewed", group: "Оплати", label: "Підписку продовжено", filter: "offer", hint: "успішне автосписання наступного періоду" },
  { key: "trial_converted", group: "Оплати", label: "Пробний період перейшов у повну оплату", filter: "offer", hint: "перше автосписання після пробного періоду" },
  { key: "payment_failed", group: "Оплати", label: "Списання не пройшло", filter: "offer", hint: "невдале автосписання, Hub спробує ще раз через 1, 3 і 5 днів" },
  { key: "subscription_not_renewed", group: "Оплати", label: "Підписку не продовжено", filter: "offer", hint: "після всіх невдалих спроб списання підписка закінчилась" },
  { key: "subscription_cancelled", group: "Оплати", label: "Підписку скасовано", filter: "offer", hint: "людина вимкнула продовження; доступ діє до кінця оплаченого періоду" },
  { key: "subscription_paused", group: "Оплати", label: "Підписку поставлено на паузу", filter: "offer", hint: "з картки людини або в боті" },
  { key: "access_granted", group: "Доступ", label: "Доступ без оплати відкрито", filter: "offer", hint: "за посиланням доступу або з картки людини" },
  { key: "access_ended", group: "Доступ", label: "Доступ за оффером закінчився", filter: "offer", hint: "закінчився строк разового оффера або безкоштовного доступу" },
  { key: "funnel_started", group: "Воронки", label: "Воронку почато", filter: "funnel", hint: "людина увійшла у воронку або продукт будь-яким способом" },
  { key: "funnel_finished", group: "Воронки", label: "Воронку завершено", filter: "funnel", hint: "людина отримала останній автоматичний крок" },
  { key: "tag_added", group: "Інше", label: "Додано тег", filter: "tag", hint: "з кнопки, посилання, воронки або вручну" },
  { key: "bot_started", group: "Інше", label: "Людина запустила Hub-бот", filter: null, hint: "натиснула /start; з «один раз на людину» — лише перший запуск" },
];

export type ActionKey = "funnel_add" | "funnel_remove" | "tag_add" | "tag_remove" | "message" | "notify_team";
export type RuleAction = { type: ActionKey; funnelId?: number; tag?: string; text?: string };
export const ACTIONS: { key: ActionKey; label: string; param: "funnel" | "tag" | "text"; hint: string }[] = [
  { key: "funnel_add", label: "Додати у воронку", param: "funnel", hint: "воронка має бути активною; якщо людина вже в ній, нічого не станеться" },
  { key: "funnel_remove", label: "Зупинити воронку", param: "funnel", hint: "людина перестає отримувати кроки цієї воронки" },
  { key: "tag_add", label: "Додати тег", param: "tag", hint: "" },
  { key: "tag_remove", label: "Прибрати тег", param: "tag", hint: "" },
  { key: "message", label: "Надіслати повідомлення в Hub-бот", param: "text", hint: "лише тим, хто запускав Hub-бот; {{name}}, {{offer}}, {{funnel}} підставляються" },
  { key: "notify_team", label: "Повідомити власника в Telegram", param: "text", hint: "на ADMIN_TELEGRAM_ID; {{name}}, {{offer}}, {{funnel}}, {{link}} підставляються" },
];
export type RuleCondition = { planId?: number; funnelId?: number; tag?: string };
export type Rule = typeof automations.$inferSelect;
export const ruleActions = (r: Pick<Rule, "action">) => (((r.action ?? {}) as { actions?: RuleAction[] }).actions ?? []);

// ---------- налаштування ----------
async function getSetting<T>(key: string): Promise<T | null> { const [r] = await db().select().from(settings).where(eq(settings.key, key)); return (r?.value as T) ?? null; }
async function setSetting(key: string, value: unknown) { await db().insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } }); }
export async function automationsEnabled() { return (await getSetting<boolean>(KEYS.enabled)) === true; }
export async function setAutomationsEnabled(on: boolean) {
  // курсор переставляється на кінець журналу, щоб після вмикання не обробити старі події
  if (on && !(await automationsEnabled())) await setSetting(KEYS.cursor, await maxEventId());
  await setSetting(KEYS.enabled, on);
}
async function maxEventId() { const [r] = await db().select({ m: sql<number>`coalesce(max(${events.id}), 0)::int` }).from(events); return r?.m ?? 0; }

// ---------- подія → тригери з контекстом ----------
type Ctx = { trigger: TriggerKey; personId: number; planId?: number | null; funnelId?: number | null; tag?: string | null };
type Ev = typeof events.$inferSelect;
const RELEVANT = ["payment.approved", "payment.retry_scheduled", "subscription.expired", "subscription.cancel_scheduled", "subscription.paused", "access.granted", "funnel.enrolled", "funnel.finished", "tag.added", "bot.start"];

async function planOfAttempt(id: unknown) { const [a] = id ? await db().select({ planId: paymentAttempts.planId, subscriptionId: paymentAttempts.subscriptionId }).from(paymentAttempts).where(eq(paymentAttempts.id, Number(id))) : []; return a ?? null; }
async function subOf(id: unknown) { const [s] = id ? await db().select().from(subscriptions).where(eq(subscriptions.id, Number(id))) : []; return s ?? null; }

/** Які тригери дає подія. Одна оплата може бути і «Оплата оффера», і «Підписку оформлено». */
export async function triggersFor(e: Ev): Promise<Ctx[]> {
  const p = (e.payload ?? {}) as Record<string, unknown>; const personId = e.personId; if (!personId) return [];
  switch (e.type) {
    case "payment.approved": {
      const kind = String(p.kind ?? "");
      if (!["first", "manual", "renewal"].includes(kind)) return []; // card/migrate/verify — не оплата оффера
      const a = await planOfAttempt(p.attemptId); const sub = await subOf(a?.subscriptionId);
      const planId = a?.planId ?? sub?.planId ?? null;
      const [pl] = planId ? await db().select({ paymentType: plans.paymentType, trialDays: plans.trialDays }).from(plans).where(eq(plans.id, planId)) : [];
      const out: Ctx[] = [{ trigger: "payment_success", personId, planId }];
      if (kind !== "renewal" && pl?.paymentType === "subscription") out.push({ trigger: "subscription_started", personId, planId });
      if (kind === "renewal") {
        out.push({ trigger: "subscription_renewed", personId, planId });
        // перше успішне автосписання підписки з пробним періодом = перехід із пробного на повну оплату
        if ((pl?.trialDays ?? 0) > 0 && sub) {
          const [c] = await db().select({ n: sql<number>`count(*)::int` }).from(paymentAttempts).where(and(eq(paymentAttempts.subscriptionId, sub.id), eq(paymentAttempts.kind, "renewal"), eq(paymentAttempts.status, "approved")));
          if ((c?.n ?? 0) <= 1) out.push({ trigger: "trial_converted", personId, planId });
        }
      }
      return out;
    }
    case "payment.retry_scheduled": { const s = await subOf(p.subscriptionId); return [{ trigger: "payment_failed", personId, planId: s?.planId ?? null }]; }
    case "subscription.expired": {
      const s = await subOf(p.subscriptionId);
      return [{ trigger: String(p.reason ?? "") === "access period ended" ? "access_ended" : "subscription_not_renewed", personId, planId: s?.planId ?? null }];
    }
    case "subscription.cancel_scheduled": { const s = await subOf(p.subscriptionId); return [{ trigger: "subscription_cancelled", personId, planId: s?.planId ?? null }]; }
    case "subscription.paused": { const s = await subOf(p.subscriptionId); return [{ trigger: "subscription_paused", personId, planId: s?.planId ?? null }]; }
    case "access.granted": return [{ trigger: "access_granted", personId, planId: Number(p.planId ?? 0) || null }];
    case "funnel.enrolled": return p.resumed ? [] : [{ trigger: "funnel_started", personId, funnelId: Number(p.funnelId ?? 0) || null }];
    case "funnel.finished": return [{ trigger: "funnel_finished", personId, funnelId: Number(p.funnelId ?? 0) || null }];
    case "tag.added": return [{ trigger: "tag_added", personId, tag: String(p.tag ?? "") }];
    case "bot.start": return [{ trigger: "bot_started", personId }];
    default: return [];
  }
}

export function matches(rule: Pick<Rule, "trigger" | "condition">, ctx: Ctx) {
  if (rule.trigger !== ctx.trigger) return false;
  const c = (rule.condition ?? {}) as RuleCondition;
  if (c.planId && c.planId !== ctx.planId) return false;
  if (c.funnelId && c.funnelId !== ctx.funnelId) return false;
  if (c.tag && c.tag.trim().toLowerCase() !== (ctx.tag ?? "").trim().toLowerCase()) return false;
  if (rule.trigger === "tag_added" && !c.tag) return false; // тег обовʼязковий, інакше правило спрацювало б на кожен автотег воронок
  return true;
}

// ---------- виконання дій ----------
async function fill(text: string, ctx: Ctx, appUrl: string) {
  const [p] = await db().select().from(persons).where(eq(persons.id, ctx.personId));
  const [pl] = ctx.planId ? await db().select({ name: plans.name }).from(plans).where(eq(plans.id, ctx.planId)) : [];
  const [f] = ctx.funnelId ? await db().select({ name: funnels.name }).from(funnels).where(eq(funnels.id, ctx.funnelId)) : [];
  const name = [p?.firstName, p?.lastName].filter(Boolean).join(" ") || (p?.username ? `@${p.username}` : `людина #${ctx.personId}`);
  return text.replace(/\{\{\s*name\s*\}\}/g, name).replace(/\{\{\s*offer\s*\}\}/g, pl?.name ?? "").replace(/\{\{\s*funnel\s*\}\}/g, f?.name ?? "").replace(/\{\{\s*link\s*\}\}/g, `${appUrl}/people/${ctx.personId}`);
}

export async function runActions(rule: Rule, ctx: Ctx, appUrl: string) {
  const out: { type: ActionKey; ok: boolean; note?: string }[] = [];
  for (const a of ruleActions(rule)) {
    try {
      if (a.type === "funnel_add" && a.funnelId) { const r = await enroll(a.funnelId, ctx.personId, "automation"); out.push({ type: a.type, ok: Boolean(r), note: r ? undefined : "воронка не активна" }); }
      else if (a.type === "funnel_remove" && a.funnelId) {
        const rows = await db().select({ id: funnelEnrollments.id }).from(funnelEnrollments).where(and(eq(funnelEnrollments.personId, ctx.personId), eq(funnelEnrollments.funnelId, a.funnelId), eq(funnelEnrollments.status, "active")));
        for (const r of rows) await stopEnrollment(r.id, "automation");
        out.push({ type: a.type, ok: true, note: rows.length ? undefined : "людини не було у воронці" });
      } else if (a.type === "tag_add" && a.tag) {
        const [p] = await db().select({ tags: persons.tags }).from(persons).where(eq(persons.id, ctx.personId));
        if ((p?.tags ?? []).includes(a.tag)) out.push({ type: a.type, ok: true, note: "тег уже був" });
        else { await addTag(ctx.personId, a.tag, "automation", { ruleId: rule.id }); out.push({ type: a.type, ok: true }); }
      } else if (a.type === "tag_remove" && a.tag) {
        const [p] = await db().select({ tags: persons.tags }).from(persons).where(eq(persons.id, ctx.personId));
        if (!(p?.tags ?? []).includes(a.tag)) out.push({ type: a.type, ok: true, note: "тегу не було" });
        else {
          await db().update(persons).set({ tags: sql`coalesce((select jsonb_agg(x) from jsonb_array_elements(${persons.tags}) x where x <> to_jsonb(${a.tag}::text)), '[]'::jsonb)` }).where(eq(persons.id, ctx.personId));
          await db().insert(events).values({ personId: ctx.personId, type: "tag.removed", source: "automation", payload: { tag: a.tag, ruleId: rule.id } });
          out.push({ type: a.type, ok: true });
        }
      } else if (a.type === "message" && a.text?.trim()) {
        const ok = await sendToPerson(ctx.personId, await fill(a.text, ctx, appUrl));
        out.push({ type: a.type, ok, note: ok ? undefined : "людина не запускала Hub-бот або заблокувала його" });
      } else if (a.type === "notify_team" && a.text?.trim()) {
        const to = adminTelegramId();
        if (!to) out.push({ type: a.type, ok: false, note: "ADMIN_TELEGRAM_ID не задано" });
        else { await getBot().api.sendMessage(to, await fill(a.text, ctx, appUrl), { link_preview_options: { is_disabled: true } }); out.push({ type: a.type, ok: true }); }
      }
    } catch (e) { out.push({ type: a.type, ok: false, note: String(e).slice(0, 160) }); }
  }
  return out;
}

// ---------- обробник для щохвилинного тіку ----------
async function firedBefore(ruleId: number, personId: number) {
  const [r] = await db().select({ id: events.id }).from(events).where(and(eq(events.personId, personId), inArray(events.type, ["automation.fired", "automation.scheduled"]), sql`(${events.payload}->>'ruleId')::int = ${ruleId}`)).limit(1);
  return Boolean(r);
}
async function alreadyHandled(ruleId: number, eventId: number) {
  const [r] = await db().select({ id: events.id }).from(events).where(and(inArray(events.type, ["automation.fired", "automation.scheduled"]), sql`(${events.payload}->>'ruleId')::int = ${ruleId}`, sql`(${events.payload}->>'eventId')::int = ${eventId}`)).limit(1);
  return Boolean(r);
}
async function overLimit(personId: number) {
  const [r] = await db().select({ n: sql<number>`count(*)::int` }).from(events).where(and(eq(events.personId, personId), eq(events.type, "automation.fired"), gt(events.createdAt, new Date(Date.now() - 3600_000))));
  return (r?.n ?? 0) >= LIMIT_PER_HOUR;
}
async function fire(rule: Rule, ctx: Ctx, eventId: number, appUrl: string, scheduledId?: number) {
  if (await overLimit(ctx.personId)) {
    await db().insert(events).values({ personId: ctx.personId, type: "automation.skipped", source: "automation", payload: { ruleId: rule.id, name: rule.name, eventId, reason: `понад ${LIMIT_PER_HOUR} спрацювань за годину` } });
    return;
  }
  const results = await runActions(rule, ctx, appUrl);
  await db().insert(events).values({ personId: ctx.personId, type: "automation.fired", source: "automation", payload: { ruleId: rule.id, name: rule.name, trigger: ctx.trigger, eventId, scheduledId: scheduledId ?? null, results } });
}

/** Обробляє нові події журналу й відкладені спрацювання. Нічого не робить, поки загальний вимикач вимкнений. */
export async function runAutomations(appUrl: string, budgetMs = 20_000) {
  const t0 = Date.now();
  if (!(await automationsEnabled())) { await setSetting(KEYS.cursor, await maxEventId()); return { skipped: "disabled" as const }; }
  const rules = await db().select().from(automations).where(eq(automations.isActive, true)).orderBy(asc(automations.id));
  let cursor = Number((await getSetting<number>(KEYS.cursor)) ?? 0);
  if (!cursor) { await setSetting(KEYS.cursor, await maxEventId()); return { initialized: true }; }
  let handled = 0, fired = 0, scheduled = 0, delayed = 0;
  const batch = rules.length ? await db().select().from(events).where(and(gt(events.id, cursor), inArray(events.type, RELEVANT))).orderBy(asc(events.id)).limit(300) : [];
  for (const e of batch) {
    if (Date.now() - t0 > budgetMs) break;
    for (const ctx of await triggersFor(e)) {
      for (const rule of rules.filter((r) => matches(r, ctx))) {
        if (await alreadyHandled(rule.id, e.id)) continue;
        if (rule.oncePerPerson && await firedBefore(rule.id, ctx.personId)) continue;
        if (rule.delayMinutes > 0) {
          await db().insert(events).values({ personId: ctx.personId, type: "automation.scheduled", source: "automation", payload: { ruleId: rule.id, name: rule.name, eventId: e.id, ctx, dueAt: new Date(Date.now() + rule.delayMinutes * 60_000).toISOString() } });
          scheduled++;
        } else { await fire(rule, ctx, e.id, appUrl); fired++; }
      }
    }
    cursor = e.id; handled++;
  }
  if (!rules.length) cursor = await maxEventId(); // правил немає: просто йдемо за журналом
  await setSetting(KEYS.cursor, cursor);
  // відкладені: настав час і ще не виконані; правило перевіряється знову (могли вимкнути)
  const due = await db().select().from(events).where(and(eq(events.type, "automation.scheduled"), sql`(${events.payload}->>'dueAt')::timestamptz <= now()`,
    sql`not exists (select 1 from events f where f.type in ('automation.fired', 'automation.skipped') and (f.payload->>'scheduledId')::int = ${events.id})`)).orderBy(asc(events.id)).limit(100);
  for (const s of due) {
    if (Date.now() - t0 > budgetMs) break;
    const p = (s.payload ?? {}) as { ruleId: number; eventId: number; ctx: Ctx };
    const rule = rules.find((r) => r.id === p.ruleId);
    if (!rule) { await db().insert(events).values({ personId: s.personId, type: "automation.skipped", source: "automation", payload: { ruleId: p.ruleId, eventId: p.eventId, scheduledId: s.id, reason: "правило вимкнено або видалено" } }); continue; }
    await fire(rule, p.ctx, p.eventId, appUrl, s.id); delayed++;
  }
  return { handled, fired, scheduled, delayed, rules: rules.length };
}

/** Для сторінки: скільки разів спрацювало кожне правило і останні спрацювання. */
export async function automationStats() {
  const counts = await db().select({ ruleId: sql<number>`(${events.payload}->>'ruleId')::int`, n: sql<number>`count(*)::int`, last: sql<Date>`max(${events.createdAt})` }).from(events).where(eq(events.type, "automation.fired")).groupBy(sql`(${events.payload}->>'ruleId')::int`);
  const [pending] = await db().select({ n: sql<number>`count(*)::int` }).from(events).where(and(eq(events.type, "automation.scheduled"), sql`not exists (select 1 from events f where f.type in ('automation.fired', 'automation.skipped') and (f.payload->>'scheduledId')::int = ${events.id})`));
  const recent = await db().select({ e: events, first: persons.firstName, last: persons.lastName, username: persons.username }).from(events).leftJoin(persons, eq(persons.id, events.personId))
    .where(inArray(events.type, ["automation.fired", "automation.skipped"])).orderBy(desc(events.id)).limit(30);
  return { counts: new Map(counts.map((c) => [c.ruleId, c])), pending: pending?.n ?? 0, recent };
}
