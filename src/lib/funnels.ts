import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { InlineKeyboard, InputFile, InputMediaBuilder } from "grammy";
import { db, schema } from "@/db";
import { getBot, BOT_KEY } from "./bot";
import { payLink } from "./payments";

const { funnels, funnelSteps, funnelEnrollments, funnelDeliveries, funnelCommands, identities, events, persons, media } = schema;

export type StepType = "message" | "lesson" | "assignment" | "survey" | "quiz" | "question";
export const STEP_TYPES: { key: StepType; label: string; hint: string }[] = [
  { key: "message", label: "Повідомлення", hint: "текст, медіа, кнопки" },
  { key: "lesson", label: "Урок", hint: "відео або матеріал з назвою уроку" },
  { key: "assignment", label: "Завдання", hint: "чекає відповідь учасниці" },
  { key: "survey", label: "Опитування", hint: "варіанти відповіді, без правильної" },
  { key: "quiz", label: "Тест", hint: "варіанти з правильною відповіддю" },
  { key: "question", label: "Запитання", hint: "вільна відповідь, зберігається в картку" },
];

export const STEP_ICON: Record<string, string> = { message: "✉", lesson: "🎓", assignment: "📝", survey: "📊", quiz: "✅", question: "❓" };

export type SendTime = { mode: "no" | "immediately" | "after" | "exact" | "after_action"; value?: number; unit?: "minutes" | "hours" | "days"; day?: number; time?: string };
export type AutoDelete = { mode: "never" | "in"; value?: number; unit?: "seconds" | "minutes" | "hours" };
export type StepButton = { text: string; kind: "url" | "step" | "next" | "funnel" | "offer" | "tag" | "option"; target?: string; tag?: string; correct?: boolean };
export type StepConfig = {
  sendTime?: SendTime;
  autodelete?: AutoDelete;
  protect?: boolean;
  preview?: boolean;
  quietHours?: boolean;
  attachments?: number[];
  buttons?: StepButton[];
  tag?: string;
  saveTo?: string;      // question: назва поля в картці
  correctText?: string; // quiz: повідомлення при правильній відповіді
  wrongText?: string;   // quiz: при неправильній
};
export type FunnelSettings = {
  entryKind?: "manual" | "start" | "keyword"; entryValue?: string;
  accessDirect?: boolean; accessAfterFinish?: boolean;
  contentProtection?: boolean; restart?: boolean; lessonTitles?: boolean; template?: boolean;
  quietHours?: boolean;
};

const KYIV = "Europe/Kyiv";
function kyivParts(t: Date) { const k = new Date(t.toLocaleString("en-US", { timeZone: KYIV })); return { k, offset: k.getTime() - t.getTime() }; }
const UNIT_MS = { seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000 } as const;

export function applyQuietHours(t: Date, quiet: boolean) {
  if (!quiet) return t;
  const { k, offset } = kyivParts(t); const h = k.getHours();
  if (h >= 9 && h < 22) return t;
  const target = new Date(k); if (h >= 22) target.setDate(target.getDate() + 1); target.setHours(9, 0, 0, 0);
  return new Date(target.getTime() - offset);
}

/** Коли надсилати крок, якщо попередній надіслано в base. null = не надсилати автоматично («No»). */
export function scheduleFor(c: StepConfig, base: Date, quiet = false): Date | null {
  const st = c.sendTime ?? { mode: "immediately" };
  if (st.mode === "no" || st.mode === "after_action") return null;
  if (st.mode === "immediately") return base;
  if (st.mode === "after") return applyQuietHours(new Date(base.getTime() + (st.value ?? 0) * UNIT_MS[st.unit ?? "hours"]), quiet || Boolean(c.quietHours));
  // exact: день N після base о HH:MM за Києвом (день 0 = того самого дня, якщо час ще попереду)
  const [h, m] = (st.time ?? "12:00").split(":").map(Number);
  const { k, offset } = kyivParts(base);
  const target = new Date(k); target.setDate(target.getDate() + (st.day ?? 1)); target.setHours(h || 0, m || 0, 0, 0);
  if (target.getTime() <= k.getTime()) target.setDate(target.getDate() + 1);
  return new Date(target.getTime() - offset);
}

