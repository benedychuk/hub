"use server";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { adminTelegramId } from "./auth";
import { installWebhook, sendToPerson } from "./bot";

const { plans, persons, events, broadcasts, entitlements, resources, subscriptions, identities } = schema;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function savePlan(fd: FormData) {
  const id = Number(fd.get("id") || 0);
  const ents: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("ent:") && v) { const key = k.slice(4); ents[key] = str(fd, "quota:" + key); }
  }
  const row = {
    key: str(fd, "key") || str(fd, "name").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `plan_${Date.now()}`,
    name: str(fd, "name") || "Без назви", price: str(fd, "price") || "0", currency: str(fd, "currency") || "UAH", period: str(fd, "period") || "month",
    trialDays: Number(fd.get("trialDays") || 0), trialPrice: str(fd, "trialPrice") || null, entitlements: ents,
    isActive: fd.get("isActive") === "on", isFeatured: fd.get("isFeatured") === "on", sortOrder: Number(fd.get("sortOrder") || 0), updatedAt: new Date(),
  };
  if (id) await db().update(plans).set(row).where(eq(plans.id, id));
  else await db().insert(plans).values(row);
  revalidatePath("/plans"); redirect("/plans");
}
export async function deletePlan(fd: FormData) {
  const id = Number(fd.get("id"));
  await db().update(subscriptions).set({ planId: null }).where(eq(subscriptions.planId, id));
  await db().delete(plans).where(eq(plans.id, id));
  revalidatePath("/plans"); redirect("/plans");
}
export async function duplicatePlan(fd: FormData) {
  const id = Number(fd.get("id"));
  const [p] = await db().select().from(plans).where(eq(plans.id, id));
  if (p) await db().insert(plans).values({ ...p, id: undefined, key: p.key + "_copy_" + Date.now().toString(36), name: p.name + " (копія)", isFeatured: false, createdAt: undefined, updatedAt: undefined });
  revalidatePath("/plans"); redirect("/plans");
}

export async function addTag(fd: FormData) {
  const id = Number(fd.get("personId")); const tag = str(fd, "tag");
  if (tag) await db().update(persons).set({ tags: sql`(select jsonb_agg(distinct x) from jsonb_array_elements(${persons.tags} || ${JSON.stringify([tag])}::jsonb) x)` }).where(eq(persons.id, id));
  revalidatePath(`/people/${id}`);
}
export async function removeTag(fd: FormData) {
  const id = Number(fd.get("personId")); const tag = str(fd, "tag");
  await db().update(persons).set({ tags: sql`coalesce((select jsonb_agg(x) from jsonb_array_elements(${persons.tags}) x where x <> ${JSON.stringify(tag)}::jsonb), '[]'::jsonb)` }).where(eq(persons.id, id));
  revalidatePath(`/people/${id}`);
}
export async function saveNotes(fd: FormData) {
  const id = Number(fd.get("personId"));
  await db().update(persons).set({ notes: str(fd, "notes") || null, updatedAt: new Date() }).where(eq(persons.id, id));
  await db().insert(events).values({ personId: id, type: "admin.note", source: "hub", payload: {} });
  revalidatePath(`/people/${id}`);
}
export async function grantEntitlement(fd: FormData) {
  const id = Number(fd.get("personId")); const key = str(fd, "resourceKey"); const days = Number(fd.get("days") || 30);
  await db().insert(entitlements).values({ personId: id, resourceKey: key, grantedBy: "manual", validUntil: new Date(Date.now() + days * 86400000) });
  await db().insert(events).values({ personId: id, type: "entitlement.granted", source: "hub", payload: { key, days, by: "manual" } });
  revalidatePath(`/people/${id}`);
}
export async function revokeEntitlement(fd: FormData) {
  const id = Number(fd.get("personId")); const eid = Number(fd.get("id"));
  await db().update(entitlements).set({ revokedAt: new Date() }).where(eq(entitlements.id, eid));
  await db().insert(events).values({ personId: id, type: "entitlement.revoked", source: "hub", payload: { id: eid } });
  revalidatePath(`/people/${id}`);
}
export async function replyToPerson(fd: FormData) {
  const id = Number(fd.get("personId")); const text = str(fd, "text");
  if (!text) return;
  const ok = await sendToPerson(id, text);
  await db().insert(events).values({ personId: id, type: ok ? "bot.reply" : "bot.reply_failed", source: "hub", payload: { text } });
  revalidatePath(`/chats`); revalidatePath(`/people/${id}`);
}

