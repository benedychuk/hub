import { and, asc, eq, lte, sql } from "drizzle-orm";
import { InlineKeyboard } from "grammy";
import { db, schema } from "@/db";
import { getBot, BOT_KEY } from "./bot";

const { funnels, funnelSteps, funnelEnrollments, funnelDeliveries, identities, events, persons, media } = schema;

export type StepButton = {
  text: string;
  kind?: "url" | "next" | "goto" | "funnel" | "offer" | "tag"; // url · наступний крок · перейти до кроку N · інша воронка · оффер · лише тег
  url?: string;
  target?: string; // номер кроку для goto, id воронки для funnel, url для offer
  tag?: string;    // тег за клік (порожньо = автотег)
};
export type StepConfig = {
  timing?: "delay" | "at";                 // після попереднього через delay · о конкретній годині
  delay?: { value: number; unit: "minutes" | "hours" | "days" };
  at?: { hour: number; minute: number };   // для timing = at: найближчий такий час (за Києвом), не раніше ніж delay
  quietHours?: boolean;
  mediaId?: number | null;
  buttons?: StepButton[];
  protect?: boolean;
  disablePreview?: boolean;
  tag?: string;                            // тег за отримання кроку (порожньо = автотег)
};

export function delayMs(c: StepConfig) {
  const d = c.delay; if (!d || !d.value) return 0;
  const m = d.unit === "days" ? 86400000 : d.unit === "hours" ? 3600000 : 60000;
  return d.value * m;
}

const KYIV = "Europe/Kyiv";
function kyivParts(t: Date) {
  const k = new Date(t.toLocaleString("en-US", { timeZone: KYIV }));
  return { k, offset: k.getTime() - t.getTime() };
}

/** Зсуває час у тихі години (22:00–09:00 Київ) на 09:00. */
export function applyQuietHours(t: Date, quiet: boolean) {
  if (!quiet) return t;
  const { k, offset } = kyivParts(t);
  const h = k.getHours();
  if (h >= 9 && h < 22) return t;
  const target = new Date(k); if (h >= 22) target.setDate(target.getDate() + 1); target.setHours(9, 0, 0, 0);
  return new Date(target.getTime() - offset);
}

/** Час наступного кроку за його конфігурацією, відлік від now. */
export function nextTime(c: StepConfig, from = new Date()) {
  let t = new Date(from.getTime() + delayMs(c));
  if (c.timing === "at" && c.at) {
    const { k, offset } = kyivParts(t);
    const target = new Date(k); target.setHours(c.at.hour, c.at.minute, 0, 0);
    if (target.getTime() <= k.getTime()) target.setDate(target.getDate() + 1);
    t = new Date(target.getTime() - offset);
  }
  return applyQuietHours(t, Boolean(c.quietHours));
}

export function slugOf(name: string) { return name.toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 24) || "fn"; }

export async function addTag(personId: number, tag: string, source = "funnel", payload: Record<string, unknown> = {}) {
  if (!tag) return;
  await db().update(persons).set({ tags: sql`(select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements(${persons.tags} || ${JSON.stringify([tag])}::jsonb) x)` }).where(eq(persons.id, personId));
  await db().insert(events).values({ personId, type: "tag.added", source, payload: { tag, ...payload } });
}

export async function enroll(funnelId: number, personId: number, reason = "manual") {
  const d = db();
  const [f] = await d.select().from(funnels).where(eq(funnels.id, funnelId));
  if (!f || !f.isActive) return null;
  const existing = await d.select().from(funnelEnrollments).where(and(eq(funnelEnrollments.funnelId, funnelId), eq(funnelEnrollments.personId, personId), eq(funnelEnrollments.status, "active")));
  if (existing[0]) return existing[0];
  const steps = await d.select().from(funnelSteps).where(eq(funnelSteps.funnelId, funnelId)).orderBy(asc(funnelSteps.position));
  if (!steps.length) return null;
  const nextAt = nextTime((steps[0].config ?? {}) as StepConfig);
  const [e] = await d.insert(funnelEnrollments).values({ funnelId, personId, nextPosition: steps[0].position, nextAt }).returning();
  await d.insert(events).values({ personId, type: "funnel.enrolled", source: "hub", payload: { funnelId, name: f.name, reason } });
  await d.update(funnels).set({ subscribersCount: sql`${funnels.subscribersCount} + 1` }).where(eq(funnels.id, funnelId));
  return e;
}