export function sendTimeLabel(c: StepConfig) {
  const st = c.sendTime ?? { mode: "immediately" };
  const u: Record<string, string> = { minutes: "хв", hours: "год", days: "дн" };
  if (st.mode === "no") return "Ні";
  if (st.mode === "after_action") return "Після дії";
  if (st.mode === "immediately") return "Одразу";
  if (st.mode === "after") return `Через ${st.value ?? 0} ${u[st.unit ?? "hours"]}`;
  return `День ${st.day ?? 1} о ${st.time ?? "12:00"}`;
}
export function autodeleteLabel(c: StepConfig) {
  const a = c.autodelete ?? { mode: "never" }; const u: Record<string, string> = { seconds: "с", minutes: "хв", hours: "год" };
  return a.mode === "never" ? "Ніколи" : `Через ${a.value ?? 0} ${u[a.unit ?? "hours"]}`;
}

export function slugOf(name: string) { return name.toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 24) || "fn"; }

export async function addTag(personId: number, tag: string, source = "funnel", payload: Record<string, unknown> = {}) {
  if (!tag) return;
  await db().update(persons).set({ tags: sql`(select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements(${persons.tags} || ${JSON.stringify([tag])}::jsonb) x)` }).where(eq(persons.id, personId));
  await db().insert(events).values({ personId, type: "tag.added", source, payload: { tag, ...payload } });
}

async function activeSteps(funnelId: number) {
  return db().select().from(funnelSteps).where(and(eq(funnelSteps.funnelId, funnelId), eq(funnelSteps.isActive, true))).orderBy(asc(funnelSteps.position), asc(funnelSteps.id));
}

/** Перший крок після позиції pos, який надсилається автоматично (send time ≠ «Ні»). */
function nextAuto(steps: typeof funnelSteps.$inferSelect[], afterIdx: number) {
  for (let i = afterIdx + 1; i < steps.length; i++) { const m = ((steps[i].config ?? {}) as StepConfig).sendTime?.mode; if (m !== "no" && m !== "after_action") return { step: steps[i], idx: i }; }
  return null;
}

export async function enroll(funnelId: number, personId: number, reason = "manual") {
  const d = db();
  const [f] = await d.select().from(funnels).where(eq(funnels.id, funnelId));
  if (!f || !f.isActive) return null;
  const fs = (f.settings ?? {}) as FunnelSettings;
  const [existing] = await d.select().from(funnelEnrollments).where(and(eq(funnelEnrollments.funnelId, funnelId), eq(funnelEnrollments.personId, personId))).orderBy(desc(funnelEnrollments.startedAt)).limit(1);
  if (existing?.status === "active") return existing;
  if (existing && !fs.restart) return existing; // перезапуск вимкнено
  const steps = await activeSteps(funnelId);
  const first = nextAuto(steps, -1);
  const now = new Date();
  const nextAt = first ? scheduleFor((first.step.config ?? {}) as StepConfig, now, fs.quietHours) : null;
  const product = f.kind === "product"; // продукт: доступ триває, поки є право, навіть без автоматичних кроків
  const [e] = await d.insert(funnelEnrollments).values({ funnelId, personId, nextPosition: first?.step.position ?? 0, nextAt, status: first || product ? "active" : "done", lastStepAt: now, finishedAt: first || product ? null : now }).returning();
  await d.insert(events).values({ personId, type: "funnel.enrolled", source: "hub", payload: { funnelId, name: f.name, reason } });
  await d.update(funnels).set({ subscribersCount: sql`(select count(distinct person_id)::int from funnel_enrollments where funnel_id = ${funnelId})` }).where(eq(funnels.id, funnelId));
  await applyMenu(personId);
  return e;
}