export async function setupWebhook() {
  await installWebhook();
  revalidatePath("/bots");
}

export async function seedResources() {
  const d = db();
  const defaults = [
    { key: "club.channel", name: "Закритий канал клубу", kind: "telegram_channel" },
    { key: "club.chat", name: "Чат підтримки", kind: "telegram_group" },
    { key: "shchyro.access", name: "Бот «Щиро»", kind: "bot_feature" },
    { key: "archive.access", name: "Архів ефірів", kind: "external_url" },
  ];
  for (const r of defaults) await d.insert(resources).values(r).onConflictDoNothing();
  revalidatePath("/resources"); revalidatePath("/plans");
}
export async function saveResource(fd: FormData) {
  const key = str(fd, "key"); if (!key) return;
  const config = { note: str(fd, "note"), zenedu_grants: fd.get("zenedu_grants") === "on", offer_url: str(fd, "offer_url") || undefined, quota_per_day: Number(fd.get("quota_per_day") || 0) || undefined, chatId: str(fd, "chatId") || undefined };
  await db().insert(resources).values({ key, name: str(fd, "name") || key, kind: str(fd, "kind") || "bot_feature", config })
    .onConflictDoUpdate({ target: resources.key, set: { name: str(fd, "name") || key, kind: str(fd, "kind") || "bot_feature", config } });
  revalidatePath("/resources"); revalidatePath("/bots");
}

export async function createBroadcast(fd: FormData) {
  const d = db();
  const audience = str(fd, "audience") || "hub_all";
  const text = str(fd, "text"); if (!text) return;
  const btnText = str(fd, "btnText"), btnUrl = str(fd, "btnUrl");
  const buttons = btnText && btnUrl ? [{ text: btnText, url: btnUrl }] : [];
  const when = str(fd, "when");
  const scheduledAt = when === "later" && str(fd, "at") ? new Date(str(fd, "at")) : null;
  const [b] = await d.insert(broadcasts).values({ name: str(fd, "name") || text.slice(0, 40), audience: { kind: audience }, text, buttons, protectContent: fd.get("protect") === "on", disablePreview: fd.get("preview") !== "on", scheduledAt, status: scheduledAt ? "scheduled" : "sending" }).returning();
  if (!scheduledAt) await runBroadcast(b.id).catch(async (e) => { await d.update(broadcasts).set({ status: "failed", lastError: String(e).slice(0, 500) }).where(eq(broadcasts.id, b.id)); });
  revalidatePath("/broadcasts"); redirect("/broadcasts");
}
export async function runBroadcast(id: number) {
  const d = db();
  const [b] = await d.select().from(broadcasts).where(eq(broadcasts.id, id));
  if (!b) return;
  const kind = (b.audience as { kind?: string }).kind ?? "hub_all";
  let where = sql`i.bot_key = 'hub' and i.blocked_at is null`;
  if (kind === "hub_active") where = sql`${where} and exists (select 1 from subscriptions s where s.person_id = i.person_id and s.status in ('active','trialing','past_due'))`;
  const adminId = adminTelegramId();
  if (kind === "hub_test") where = sql`${where} and p.telegram_user_id = ${adminId}`;
  const targets = await d.execute(sql`select i.person_id from identities i join persons p on p.id = i.person_id where ${where}`);
  let sent = 0, failed = 0, lastError: string | null = null;
  const rows = targets.rows as { person_id: number }[];
  if (!rows.length) lastError = kind === "hub_test" ? `Немає кому надсилати: ADMIN_TELEGRAM_ID=${adminId || "не задано"} ще не натискав /start у Hub-боті` : "Немає жодної людини, яка запустила Hub-бот";
  for (const t of rows) {
    try { if (await sendToPerson(t.person_id, b.text, { buttons: b.buttons.filter((x): x is { text: string; url: string } => Boolean(x.url)), protect: b.protectContent, disablePreview: b.disablePreview })) sent++; else failed++; }
    catch (e) { failed++; lastError = String(e).slice(0, 300); }
    await new Promise((r) => setTimeout(r, 40));
  }
  await d.update(broadcasts).set({ status: sent || !rows.length ? "sent" : "failed", sentCount: sent, failedCount: failed, lastError }).where(eq(broadcasts.id, id));
}
export async function sendBroadcastNow(fd: FormData) {
  await runBroadcast(Number(fd.get("id")));
  revalidatePath("/broadcasts");
}

