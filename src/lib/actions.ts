"use server";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
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
  await db().insert(resources).values({ key, name: str(fd, "name") || key, kind: str(fd, "kind") || "bot_feature", config: { note: str(fd, "note") } })
    .onConflictDoUpdate({ target: resources.key, set: { name: str(fd, "name") || key, kind: str(fd, "kind") || "bot_feature", config: { note: str(fd, "note") } } });
  revalidatePath("/resources");
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
  const adminId = Number(String(process.env.ADMIN_TELEGRAM_ID ?? "").replace(/\D/g, "")) || 0;
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

// ---------- воронки ----------
import { asc } from "drizzle-orm";
import { enroll as enrollPerson, processDue } from "./funnels";
const { funnels, funnelSteps, funnelEnrollments } = schema;

export async function createFunnel(fd: FormData) {
  const [f] = await db().insert(funnels).values({ source: "hub", name: str(fd, "name") || "Нова воронка", isActive: false, settings: { entryKind: "manual", entryValue: "" } }).returning({ id: funnels.id });
  revalidatePath("/funnels"); redirect(`/funnels/${f.id}`);
}
export async function saveFunnel(fd: FormData) {
  const id = Number(fd.get("id"));
  await db().update(funnels).set({ name: str(fd, "name") || "Без назви", isActive: fd.get("isActive") === "on", entry: str(fd, "entryKind"), settings: { entryKind: str(fd, "entryKind") || "manual", entryValue: str(fd, "entryValue") } }).where(eq(funnels.id, id));
  revalidatePath(`/funnels/${id}`);
}
export async function deleteFunnel(fd: FormData) {
  await db().delete(funnels).where(eq(funnels.id, Number(fd.get("id"))));
  revalidatePath("/funnels"); redirect("/funnels");
}
export async function addStep(fd: FormData) {
  const funnelId = Number(fd.get("funnelId"));
  const last = await db().select({ p: funnelSteps.position }).from(funnelSteps).where(eq(funnelSteps.funnelId, funnelId)).orderBy(asc(funnelSteps.position));
  const position = (last.at(-1)?.p ?? 0) + 10;
  await db().insert(funnelSteps).values({ funnelId, position, type: "message", title: `Крок ${last.length + 1}`, body: "Текст повідомлення…", config: { delay: { value: last.length ? 1 : 0, unit: "days" }, quietHours: true, buttons: [], disablePreview: true } });
  revalidatePath(`/funnels/${funnelId}`);
}
export async function saveStep(fd: FormData) {
  const id = Number(fd.get("id")); const funnelId = Number(fd.get("funnelId"));
  const buttons = [] as { text: string; url?: string; kind?: "url" | "next" }[];
  for (let i = 0; i < 3; i++) { const t = str(fd, `btnText${i}`); if (t) buttons.push({ text: t, url: str(fd, `btnUrl${i}`) || undefined, kind: str(fd, `btnUrl${i}`) ? "url" : "next" }); }
  const config = { delay: { value: Number(fd.get("delayValue") || 0), unit: (str(fd, "delayUnit") || "days") as "minutes" | "hours" | "days" }, quietHours: fd.get("quietHours") === "on", buttons, protect: fd.get("protect") === "on", disablePreview: fd.get("preview") !== "on" };
  await db().update(funnelSteps).set({ title: str(fd, "title") || null, body: str(fd, "body"), config }).where(eq(funnelSteps.id, id));
  revalidatePath(`/funnels/${funnelId}`);
}
export async function deleteStep(fd: FormData) {
  const funnelId = Number(fd.get("funnelId"));
  await db().delete(funnelSteps).where(eq(funnelSteps.id, Number(fd.get("id"))));
  revalidatePath(`/funnels/${funnelId}`);
}
export async function moveStep(fd: FormData) {
  const id = Number(fd.get("id")); const funnelId = Number(fd.get("funnelId")); const dir = str(fd, "dir");
  const steps = await db().select().from(funnelSteps).where(eq(funnelSteps.funnelId, funnelId)).orderBy(asc(funnelSteps.position));
  const i = steps.findIndex((s) => s.id === id); const j = dir === "up" ? i - 1 : i + 1;
  if (i >= 0 && j >= 0 && j < steps.length) {
    await db().update(funnelSteps).set({ position: steps[j].position }).where(eq(funnelSteps.id, steps[i].id));
    await db().update(funnelSteps).set({ position: steps[i].position }).where(eq(funnelSteps.id, steps[j].id));
  }
  revalidatePath(`/funnels/${funnelId}`);
}
export async function enrollToFunnel(fd: FormData) {
  const funnelId = Number(fd.get("funnelId")); const personId = Number(fd.get("personId"));
  await enrollPerson(funnelId, personId, "manual");
  await processDue(20);
  revalidatePath(`/funnels/${funnelId}`); revalidatePath(`/people/${personId}`);
}
export async function testFunnelOnMe(fd: FormData) {
  const funnelId = Number(fd.get("funnelId"));
  const tg = Number(process.env.ADMIN_TELEGRAM_ID ?? 0);
  const p = await db().select({ id: persons.id }).from(persons).where(eq(persons.telegramUserId, tg));
  if (p[0]) { await enrollPerson(funnelId, p[0].id, "test"); await processDue(20); }
  revalidatePath(`/funnels/${funnelId}`);
}
export async function stopFunnelEnrollment(fd: FormData) {
  const id = Number(fd.get("id")); const funnelId = Number(fd.get("funnelId"));
  await db().update(funnelEnrollments).set({ status: "stopped", stopReason: "manual", finishedAt: new Date() }).where(eq(funnelEnrollments.id, id));
  revalidatePath(`/funnels/${funnelId}`);
}
export async function runTickNow() {
  await processDue(100);
  revalidatePath("/funnels");
}