/** Доступ до продукту повернувся (нова оплата, посилання доступу): відновлює зупинене проходження або створює нове. */
export async function reactivateOrEnroll(funnelId: number, personId: number, reason = "offer") {
  const d = db();
  const [f] = await d.select().from(funnels).where(eq(funnels.id, funnelId)); if (!f || !f.isActive) return null;
  const [existing] = await d.select().from(funnelEnrollments).where(and(eq(funnelEnrollments.funnelId, funnelId), eq(funnelEnrollments.personId, personId))).orderBy(desc(funnelEnrollments.startedAt)).limit(1);
  if (existing?.status === "active") return existing;
  if (!existing) return enroll(funnelId, personId, reason);
  const [delivered] = await d.select({ c: sql<number>`count(*)::int` }).from(funnelDeliveries).where(eq(funnelDeliveries.enrollmentId, existing.id));
  const steps = await activeSteps(funnelId); const now = new Date();
  // нічого не надсилали (доступ скінчився раніше за перший крок) — починаємо спочатку; інакше лише повертаємо доступ до меню й кнопок
  const first = delivered.c === 0 ? nextAuto(steps, -1) : null;
  const [e] = await d.update(funnelEnrollments).set({ status: "active", finishedAt: null, stopReason: null, nextPosition: first ? first.step.position : existing.nextPosition, nextAt: first ? scheduleFor((first.step.config ?? {}) as StepConfig, now, ((f.settings ?? {}) as FunnelSettings).quietHours) : existing.nextAt }).where(eq(funnelEnrollments.id, existing.id)).returning();
  await d.insert(events).values({ personId, type: "funnel.enrolled", source: "hub", payload: { funnelId, name: f.name, reason, resumed: true } });
  await applyMenu(personId);
  return e;
}
/** Видаляє з бота всі надіслані кроки проходження (оффер: «прибрати контент після закінчення доступу»). */
export async function deleteDelivered(enrollmentId: number) {
  const d = db();
  const rows = await d.select({ dl: funnelDeliveries, chatId: identities.chatId }).from(funnelDeliveries).innerJoin(identities, and(eq(identities.personId, funnelDeliveries.personId), eq(identities.botKey, BOT_KEY))).where(and(eq(funnelDeliveries.enrollmentId, enrollmentId), isNull(funnelDeliveries.deletedAt)));
  let n = 0;
  for (const { dl, chatId } of rows) {
    for (const mid of [dl.telegramMessageId, ...(dl.extraMessageIds ?? [])]) { if (mid && chatId) { await getBot().api.deleteMessage(chatId, mid).catch(() => null); n++; } }
    await d.update(funnelDeliveries).set({ deletedAt: new Date() }).where(eq(funnelDeliveries.id, dl.id));
  }
  return n;
}

export async function stopEnrollment(id: number, reason: string) {
  const d = db();
  const [e] = await d.update(funnelEnrollments).set({ status: "stopped", stopReason: reason, finishedAt: new Date(), awaitingStepId: null }).where(eq(funnelEnrollments.id, id)).returning();
  if (e) { const [f] = await d.select({ name: funnels.name }).from(funnels).where(eq(funnels.id, e.funnelId)); await addTag(e.personId, `fn:${slugOf(f?.name ?? "fn")}:exit:${reason.split(":")[0]}`, "funnel"); }
}
export async function stopAllForPerson(personId: number, reason: string) {
  const rows = await db().select({ id: funnelEnrollments.id }).from(funnelEnrollments).where(and(eq(funnelEnrollments.personId, personId), eq(funnelEnrollments.status, "active")));
  for (const r of rows) await stopEnrollment(r.id, reason);
  return rows.length;
}

function keyboardFor(step: typeof funnelSteps.$inferSelect, c: StepConfig, personId: number) {
  if (!c.buttons?.length) return undefined;
  const kb = new InlineKeyboard();
  c.buttons.forEach((b, i) => {
    if (b.kind === "offer" && b.target?.startsWith("hub:")) kb.url(b.text, payLink(personId, b.target.slice(4), "first")).row(); // оффер Hub: персональне посилання на оплату
    else if ((b.kind === "url" || b.kind === "offer") && b.target) kb.url(b.text, b.target).row();
    else kb.text(b.text, `fs:${step.id}:${i}`).row();
  });
  return kb;
}

