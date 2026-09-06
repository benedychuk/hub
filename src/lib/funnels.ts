import { and, asc, eq, lte, sql } from "drizzle-orm";
import { InlineKeyboard } from "grammy";
import { db, schema } from "@/db";
import { getBot, BOT_KEY } from "./bot";

const { funnels, funnelSteps, funnelEnrollments, funnelDeliveries, identities, events } = schema;

export type StepConfig = {
  delay?: { value: number; unit: "minutes" | "hours" | "days" };
  quietHours?: boolean;            // не надсилати 22:00–09:00 за Києвом
  buttons?: { text: string; url?: string; kind?: "url" | "next" }[];
  protect?: boolean;
  disablePreview?: boolean;
};

export function delayMs(c: StepConfig) {
  const d = c.delay; if (!d || !d.value) return 0;
  const m = d.unit === "days" ? 86400000 : d.unit === "hours" ? 3600000 : 60000;
  return d.value * m;
}

/** Зсуває час у тихі години (22:00–09:00 Київ) на 09:00. */
export function applyQuietHours(t: Date, quiet: boolean) {
  if (!quiet) return t;
  const kyiv = new Date(t.toLocaleString("en-US", { timeZone: "Europe/Kyiv" }));
  const h = kyiv.getHours();
  if (h >= 9 && h < 22) return t;
  const offsetMs = kyiv.getTime() - t.getTime(); // різниця Київ − UTC у мс
  const target = new Date(kyiv); if (h >= 22) target.setDate(target.getDate() + 1); target.setHours(9, 0, 0, 0);
  return new Date(target.getTime() - offsetMs);
}

export async function enroll(funnelId: number, personId: number, reason = "manual") {
  const d = db();
  const [f] = await d.select().from(funnels).where(eq(funnels.id, funnelId));
  if (!f || !f.isActive) return null;
  const existing = await d.select().from(funnelEnrollments).where(and(eq(funnelEnrollments.funnelId, funnelId), eq(funnelEnrollments.personId, personId), eq(funnelEnrollments.status, "active")));
  if (existing[0]) return existing[0];
  const steps = await d.select().from(funnelSteps).where(eq(funnelSteps.funnelId, funnelId)).orderBy(asc(funnelSteps.position));
  if (!steps.length) return null;
  const c = (steps[0].config ?? {}) as StepConfig;
  const nextAt = applyQuietHours(new Date(Date.now() + delayMs(c)), Boolean(c.quietHours));
  const [e] = await d.insert(funnelEnrollments).values({ funnelId, personId, nextPosition: steps[0].position, nextAt }).returning();
  await d.insert(events).values({ personId, type: "funnel.enrolled", source: "hub", payload: { funnelId, name: f.name, reason } });
  await d.update(funnels).set({ subscribersCount: sql`${funnels.subscribersCount} + 1` }).where(eq(funnels.id, funnelId));
  return e;
}

export async function stopEnrollment(id: number, reason: string) {
  await db().update(funnelEnrollments).set({ status: "stopped", stopReason: reason, finishedAt: new Date() }).where(eq(funnelEnrollments.id, id));
}

async function sendStep(personId: number, step: typeof funnelSteps.$inferSelect) {
  const c = (step.config ?? {}) as StepConfig;
  const idn = await db().select().from(identities).where(and(eq(identities.personId, personId), eq(identities.botKey, BOT_KEY)));
  if (!idn[0]?.chatId || idn[0].blockedAt) return null;
  const kb = c.buttons?.length ? new InlineKeyboard() : undefined;
  c.buttons?.forEach((b) => { if (b.url) kb!.url(b.text, b.url).row(); else kb!.text(b.text, `fs:${step.id}`).row(); });
  const m = await getBot().api.sendMessage(idn[0].chatId, step.body ?? "", { reply_markup: kb, protect_content: c.protect, link_preview_options: { is_disabled: c.disablePreview ?? true } });
  return m.message_id;
}

/** Обробляє всі проходження, у яких настав час наступного кроку. Викликається cron-тіком. */
export async function processDue(limit = 100) {
  const d = db();
  const due = await d.select().from(funnelEnrollments).where(and(eq(funnelEnrollments.status, "active"), lte(funnelEnrollments.nextAt, new Date()))).orderBy(asc(funnelEnrollments.nextAt)).limit(limit);
  let sent = 0, finished = 0, failed = 0;
  for (const e of due) {
    const steps = await d.select().from(funnelSteps).where(eq(funnelSteps.funnelId, e.funnelId)).orderBy(asc(funnelSteps.position));
    const idx = steps.findIndex((s) => s.position >= e.nextPosition);
    if (idx < 0) { await d.update(funnelEnrollments).set({ status: "done", finishedAt: new Date() }).where(eq(funnelEnrollments.id, e.id)); finished++; continue; }
    const step = steps[idx];
    try {
      const mid = await sendStep(e.personId, step);
      if (mid == null) { await stopEnrollment(e.id, "bot_blocked"); failed++; continue; }
      await d.insert(funnelDeliveries).values({ enrollmentId: e.id, stepId: step.id, personId: e.personId, telegramMessageId: mid });
      sent++;
    } catch (err) { await stopEnrollment(e.id, "send_error: " + String(err).slice(0, 120)); failed++; continue; }
    const next = steps[idx + 1];
    if (!next) { await d.update(funnelEnrollments).set({ status: "done", finishedAt: new Date(), nextAt: null }).where(eq(funnelEnrollments.id, e.id)); finished++; }
    else {
      const c = (next.config ?? {}) as StepConfig;
      await d.update(funnelEnrollments).set({ nextPosition: next.position, nextAt: applyQuietHours(new Date(Date.now() + delayMs(c)), Boolean(c.quietHours)) }).where(eq(funnelEnrollments.id, e.id));
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  return { due: due.length, sent, finished, failed };
}

/** Вхід у воронку за ключовим словом або payload /start. */
export async function matchEntry(kind: "start" | "keyword", value: string) {
  const v = value.trim().toLowerCase(); if (!v) return null;
  const all = await db().select().from(funnels).where(and(eq(funnels.isActive, true), eq(funnels.source, "hub")));
  for (const f of all) {
    const s = (f.settings ?? {}) as { entryKind?: string; entryValue?: string };
    if (kind === "start" && s.entryKind === "start" && (s.entryValue ?? "").toLowerCase() === v) return f;
    if (kind === "keyword" && s.entryKind === "keyword" && (s.entryValue ?? "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean).includes(v)) return f;
  }
  return null;
}

export async function markClick(stepId: number, personId: number) {
  await db().update(funnelDeliveries).set({ clicked: true }).where(and(eq(funnelDeliveries.stepId, stepId), eq(funnelDeliveries.personId, personId)));
}