export async function identitiesCount() {
  const [r] = await db().select({ c: sql<number>`count(*)::int` }).from(identities).where(eq(identities.botKey, "hub"));
  return r.c;
}

// ---------- воронки (структура й логіка як у ZenEdu) ----------
import { asc, desc, inArray } from "drizzle-orm";
import { enroll as enrollPerson, processDue, sendStep, sendIntro, STEP_TYPES, type StepType, type StepButton, type StepConfig, type FunnelSettings } from "./funnels";
const { funnels, funnelSteps, funnelEnrollments, funnelFolders, funnelModules, funnelCommands } = schema;

const num = (fd: FormData, k: string) => Number(fd.get(k) || 0) || 0;
const on = (fd: FormData, k: string) => fd.get(k) === "on";

async function refreshFunnelCounts(funnelId: number) {
  await db().update(funnels).set({ stepsCount: sql`(select count(*)::int from funnel_steps where funnel_id = ${funnelId})`, updatedAt: new Date() }).where(eq(funnels.id, funnelId));
}

// --- папки ---
export async function createFolder(fd: FormData) {
  const name = str(fd, "name"); if (!name) return;
  const [f] = await db().insert(funnelFolders).values({ name }).returning({ id: funnelFolders.id });
  revalidatePath("/funnels"); redirect(`/funnels?folder=${f.id}`);
}
export async function renameFolder(fd: FormData) {
  const id = num(fd, "id"); const name = str(fd, "name");
  if (id && name) await db().update(funnelFolders).set({ name }).where(eq(funnelFolders.id, id));
  revalidatePath("/funnels");
}
export async function deleteFolder(fd: FormData) {
  const id = num(fd, "id");
  if (id) await db().delete(funnelFolders).where(eq(funnelFolders.id, id)); // воронки залишаються, folder_id → null
  revalidatePath("/funnels"); redirect("/funnels");
}