export async function stopEnrollment(id: number, reason: string) {
  const d = db();
  const [e] = await d.update(funnelEnrollments).set({ status: "stopped", stopReason: reason, finishedAt: new Date() }).where(eq(funnelEnrollments.id, id)).returning();
  if (e) { const [f] = await d.select({ name: funnels.name }).from(funnels).where(eq(funnels.id, e.funnelId)); await addTag(e.personId, `fn:${slugOf(f?.name ?? "fn")}:exit:${reason.split(":")[0]}`, "funnel"); }
}

/** Зупиняє всі активні проходження людини (наприклад, після оплати або слова «стоп»). */
export async function stopAllForPerson(personId: number, reason: string) {
  const rows = await db().select({ id: funnelEnrollments.id }).from(funnelEnrollments).where(and(eq(funnelEnrollments.personId, personId), eq(funnelEnrollments.status, "active")));
  for (const r of rows) await stopEnrollment(r.id, reason);
  return rows.length;
}

function keyboardFor(step: typeof funnelSteps.$inferSelect, c: StepConfig) {
  if (!c.buttons?.length) return undefined;
  const kb = new InlineKeyboard();
  c.buttons.forEach((b, i) => {
    const kind = b.kind ?? (b.url ? "url" : "next");
    if (kind === "url" && b.url) kb.url(b.text, b.url).row();
    else if (kind === "offer" && (b.target || b.url)) kb.url(b.text, (b.target || b.url)!).row();
    else kb.text(b.text, `fs:${step.id}:${i}`).row();
  });
  return kb;
}

/** Надсилає крок людині з урахуванням медіа; повертає message_id. */
export async function sendStep(personId: number, step: typeof funnelSteps.$inferSelect) {
  const c = (step.config ?? {}) as StepConfig;
  const [idn] = await db().select().from(identities).where(and(eq(identities.personId, personId), eq(identities.botKey, BOT_KEY)));
  if (!idn?.chatId || idn.blockedAt) return null;
  const api = getBot().api; const chat = idn.chatId;
  const kb = keyboardFor(step, c);
  const common = { reply_markup: kb, protect_content: c.protect };
  const body = step.body ?? "";
  const med = c.mediaId ? (await db().select().from(media).where(eq(media.id, c.mediaId)))[0] : null;
  if (!med) {
    const m = await api.sendMessage(chat, body || "…", { ...common, link_preview_options: { is_disabled: c.disablePreview ?? true } });
    return m.message_id;
  }
  const caption = body.length <= 1024 ? body : undefined;
  let m;
  switch (med.kind) {
    case "photo": m = await api.sendPhoto(chat, med.fileId, { caption, ...common }); break;
    case "video": m = await api.sendVideo(chat, med.fileId, { caption, ...common }); break;
    case "animation": m = await api.sendAnimation(chat, med.fileId, { caption, ...common }); break;
    case "audio": m = await api.sendAudio(chat, med.fileId, { caption, ...common }); break;
    case "voice": m = await api.sendVoice(chat, med.fileId, { caption, ...common }); break;
    case "document": m = await api.sendDocument(chat, med.fileId, { caption, ...common }); break;
    case "sticker": m = await api.sendSticker(chat, med.fileId, { ...common }); break;
    case "video_note": m = await api.sendVideoNote(chat, med.fileId, { protect_content: c.protect, reply_markup: body ? undefined : kb }); break; // кружечок не має підпису
    default: m = await api.sendMessage(chat, body || "…", common);
  }
  // кружечок: текст і кнопки йдуть окремим повідомленням; довгий текст після медіа — теж окремо
  if (med.kind === "video_note" && body) { const t = await api.sendMessage(chat, body, { ...common, link_preview_options: { is_disabled: true } }); return t.message_id; }
  if (med.kind !== "video_note" && med.kind !== "sticker" && body.length > 1024) { const t = await api.sendMessage(chat, body, { ...common, link_preview_options: { is_disabled: true } }); return t.message_id; }
  return m.message_id;
}

