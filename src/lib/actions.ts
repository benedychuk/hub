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
  if (!scheduledAt) await runBroadcast(b.id);
  revalidatePath("/broadcasts"); redirect("/broadcasts");
}
export async function runBroadcast(id: number) {
  const d = db();
  const [b] = await d.select().from(broadcasts).where(eq(broadcasts.id, id));
  if (!b) return;
  const kind = (b.audience as { kind?: string }).kind ?? "hub_all";
  let where = sql`i.bot_key = 'hub' and i.blocked_at is null`;
  if (kind === "hub_active") where = sql`${where} and exists (select 1 from subscriptions s where s.person_id = i.person_id and s.status in ('active','trialing','past_due'))`;
  if (kind === "hub_test") where = sql`${where} and p.telegram_user_id = ${Number(process.env.ADMIN_TELEGRAM_ID ?? 0)}`;
  const targets = await d.execute(sql`select i.person_id from identities i join persons p on p.id = i.person_id where ${where}`);
  let sent = 0, failed = 0;
  for (const t of targets.rows as { person_id: number }[]) {
    try { if (await sendToPerson(t.person_id, b.text, { buttons: b.buttons.filter((x): x is { text: string; url: string } => Boolean(x.url)), protect: b.protectContent, disablePreview: b.disablePreview })) sent++; else failed++; }
    catch { failed++; }
    await new Promise((r) => setTimeout(r, 40));
  }
  await d.update(broadcasts).set({ status: "sent", sentCount: sent, failedCount: failed }).where(eq(broadcasts.id, id));
}
export async function sendBroadcastNow(fd: FormData) {
  await runBroadcast(Number(fd.get("id")));
  revalidatePath("/broadcasts");
}

export async function identitiesCount() {
  const [r] = await db().select({ c: sql<number>`count(*)::int` }).from(identities).where(eq(identities.botKey, "hub"));
  return r.c;
}