// --- воронки ---
export async function createFunnel(fd: FormData) {
  const folderId = num(fd, "folderId") || null;
  const settings: FunnelSettings = { entryKind: "start", entryValue: "", accessDirect: false, accessAfterFinish: true, contentProtection: false, restart: false, lessonTitles: false, template: false, quietHours: true };
  const [f] = await db().insert(funnels).values({ source: "hub", name: str(fd, "name") || "Нова воронка", folderId, buttonText: "Отримати доступ", status: "draft", isActive: false, settings }).returning({ id: funnels.id });
  revalidatePath("/funnels"); redirect(`/funnels/${f.id}`);
}
export async function saveFunnelSettings(fd: FormData) {
  const id = num(fd, "id");
  const [cur] = await db().select({ settings: funnels.settings, cover: funnels.cover }).from(funnels).where(eq(funnels.id, id));
  if (!cur) return;
  const old = (cur.settings ?? {}) as FunnelSettings;
  const settings: FunnelSettings = {
    ...old,
    entryKind: (str(fd, "entryKind") || "start") as FunnelSettings["entryKind"], entryValue: str(fd, "entryValue").replace(/^\/?start[= ]?/i, ""),
    accessDirect: on(fd, "accessDirect"), accessAfterFinish: on(fd, "accessAfterFinish"),
    contentProtection: on(fd, "contentProtection"), restart: on(fd, "restart"), lessonTitles: on(fd, "lessonTitles"), template: on(fd, "template"), quietHours: on(fd, "quietHours"),
  };
  const coverMode = str(fd, "coverMode"); // keep | delete | replace
  const coverData = str(fd, "coverData");
  let cover = cur.cover;
  if (coverMode === "delete") cover = null;
  else if (coverData.startsWith("data:image/")) { if (coverData.length > 4_000_000) throw new Error("Обкладинка завелика після стискання"); cover = coverData; }
  await db().update(funnels).set({
    name: str(fd, "name") || "Без назви", description: str(fd, "description") || null, buttonText: str(fd, "buttonText") || "Отримати доступ",
    cover, entry: settings.entryKind, settings, updatedAt: new Date(),
  }).where(eq(funnels.id, id));
  revalidatePath(`/funnels/${id}`); revalidatePath("/funnels"); revalidatePath(`/f/${id}`);
  redirect(`/funnels/${id}?tab=settings&saved=1`);
}
export async function setFunnelStatus(fd: FormData) {
  const id = num(fd, "id"); const active = str(fd, "status") === "active";
  await db().update(funnels).set({ status: active ? "active" : "stopped", isActive: active, updatedAt: new Date() }).where(eq(funnels.id, id));
  revalidatePath("/funnels"); revalidatePath(`/funnels/${id}`);
}
export async function moveFunnel(fd: FormData) {
  const id = num(fd, "id"); const folderId = num(fd, "folderId") || null;
  await db().update(funnels).set({ folderId, updatedAt: new Date() }).where(eq(funnels.id, id));
  revalidatePath("/funnels");
}
export async function duplicateFunnel(fd: FormData) {
  const id = num(fd, "id"); const d = db();
  const [f] = await d.select().from(funnels).where(eq(funnels.id, id)); if (!f) return;
  const [nf] = await d.insert(funnels).values({ source: "hub", folderId: f.folderId, name: `${f.name} (копія)`, description: f.description, buttonText: f.buttonText, cover: f.cover, entry: f.entry, status: "draft", isActive: false, settings: f.settings, stepsCount: f.stepsCount }).returning({ id: funnels.id });
  const mods = await d.select().from(funnelModules).where(eq(funnelModules.funnelId, id));
  const modMap = new Map<number, number>();
  for (const m of mods) { const [nm] = await d.insert(funnelModules).values({ funnelId: nf.id, name: m.name, position: m.position }).returning({ id: funnelModules.id }); modMap.set(m.id, nm.id); }
  const steps = await d.select().from(funnelSteps).where(eq(funnelSteps.funnelId, id)).orderBy(asc(funnelSteps.position));
  const stepMap = new Map<number, number>();
  for (const s of steps) { const [ns] = await d.insert(funnelSteps).values({ funnelId: nf.id, moduleId: s.moduleId ? modMap.get(s.moduleId) ?? null : null, position: s.position, type: s.type, title: s.title, body: s.body, isActive: s.isActive, config: s.config }).returning({ id: funnelSteps.id }); stepMap.set(s.id, ns.id); }
  // кнопки «перейти до кроку» вказують на нові id
  for (const s of steps) {
    const c = (s.config ?? {}) as StepConfig;
    if (!c.buttons?.some((b) => b.kind === "step")) continue;
    const buttons = c.buttons.map((b) => b.kind === "step" && b.target && stepMap.has(Number(b.target)) ? { ...b, target: String(stepMap.get(Number(b.target))) } : b);
    await d.update(funnelSteps).set({ config: { ...c, buttons } }).where(eq(funnelSteps.id, stepMap.get(s.id)!));
  }
  const cmds = await d.select().from(funnelCommands).where(eq(funnelCommands.funnelId, id));
  for (const c of cmds) await d.insert(funnelCommands).values({ funnelId: nf.id, command: c.command, description: c.description, position: c.position, action: c.action.type === "step" && c.action.stepId ? { ...c.action, stepId: stepMap.get(c.action.stepId) } : c.action });
  revalidatePath("/funnels"); redirect(`/funnels/${nf.id}`);
}
export async function deleteFunnel(fd: FormData) {
  await db().delete(funnels).where(eq(funnels.id, num(fd, "id")));
  revalidatePath("/funnels"); redirect("/funnels");
}