async function afterSend(e: typeof funnelEnrollments.$inferSelect, step: typeof funnelSteps.$inferSelect, steps: typeof funnelSteps.$inferSelect[], idx: number, funnelName: string) {
  const d = db();
  const c = (step.config ?? {}) as StepConfig;
  await addTag(e.personId, c.tag || `fn:${slugOf(funnelName)}:s${idx + 1}`, "funnel", { funnelId: e.funnelId, stepId: step.id });
  const next = steps[idx + 1];
  if (!next) { await d.update(funnelEnrollments).set({ status: "done", finishedAt: new Date(), nextAt: null }).where(eq(funnelEnrollments.id, e.id)); return "done"; }
  await d.update(funnelEnrollments).set({ nextPosition: next.position, nextAt: nextTime((next.config ?? {}) as StepConfig) }).where(eq(funnelEnrollments.id, e.id));
  return "next";
}

/** Обробляє всі проходження, у яких настав час наступного кроку. Викликається cron-тіком. */
export async function processDue(limit = 100) {
  const d = db();
  const due = await d.select().from(funnelEnrollments).where(and(eq(funnelEnrollments.status, "active"), lte(funnelEnrollments.nextAt, new Date()))).orderBy(asc(funnelEnrollments.nextAt)).limit(limit);
  let sent = 0, finished = 0, failed = 0;
  for (const e of due) {
    const [f] = await d.select({ name: funnels.name }).from(funnels).where(eq(funnels.id, e.funnelId));
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
    if ((await afterSend(e, step, steps, idx, f?.name ?? "fn")) === "done") finished++;
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

/** Клік по кнопці кроку: тег, лічильник і дія кнопки. */
export async function onButtonClick(stepId: number, btnIdx: number, personId: number) {
  const d = db();
  const [step] = await d.select().from(funnelSteps).where(eq(funnelSteps.id, stepId));
  if (!step) return;
  const c = (step.config ?? {}) as StepConfig;
  const b = c.buttons?.[btnIdx];
  const [f] = await d.select({ name: funnels.name }).from(funnels).where(eq(funnels.id, step.funnelId));
  const steps = await d.select().from(funnelSteps).where(eq(funnelSteps.funnelId, step.funnelId)).orderBy(asc(funnelSteps.position));
  const idx = steps.findIndex((s) => s.id === stepId);
  await d.update(funnelDeliveries).set({ clicked: true }).where(and(eq(funnelDeliveries.stepId, stepId), eq(funnelDeliveries.personId, personId)));
  await addTag(personId, b?.tag || `fn:${slugOf(f?.name ?? "fn")}:s${idx + 1}:btn${btnIdx + 1}`, "funnel", { stepId, button: b?.text });
  if (!b) return;
  const [enr] = await d.select().from(funnelEnrollments).where(and(eq(funnelEnrollments.funnelId, step.funnelId), eq(funnelEnrollments.personId, personId), eq(funnelEnrollments.status, "active")));
  const kind = b.kind ?? (b.url ? "url" : "next");
  if (kind === "next" || kind === "goto") {
    const targetIdx = kind === "goto" ? Math.max(0, Number(b.target || 1) - 1) : idx + 1;
    const target = steps[targetIdx];
    if (!target) { if (enr) await d.update(funnelEnrollments).set({ status: "done", finishedAt: new Date(), nextAt: null }).where(eq(funnelEnrollments.id, enr.id)); return; }
    if (enr) await d.update(funnelEnrollments).set({ nextPosition: target.position, nextAt: new Date() }).where(eq(funnelEnrollments.id, enr.id));
    else await d.insert(funnelEnrollments).values({ funnelId: step.funnelId, personId, nextPosition: target.position, nextAt: new Date() });
    await processDue(5);
  } else if (kind === "funnel" && b.target) {
    if (enr) await stopEnrollment(enr.id, "button");
    await enroll(Number(b.target), personId, "button");
    await processDue(5);
  }
}