/** Надсилає крок людині. Повертає message_id основного повідомлення і додаткових. */
export async function sendStep(personId: number, step: typeof funnelSteps.$inferSelect, funnelProtect = false) {
  const c = (step.config ?? {}) as StepConfig;
  const [idn] = await db().select().from(identities).where(and(eq(identities.personId, personId), eq(identities.botKey, BOT_KEY)));
  if (!idn?.chatId || idn.blockedAt) return null;
  const api = getBot().api; const chat = idn.chatId;
  const kb = keyboardFor(step, c, personId);
  const protect = Boolean(c.protect || funnelProtect);
  const [f] = await db().select({ settings: funnels.settings }).from(funnels).where(eq(funnels.id, step.funnelId));
  const lessonTitles = Boolean(((f?.settings ?? {}) as FunnelSettings).lessonTitles);
  const body = (step.type === "lesson" && lessonTitles && step.title ? `<b>${step.title}</b>\n\n` : "") + (step.body ?? "");
  const ids: number[] = [];
  const meds = c.attachments?.length ? await db().select().from(media).where(inArray(media.id, c.attachments)) : [];
  const ordered = (c.attachments ?? []).map((id) => meds.find((m) => m.id === id)).filter(Boolean) as typeof meds;
  const opts = { protect_content: protect, parse_mode: "HTML" as const };
  const captionable = ordered.filter((m) => ["photo", "video", "animation", "audio", "voice", "document"].includes(m.kind));
  const others = ordered.filter((m) => !captionable.includes(m));
  let mainId: number | null = null;
  // окремі типи (кружечок, стікер) — завжди окремими повідомленнями, перед текстом
  for (const m of others) {
    const r = m.kind === "video_note" ? await api.sendVideoNote(chat, m.fileId, { protect_content: protect }) : await api.sendSticker(chat, m.fileId, { protect_content: protect });
    ids.push(r.message_id);
  }
  const useCaption = captionable.length === 1 && body.length <= 1024;
  if (captionable.length === 1) {
    const m = captionable[0]; const caption = useCaption ? body : undefined; const rm = useCaption ? kb : undefined;
    const r = m.kind === "photo" ? await api.sendPhoto(chat, m.fileId, { caption, reply_markup: rm, ...opts })
      : m.kind === "video" ? await api.sendVideo(chat, m.fileId, { caption, reply_markup: rm, ...opts })
      : m.kind === "animation" ? await api.sendAnimation(chat, m.fileId, { caption, reply_markup: rm, ...opts })
      : m.kind === "audio" ? await api.sendAudio(chat, m.fileId, { caption, reply_markup: rm, ...opts })
      : m.kind === "voice" ? await api.sendVoice(chat, m.fileId, { caption, reply_markup: rm, ...opts })
      : await api.sendDocument(chat, m.fileId, { caption, reply_markup: rm, ...opts });
    if (useCaption) mainId = r.message_id; else ids.push(r.message_id);
  } else if (captionable.length > 1) {
    const group = captionable.filter((m) => ["photo", "video"].includes(m.kind)).slice(0, 10);
    if (group.length > 1) {
      const items = group.map((m) => m.kind === "photo" ? InputMediaBuilder.photo(m.fileId) : InputMediaBuilder.video(m.fileId));
      const r = await api.sendMediaGroup(chat, items, { protect_content: protect }); r.forEach((x) => ids.push(x.message_id));
    }
    for (const m of captionable.filter((m) => !group.includes(m))) {
      const r = m.kind === "audio" ? await api.sendAudio(chat, m.fileId, opts) : m.kind === "voice" ? await api.sendVoice(chat, m.fileId, opts) : m.kind === "animation" ? await api.sendAnimation(chat, m.fileId, opts) : await api.sendDocument(chat, m.fileId, opts);
      ids.push(r.message_id);
    }
  }
  if (mainId == null) {
    if (body || kb) { const r = await api.sendMessage(chat, body || "…", { reply_markup: kb, link_preview_options: { is_disabled: !c.preview }, ...opts }); mainId = r.message_id; }
    else if (ids.length) mainId = ids.shift()!;
  }
  return { mainId: mainId!, extra: ids };
}