// --- модулі ---
export async function addModule(fd: FormData) {
  const funnelId = num(fd, "funnelId"); const name = str(fd, "name") || "Новий модуль";
  const last = await db().select({ p: funnelModules.position }).from(funnelModules).where(eq(funnelModules.funnelId, funnelId)).orderBy(desc(funnelModules.position)).limit(1);
  await db().insert(funnelModules).values({ funnelId, name, position: (last[0]?.p ?? 0) + 10 });
  revalidatePath(`/funnels/${funnelId}`);
}
export async function renameModule(fd: FormData) {
  const id = num(fd, "id"); const funnelId = num(fd, "funnelId"); const name = str(fd, "name");
  if (name) await db().update(funnelModules).set({ name }).where(eq(funnelModules.id, id));
  revalidatePath(`/funnels/${funnelId}`);
}
export async function deleteModule(fd: FormData) {
  const id = num(fd, "id"); const funnelId = num(fd, "funnelId");
  await db().delete(funnelModules).where(eq(funnelModules.id, id)); // кроки залишаються без модуля
  revalidatePath(`/funnels/${funnelId}`);
}
export async function moveModule(fd: FormData) {
  const id = num(fd, "id"); const funnelId = num(fd, "funnelId"); const dir = str(fd, "dir");
  const mods = await db().select().from(funnelModules).where(eq(funnelModules.funnelId, funnelId)).orderBy(asc(funnelModules.position), asc(funnelModules.id));
  const i = mods.findIndex((m) => m.id === id); const j = dir === "up" ? i - 1 : i + 1;
  if (i >= 0 && j >= 0 && j < mods.length) {
    const pi = mods[i].position === mods[j].position ? mods[j].position + (dir === "up" ? -1 : 1) : mods[j].position;
    await db().update(funnelModules).set({ position: pi }).where(eq(funnelModules.id, mods[i].id));
    await db().update(funnelModules).set({ position: mods[i].position }).where(eq(funnelModules.id, mods[j].id));
  }
  revalidatePath(`/funnels/${funnelId}`);
}