async function afterSend(e: typeof funnelEnrollments.$inferSelect, step: typeof funnelSteps.$inferSelect, steps: typeof funnelSteps.$inferSelect[], idx: number, f: { name: string; settings: unknown }) {
  const d = db();
  const c = (step.config ?? {}) as StepConfig;
  const fs = (f.settings ?? {}) as FunnelSettings;
  await addTag(e.personId, c.tag || `fn:${slugOf(f.name)}:s${idx + 1}`, "funnel", { funnelId: e.funnelId, stepId: step.id });
  const awaiting = ["assignment", "question", "survey", "quiz"].includes(step.type) ? step.id : null;
  const next = nextAuto(steps, idx);
  const now = new Date();
  if (!next) { await d.update(funnelEnrollments).set({ status: "done", finishedAt: now, nextAt: null, lastStepAt: now, awaitingStepId: awaiting }).where(eq(funnelEnrollments.id, e.id)); return "done"; }
  await d.update(funnelEnrollments).set({ nextPosition: next.step.position, nextAt: scheduleFor((next.step.config ?? {}) as StepConfig, now, fs.quietHours), lastStepAt: now, awaitingStepId: awaiting }).where(eq(funnelEnrollments.id, e.id));
  return "next";
}

async function deliver(e: typeof funnelEnrollments.$inferSelect, step: typeof funnelSteps.$inferSelect, fs: FunnelSettings) {
  const r = await sendStep(e.personId, step, Boolean(fs.contentProtection));
  if (!r) return false;
  const c = (step.config ?? {}) as StepConfig;
  const a = c.autodelete ?? { mode: "never" };
  const deleteAt = a.mode === "in" && a.value ? new Date(Date.now() + Math.min(a.value * UNIT_MS[a.unit ?? "hours"], 48 * 3600000)) : null;
  await db().insert(funnelDeliveries).values({ enrollmentId: e.id, stepId: step.id, personId: e.personId, telegramMessageId: r.mainId, extraMessageIds: r.extra, deleteAt });
  return true;
}

/** Тік: надсилає кроки, у яких настав час. */
export async function processDue(limit = 100) {
  const d = db();
  const due = await d.select().from(funnelEnrollments).where(and(eq(funnelEnrollments.status, "active"), isNotNull(funnelEnrollments.nextAt), lte(funnelEnrollments.nextAt, new Date()))).orderBy(asc(funnelEnrollments.nextAt)).limit(limit);
  let sent = 0, finished = 0, failed = 0;
  for (const e of due) {
    const [f] = await d.select({ name: funnels.name, settings: funnels.settings, isActive: funnels.isActive }).from(funnels).where(eq(funnels.id, e.funnelId));
    if (!f?.isActive) { await d.update(funnelEnrollments).set({ nextAt: null }).where(eq(funnelEnrollments.id, e.id)); continue; } // воронку зупинено: чекаємо
    const steps = await activeSteps(e.funnelId);
    const idx = steps.findIndex((s) => s.position >= e.nextPosition);
    if (idx < 0) { await d.update(funnelEnrollments).set({ status: "done", finishedAt: new Date(), nextAt: null }).where(eq(funnelEnrollments.id, e.id)); finished++; continue; }
    const step = steps[idx];
    try {
      const ok = await deliver(e, step, (f.settings ?? {}) as FunnelSettings);
      if (!ok) { await stopEnrollment(e.id, "bot_blocked"); failed++; continue; }
      sent++;
    } catch (err) { await stopEnrollment(e.id, "send_error: " + String(err).slice(0, 120)); failed++; continue; }
    if ((await afterSend(e, step, steps, idx, f)) === "done") finished++;
    await new Promise((r) => setTimeout(r, 40));
  }
  return { due: due.length, sent, finished, failed };
}

/** Тік: автовидалення повідомлень, у яких минув строк. */
export async function processDeletions(limit = 200) {
  const d = db();
  const rows = await d.select({ dl: funnelDeliveries, chatId: identities.chatId }).from(funnelDeliveries).innerJoin(identities, and(eq(identities.personId, funnelDeliveries.personId), eq(identities.botKey, BOT_KEY)))
    .where(and(isNull(funnelDeliveries.deletedAt), isNotNull(funnelDeliveries.deleteAt), lte(funnelDeliveries.deleteAt, new Date()))).limit(limit);
  let deleted = 0;
  for (const { dl, chatId } of rows) {
    for (const mid of [dl.telegramMessageId, ...(dl.extraMessageIds ?? [])]) { if (mid && chatId) await getBot().api.deleteMessage(chatId, mid).catch(() => null); }
    await d.update(funnelDeliveries).set({ deletedAt: new Date() }).where(eq(funnelDeliveries.id, dl.id)); deleted++;
  }
  return { deleted };
}