// --- кроки ---
const DEFAULT_CONFIG = (type: StepType, first: boolean): StepConfig => ({
  sendTime: first ? { mode: "immediately" } : { mode: "after", value: 1, unit: "days" },
  autodelete: { mode: "never" }, protect: false, preview: false, quietHours: true, attachments: [], buttons: type === "survey" || type === "quiz" ? [{ text: "Варіант 1", kind: "option", correct: type === "quiz" }, { text: "Варіант 2", kind: "option" }] : [],
});
export async function addStep(fd: FormData) {
  const funnelId = num(fd, "funnelId"); const type = (STEP_TYPES.some((t) => t.key === str(fd, "type")) ? str(fd, "type") : "message") as StepType;
  const moduleId = num(fd, "moduleId") || null;
  const all = await db().select({ p: funnelSteps.position }).from(funnelSteps).where(eq(funnelSteps.funnelId, funnelId)).orderBy(asc(funnelSteps.position));
  const label = STEP_TYPES.find((t) => t.key === type)?.label ?? "Крок";
  const [s] = await db().insert(funnelSteps).values({ funnelId, moduleId, position: (all.at(-1)?.p ?? 0) + 10, type, title: `${label} ${all.length + 1}`, body: "", isActive: true, config: DEFAULT_CONFIG(type, all.length === 0) as Record<string, unknown> }).returning({ id: funnelSteps.id });
  await refreshFunnelCounts(funnelId);
  revalidatePath(`/funnels/${funnelId}`); redirect(`/funnels/${funnelId}/steps/${s.id}`);
}
export async function saveStep(fd: FormData) {
  const id = num(fd, "id"); const funnelId = num(fd, "funnelId");
  const [cur] = await db().select().from(funnelSteps).where(eq(funnelSteps.id, id)); if (!cur) return;
  const old = (cur.config ?? {}) as StepConfig;
  let buttons: StepButton[] = [];
  try { const raw = JSON.parse(str(fd, "buttonsJson") || "[]") as Partial<StepButton>[]; buttons = raw.filter((b) => b && b.text).map((b) => ({ text: String(b.text).slice(0, 64), kind: (b.kind ?? "url") as StepButton["kind"], target: b.target ? String(b.target) : undefined, tag: b.tag ? String(b.tag) : undefined, correct: Boolean(b.correct) })); } catch { buttons = old.buttons ?? []; }
  const attachments = str(fd, "attachmentsJson") ? (JSON.parse(str(fd, "attachmentsJson")) as unknown[]).map(Number).filter((n) => n > 0) : [];
  const stMode = (str(fd, "sendMode") || "immediately") as NonNullable<StepConfig["sendTime"]>["mode"];
  const adMode = (str(fd, "autodeleteMode") || "never") as NonNullable<StepConfig["autodelete"]>["mode"];
  const adUnit = (str(fd, "autodeleteUnit") || "hours") as "seconds" | "minutes" | "hours";
  const adMax = adUnit === "hours" ? 48 : adUnit === "minutes" ? 48 * 60 : 48 * 3600;
  const config: StepConfig = {
    sendTime: stMode === "after" ? { mode: "after", value: Math.max(0, num(fd, "sendValue")), unit: (str(fd, "sendUnit") || "hours") as "minutes" | "hours" | "days" }
      : stMode === "exact" ? { mode: "exact", day: Math.max(0, num(fd, "sendDay")), time: str(fd, "sendTime") || "12:00" } : { mode: stMode },
    autodelete: adMode === "in" ? { mode: "in", value: Math.min(Math.max(1, num(fd, "autodeleteValue")), adMax), unit: adUnit } : { mode: "never" },
    protect: on(fd, "protect"), preview: on(fd, "preview"), quietHours: on(fd, "quietHours"),
    attachments, buttons, tag: str(fd, "tag") || undefined, saveTo: str(fd, "saveTo") || undefined,
    correctText: str(fd, "correctText") || undefined, wrongText: str(fd, "wrongText") || undefined,
  };
  const body = str(fd, "body").slice(0, 4096);
  await db().update(funnelSteps).set({ title: str(fd, "title") || null, body, moduleId: num(fd, "moduleId") || null, isActive: str(fd, "status") !== "stopped", config: config as Record<string, unknown> }).where(eq(funnelSteps.id, id));
  await refreshFunnelCounts(funnelId);
  revalidatePath(`/funnels/${funnelId}`); revalidatePath(`/funnels/${funnelId}/steps/${id}`);
  const next = str(fd, "after"); // preview | close
  if (next === "preview") { await sendStepToAdmin(id); redirect(`/funnels/${funnelId}/steps/${id}?sent=1`); }
  if (next === "close") redirect(`/funnels/${funnelId}`);
  redirect(`/funnels/${funnelId}/steps/${id}?saved=1`);
}
async function sendStepToAdmin(stepId: number) {
  const tg = adminTelegramId();
  const p = await db().select({ id: persons.id }).from(persons).where(eq(persons.telegramUserId, tg));
  const [st] = await db().select().from(funnelSteps).where(eq(funnelSteps.id, stepId));
  if (p[0] && st) await sendStep(p[0].id, st, false);
}
export async function previewStep(fd: FormData) {
  const id = num(fd, "id"); const funnelId = num(fd, "funnelId");
  await sendStepToAdmin(id);
  redirect(`/funnels/${funnelId}/steps/${id}?sent=1`);
}
export async function toggleStep(fd: FormData) {
  const id = num(fd, "id"); const funnelId = num(fd, "funnelId");
  await db().update(funnelSteps).set({ isActive: sql`not ${funnelSteps.isActive}` }).where(eq(funnelSteps.id, id));
  revalidatePath(`/funnels/${funnelId}`);
}
export async function duplicateStep(fd: FormData) {
  const id = num(fd, "id"); const funnelId = num(fd, "funnelId"); const d = db();
  const [s] = await d.select().from(funnelSteps).where(eq(funnelSteps.id, id)); if (!s) return;
  const after = await d.select({ id: funnelSteps.id, p: funnelSteps.position }).from(funnelSteps).where(eq(funnelSteps.funnelId, funnelId)).orderBy(asc(funnelSteps.position), asc(funnelSteps.id));
  const idx = after.findIndex((x) => x.id === id);
  const nextPos = after[idx + 1]?.p; const position = nextPos != null && nextPos - s.position > 1 ? Math.floor((s.position + nextPos) / 2) : s.position + 10;
  if (nextPos != null && nextPos - s.position <= 1) for (const x of after.slice(idx + 1)) await d.update(funnelSteps).set({ position: x.p + 10 }).where(eq(funnelSteps.id, x.id));
  await d.insert(funnelSteps).values({ funnelId, moduleId: s.moduleId, position, type: s.type, title: `${s.title ?? "Крок"} (копія)`, body: s.body, isActive: s.isActive, config: s.config });
  await refreshFunnelCounts(funnelId);
  revalidatePath(`/funnels/${funnelId}`);
}
export async function deleteStep(fd: FormData) {
  const funnelId = num(fd, "funnelId");
  await db().delete(funnelSteps).where(eq(funnelSteps.id, num(fd, "id")));
  await refreshFunnelCounts(funnelId);
  revalidatePath(`/funnels/${funnelId}`);
  if (str(fd, "back") === "1") redirect(`/funnels/${funnelId}`);
}
export async function moveStep(fd: FormData) {
  const id = num(fd, "id"); const funnelId = num(fd, "funnelId"); const dir = str(fd, "dir");
  const steps = await db().select().from(funnelSteps).where(eq(funnelSteps.funnelId, funnelId)).orderBy(asc(funnelSteps.position), asc(funnelSteps.id));
  const i = steps.findIndex((s) => s.id === id); const j = dir === "up" ? i - 1 : i + 1;
  if (i >= 0 && j >= 0 && j < steps.length) {
    const pj = steps[j].position === steps[i].position ? steps[j].position + (dir === "up" ? -1 : 1) : steps[j].position;
    await db().update(funnelSteps).set({ position: pj }).where(eq(funnelSteps.id, steps[i].id));
    await db().update(funnelSteps).set({ position: steps[i].position }).where(eq(funnelSteps.id, steps[j].id));
  }
  revalidatePath(`/funnels/${funnelId}`);
}

// --- меню (команди) ---
export async function saveCommand(fd: FormData) {
  const funnelId = num(fd, "funnelId"); const id = num(fd, "id");
  const command = str(fd, "command").toLowerCase().replace(/^\//, "").replace(/[^a-z0-9_]/g, "").slice(0, 32); if (!command) return;
  const action = str(fd, "actionType") === "step" ? { type: "step" as const, stepId: num(fd, "stepId") || undefined } : { type: "text" as const, text: str(fd, "text").slice(0, 4096) };
  const row = { funnelId, command, description: str(fd, "description").slice(0, 256) || null, action };
  if (id) await db().update(funnelCommands).set(row).where(eq(funnelCommands.id, id));
  else { const last = await db().select({ p: funnelCommands.position }).from(funnelCommands).where(eq(funnelCommands.funnelId, funnelId)).orderBy(desc(funnelCommands.position)).limit(1); await db().insert(funnelCommands).values({ ...row, position: (last[0]?.p ?? 0) + 10 }); }
  revalidatePath(`/funnels/${funnelId}`); redirect(`/funnels/${funnelId}?tab=menu`);
}
export async function deleteCommand(fd: FormData) {
  const funnelId = num(fd, "funnelId");
  await db().delete(funnelCommands).where(eq(funnelCommands.id, num(fd, "id")));
  revalidatePath(`/funnels/${funnelId}`);
}

// --- проходження ---
export async function enrollToFunnel(fd: FormData) {
  const funnelId = num(fd, "funnelId"); const personId = num(fd, "personId");
  await enrollPerson(funnelId, personId, "manual");
  await processDue(20);
  revalidatePath(`/funnels/${funnelId}`); revalidatePath(`/people/${personId}`);
}
export async function testFunnelOnMe(fd: FormData) {
  const funnelId = num(fd, "funnelId"); const mode = str(fd, "mode"); // intro | steps
  const tg = adminTelegramId();
  const p = await db().select({ id: persons.id }).from(persons).where(eq(persons.telegramUserId, tg));
  if (p[0]) {
    // тест завжди перезапускає воронку для адміністратора
    await db().update(funnelEnrollments).set({ status: "stopped", stopReason: "test_restart", finishedAt: new Date() }).where(and(eq(funnelEnrollments.funnelId, funnelId), eq(funnelEnrollments.personId, p[0].id), eq(funnelEnrollments.status, "active")));
    const [f] = await db().select({ settings: funnels.settings }).from(funnels).where(eq(funnels.id, funnelId));
    const fs = (f?.settings ?? {}) as FunnelSettings;
    if (!fs.restart) await db().update(funnels).set({ settings: { ...fs, restart: true } }).where(eq(funnels.id, funnelId));
    const shown = mode === "intro" ? await sendIntro(funnelId, p[0].id) : false;
    if (!shown) { await enrollPerson(funnelId, p[0].id, "test"); await processDue(20); }
    if (!fs.restart) await db().update(funnels).set({ settings: fs }).where(eq(funnels.id, funnelId));
  }
  revalidatePath(`/funnels/${funnelId}`); redirect(`/funnels/${funnelId}?tested=${p[0] ? 1 : 0}`);
}
export async function stopFunnelEnrollment(fd: FormData) {
  const id = num(fd, "id"); const funnelId = num(fd, "funnelId");
  await db().update(funnelEnrollments).set({ status: "stopped", stopReason: "manual", finishedAt: new Date(), awaitingStepId: null }).where(eq(funnelEnrollments.id, id));
  revalidatePath(`/funnels/${funnelId}`);
}
export async function stopEnrollmentsBulk(fd: FormData) {
  const funnelId = num(fd, "funnelId"); const ids = String(fd.get("ids") ?? "").split(",").map(Number).filter(Boolean);
  if (ids.length) await db().update(funnelEnrollments).set({ status: "stopped", stopReason: "manual", finishedAt: new Date(), awaitingStepId: null }).where(and(eq(funnelEnrollments.funnelId, funnelId), inArray(funnelEnrollments.id, ids)));
  revalidatePath(`/funnels/${funnelId}`);
}
export async function runTickNow() {
  await processDue(100);
  revalidatePath("/funnels");
}

// ---------- бібліотека ----------
export async function deleteMedia(fd: FormData) {
  await db().delete(schema.media).where(eq(schema.media.id, Number(fd.get("id"))));
  revalidatePath("/library");
}
export async function renameMedia(fd: FormData) {
  await db().update(schema.media).set({ title: str(fd, "title") || null }).where(eq(schema.media.id, Number(fd.get("id"))));
  revalidatePath("/library");
}

// ---------- зовнішні боти (API-ключі) ----------
import { hashKey, newApiKey } from "./access";
const { bots: botsT } = schema;

export async function createExternalBot(fd: FormData) {
  const key = str(fd, "key").toLowerCase().replace(/[^a-z0-9_]/g, "") || `bot_${Date.now().toString(36)}`;
  const apiKey = newApiKey(key);
  await db().insert(botsT).values({ key, name: str(fd, "name") || key, username: str(fd, "username") || null, role: "external", mode: "external", resourceKey: str(fd, "resourceKey") || null, apiKeyHash: hashKey(apiKey), apiKeyPrefix: apiKey.slice(0, 12) })
    .onConflictDoUpdate({ target: botsT.key, set: { name: str(fd, "name") || key, username: str(fd, "username") || null, mode: "external", resourceKey: str(fd, "resourceKey") || null, apiKeyHash: hashKey(apiKey), apiKeyPrefix: apiKey.slice(0, 12), isActive: true } });
  revalidatePath("/bots"); redirect(`/bots?newkey=${encodeURIComponent(apiKey)}&for=${key}`);
}
export async function rotateBotKey(fd: FormData) {
  const key = str(fd, "key"); const apiKey = newApiKey(key);
  await db().update(botsT).set({ apiKeyHash: hashKey(apiKey), apiKeyPrefix: apiKey.slice(0, 12) }).where(eq(botsT.key, key));
  revalidatePath("/bots"); redirect(`/bots?newkey=${encodeURIComponent(apiKey)}&for=${key}`);
}
export async function toggleBot(fd: FormData) {
  const key = str(fd, "key"); const on = fd.get("on") === "1";
  await db().update(botsT).set({ isActive: on }).where(eq(botsT.key, key));
  revalidatePath("/bots");
}


// ---------- канали ----------
import { accessTick, reconcile as reconcileChannels, processGrants } from "./telegram-access";
const { memberships: membershipsT } = schema;

export async function saveChannelResource(fd: FormData) {
  const key = str(fd, "key"); if (!key) return;
  const [cur] = await db().select().from(resources).where(eq(resources.key, key));
  const config = { ...((cur?.config ?? {}) as Record<string, unknown>), chatId: str(fd, "chatId") || undefined, joinMode: str(fd, "joinMode") || "invite", inviteTtlHours: Number(fd.get("inviteTtlHours") || 24), graceDays: Number(fd.get("graceDays") || 0), inviteText: str(fd, "inviteText") || undefined, kickText: str(fd, "kickText") || undefined, note: str(fd, "note") || undefined };
  await db().update(resources).set({ name: str(fd, "name") || cur?.name || key, config }).where(eq(resources.key, key));
  revalidatePath("/resources");
}
export async function runAccessTickNow() { await accessTick(); revalidatePath("/resources"); }
export async function runReconcileNow() { await reconcileChannels(); revalidatePath("/resources"); }
export async function resendInvite(fd: FormData) {
  const personId = Number(fd.get("personId")); const key = str(fd, "resourceKey");
  await db().update(membershipsT).set({ status: "none", inviteLink: null, updatedAt: new Date() }).where(and(eq(membershipsT.personId, personId), eq(membershipsT.resourceKey, key)));
  await processGrants(5);
  revalidatePath(`/people/${personId}`);
}