/** Надіслати конкретний крок людині негайно (кнопка «наступний крок», меню, ↻). */
export async function sendStepNow(funnelId: number, stepId: number, personId: number) {
  const d = db();
  const [f] = await d.select().from(funnels).where(eq(funnels.id, funnelId));
  const steps = await activeSteps(funnelId);
  const idx = steps.findIndex((s) => s.id === stepId);
  if (!f || idx < 0) return false;
  let [enr] = await d.select().from(funnelEnrollments).where(and(eq(funnelEnrollments.funnelId, funnelId), eq(funnelEnrollments.personId, personId))).orderBy(desc(funnelEnrollments.startedAt)).limit(1);
  if (!enr) [enr] = await d.insert(funnelEnrollments).values({ funnelId, personId, nextPosition: steps[idx].position, status: "active" }).returning();
  const ok = await deliver(enr, steps[idx], (f.settings ?? {}) as FunnelSettings);
  if (!ok) return false;
  if (enr.status !== "active") await d.update(funnelEnrollments).set({ status: "active", finishedAt: null }).where(eq(funnelEnrollments.id, enr.id));
  await afterSend({ ...enr, status: "active" }, steps[idx], steps, idx, f);
  return true;
}

/** Вхід за ключовим словом або payload /start (f_<id> або власний параметр). */
export async function matchEntry(kind: "start" | "keyword", value: string) {
  const v = value.trim().toLowerCase(); if (!v) return null;
  if (kind === "start" && /^f_\d+$/.test(v)) { const [f] = await db().select().from(funnels).where(and(eq(funnels.id, Number(v.slice(2))), eq(funnels.isActive, true), eq(funnels.kind, "funnel"))); return f ?? null; }
  const all = await db().select().from(funnels).where(and(eq(funnels.isActive, true), eq(funnels.source, "hub"), eq(funnels.kind, "funnel")));
  for (const f of all) {
    const s = (f.settings ?? {}) as FunnelSettings;
    if (kind === "start" && s.entryKind === "start" && (s.entryValue ?? "").toLowerCase() === v) return f;
    if (kind === "keyword" && s.entryKind === "keyword" && (s.entryValue ?? "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean).includes(v)) return f;
  }
  return null;
}

/** Воронки з доступом «після прямої підписки на бота»: людина потрапляє в них на /start без параметра. */
export async function enrollDirectAccess(personId: number) {
  const all = await db().select().from(funnels).where(and(eq(funnels.isActive, true), eq(funnels.source, "hub"), eq(funnels.kind, "funnel")));
  let n = 0;
  for (const f of all) if (((f.settings ?? {}) as FunnelSettings).accessDirect) { if (await enroll(f.id, personId, "direct")) n++; }
  return n;
}

/** Крок «після дії»: коли людина відповіла або натиснула кнопку, надсилаємо наступний крок, якщо в нього режим «Після дії». */
async function triggerAfterAction(funnelId: number, stepId: number, personId: number) {
  const steps = await activeSteps(funnelId);
  const idx = steps.findIndex((s) => s.id === stepId);
  const next = idx >= 0 ? steps[idx + 1] : undefined;
  if (next && ((next.config ?? {}) as StepConfig).sendTime?.mode === "after_action") await sendStepNow(funnelId, next.id, personId);
}

/** Клік по кнопці кроку. */
export async function onButtonClick(stepId: number, btnIdx: number, personId: number): Promise<string | null> {
  const d = db();
  const [step] = await d.select().from(funnelSteps).where(eq(funnelSteps.id, stepId));
  if (!step) return null;
  const c = (step.config ?? {}) as StepConfig;
  const b = c.buttons?.[btnIdx];
  const [f] = await d.select({ name: funnels.name }).from(funnels).where(eq(funnels.id, step.funnelId));
  const steps = await activeSteps(step.funnelId);
  const idx = steps.findIndex((s) => s.id === stepId);
  await d.update(funnelDeliveries).set({ clicked: true }).where(and(eq(funnelDeliveries.stepId, stepId), eq(funnelDeliveries.personId, personId)));
  await addTag(personId, b?.tag || `fn:${slugOf(f?.name ?? "fn")}:s${idx + 1}:btn${btnIdx + 1}`, "funnel", { stepId, button: b?.text });
  if (!b) return null;
  if (b.kind === "option") {
    await d.update(funnelDeliveries).set({ answer: b.text, answeredAt: new Date() }).where(and(eq(funnelDeliveries.stepId, stepId), eq(funnelDeliveries.personId, personId)));
    await d.insert(events).values({ personId, type: "funnel.answer", source: "funnel", payload: { stepId, stepType: step.type, answer: b.text, correct: b.correct ?? null } });
    if (c.saveTo) await d.update(persons).set({ customFields: sql`coalesce(${persons.customFields}, '{}'::jsonb) || ${JSON.stringify({ [c.saveTo]: b.text })}::jsonb` }).where(eq(persons.id, personId));
    await d.update(funnelEnrollments).set({ awaitingStepId: null }).where(and(eq(funnelEnrollments.funnelId, step.funnelId), eq(funnelEnrollments.personId, personId)));
    await triggerAfterAction(step.funnelId, step.id, personId);
    if (step.type === "quiz") return b.correct ? (c.correctText || "✅ Правильно!") : (c.wrongText || "❌ Не зовсім. Спробуй ще раз або рухаймося далі.");
    return null;
  }
  if (b.kind === "tag") await triggerAfterAction(step.funnelId, step.id, personId);
  if (b.kind === "next") { const n = steps[idx + 1]; if (n) await sendStepNow(step.funnelId, n.id, personId); }
  else if (b.kind === "step" && b.target) await sendStepNow(step.funnelId, Number(b.target), personId);
  else if (b.kind === "funnel" && b.target) { const [enr] = await d.select().from(funnelEnrollments).where(and(eq(funnelEnrollments.funnelId, step.funnelId), eq(funnelEnrollments.personId, personId), eq(funnelEnrollments.status, "active"))); if (enr) await stopEnrollment(enr.id, "button"); await enroll(Number(b.target), personId, "button"); await processDue(5); }
  return null;
}

/** Текстова відповідь людини: якщо є крок, що чекає відповіді (завдання/запитання), зберігаємо. */
export async function onFreeText(personId: number, text: string): Promise<boolean> {
  const d = db();
  const [enr] = await d.select().from(funnelEnrollments).where(and(eq(funnelEnrollments.personId, personId), isNotNull(funnelEnrollments.awaitingStepId))).orderBy(desc(funnelEnrollments.lastStepAt)).limit(1);
  if (!enr?.awaitingStepId) return false;
  const [step] = await d.select().from(funnelSteps).where(eq(funnelSteps.id, enr.awaitingStepId));
  if (!step || !["assignment", "question"].includes(step.type)) return false;
  const c = (step.config ?? {}) as StepConfig;
  await d.update(funnelDeliveries).set({ answer: text, answeredAt: new Date() }).where(and(eq(funnelDeliveries.stepId, step.id), eq(funnelDeliveries.personId, personId)));
  await d.insert(events).values({ personId, type: step.type === "assignment" ? "funnel.assignment" : "funnel.answer", source: "funnel", payload: { stepId: step.id, stepType: step.type, answer: text } });
  if (c.saveTo) await d.update(persons).set({ customFields: sql`coalesce(${persons.customFields}, '{}'::jsonb) || ${JSON.stringify({ [c.saveTo]: text })}::jsonb` }).where(eq(persons.id, personId));
  await d.update(funnelEnrollments).set({ awaitingStepId: null }).where(eq(funnelEnrollments.id, enr.id));
  await triggerAfterAction(step.funnelId, step.id, personId);
  return true;
}

/** Команда меню воронки: /command від людини, яка є в цій воронці. */
export async function onCommand(personId: number, command: string): Promise<string | null> {
  const d = db();
  const rows = await d.select({ c: funnelCommands, fid: funnels.id, fActive: funnels.isActive, settings: funnels.settings }).from(funnelCommands).innerJoin(funnels, eq(funnels.id, funnelCommands.funnelId)).where(eq(funnelCommands.command, command.toLowerCase()));
  for (const r of rows) {
    const fs = (r.settings ?? {}) as FunnelSettings;
    const [enr] = await d.select().from(funnelEnrollments).where(and(eq(funnelEnrollments.funnelId, r.fid), eq(funnelEnrollments.personId, personId))).orderBy(desc(funnelEnrollments.startedAt)).limit(1);
    if (!enr) continue;
    if (enr.status !== "active" && !fs.accessAfterFinish) continue;
    if (r.c.action.type === "step" && r.c.action.stepId) { await sendStepNow(r.fid, r.c.action.stepId, personId); return ""; }
    return r.c.action.text ?? "";
  }
  return null;
}

/** Декодує обкладинку з data URL у буфер для sendPhoto. */
export function coverFile(cover: string | null | undefined) {
  const m = cover?.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!m) return null;
  return new InputFile(Buffer.from(m[2], "base64"), m[1] === "image/png" ? "cover.png" : m[1] === "image/webp" ? "cover.webp" : "cover.jpg");
}

/** Вступне повідомлення воронки (обкладинка + опис + кнопка «Отримати доступ»), як у ZenEdu за посиланням на воронку.
 *  Повертає false, якщо вступу немає (тоді людину одразу записують у воронку). */
export async function sendIntro(funnelId: number, personId: number) {
  const d = db();
  const [f] = await d.select().from(funnels).where(eq(funnels.id, funnelId));
  if (!f || !f.isActive || (!f.description && !f.cover)) return false;
  const [idn] = await d.select().from(identities).where(and(eq(identities.personId, personId), eq(identities.botKey, BOT_KEY)));
  if (!idn?.chatId) return false;
  const api = getBot().api;
  const kb = new InlineKeyboard().text(f.buttonText || "Отримати доступ", `fstart:${f.id}`);
  const text = `<b>${escapeHtml(f.name)}</b>${f.description ? "\n\n" + f.description : ""}`;
  const photo = coverFile(f.cover);
  if (photo && text.length <= 1024) await api.sendPhoto(idn.chatId, photo, { caption: text, parse_mode: "HTML", reply_markup: kb });
  else { if (photo) await api.sendPhoto(idn.chatId, photo); await api.sendMessage(idn.chatId, text, { parse_mode: "HTML", reply_markup: kb, link_preview_options: { is_disabled: true } }); }
  await d.insert(events).values({ personId, type: "funnel.intro", source: "hub", payload: { funnelId } });
  return true;
}

export function escapeHtml(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

/** Меню бота для конкретної людини: команди воронок, у яких вона зараз є (як у ZenEdu, меню прив'язане до воронки). */
export async function applyMenu(personId: number) {
  const d = db();
  const [idn] = await d.select().from(identities).where(and(eq(identities.personId, personId), eq(identities.botKey, BOT_KEY)));
  if (!idn?.chatId) return;
  const rows = await d.select({ c: funnelCommands, settings: funnels.settings, status: funnelEnrollments.status })
    .from(funnelCommands)
    .innerJoin(funnels, eq(funnels.id, funnelCommands.funnelId))
    .innerJoin(funnelEnrollments, and(eq(funnelEnrollments.funnelId, funnels.id), eq(funnelEnrollments.personId, personId)))
    .where(eq(funnels.isActive, true)).orderBy(asc(funnelCommands.position));
  const seen = new Set<string>(); const cmds: { command: string; description: string }[] = [];
  for (const r of rows) {
    const fs = (r.settings ?? {}) as FunnelSettings;
    if (r.status !== "active" && !fs.accessAfterFinish) continue;
    if (seen.has(r.c.command)) continue; seen.add(r.c.command);
    cmds.push({ command: r.c.command, description: (r.c.description || r.c.command).slice(0, 256) });
  }
  const scope = { type: "chat" as const, chat_id: idn.chatId };
  try {
    if (cmds.length) await getBot().api.setMyCommands([{ command: "start", description: "Почати" }, ...cmds.slice(0, 99)], { scope });
    else await getBot().api.deleteMyCommands({ scope });
  } catch { /* меню не критичне */ }
}
