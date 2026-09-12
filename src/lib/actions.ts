"use server";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { adminTelegramId } from "./auth";
import { installWebhook, sendToPerson, getBot, botToken } from "./bot";
import { grantOffer, newLinkToken } from "./offers";

const { plans, persons, events, broadcasts, entitlements, resources, subscriptions, identities, accessLinks } = schema;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

const on = (fd: FormData, k: string) => fd.get(k) === "on";
const dt = (fd: FormData, k: string) => { const v = str(fd, k); const d = v ? new Date(v) : null; return d && !isNaN(d.getTime()) ? d : null; };

/** Оффер Hub: вкладки «Основне», «Дизайн», «Налаштування» зберігаються окремо (part), решта полів не чіпається. */
export async function saveOffer(fd: FormData) {
  const id = Number(fd.get("id") || 0); const part = str(fd, "part") || "general";
  const [cur] = id ? await db().select().from(plans).where(eq(plans.id, id)) : [];
  let row: Partial<typeof plans.$inferInsert> = { updatedAt: new Date() };
  if (part === "general") {
    const ents: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("ent:") && v) { const key = k.slice(4); ents[key] = str(fd, "quota:" + key); }
    const products = fd.getAll("products").map(Number).filter((n) => n > 0);
    const paymentType = str(fd, "paymentType") === "one_time" ? "one_time" : "subscription";
    const accessMode = ["forever", "days", "until", "none"].includes(str(fd, "accessMode")) ? str(fd, "accessMode") : "forever";
    row = { ...row,
      name: str(fd, "name") || "Без назви", key: cur?.key ?? (str(fd, "key") || `${slugKey(str(fd, "name"))}_${Date.now().toString(36)}`),
      paymentType, price: str(fd, "price") || "0", currency: str(fd, "currency") || "UAH",
      period: ["day", "week", "month", "quarter", "year"].includes(str(fd, "period")) ? str(fd, "period") : "month", intervalCount: Math.max(1, Number(fd.get("intervalCount") || 1)),
      trialDays: on(fd, "trial") ? Math.max(0, Number(fd.get("trialDays") || 0)) : 0, trialPrice: on(fd, "trial") ? (str(fd, "trialPrice") || null) : null,
      entitlements: ents, products, accessMode, accessDays: accessMode === "days" ? Math.max(0, Number(fd.get("accessDays") || 0)) : null, accessUntil: accessMode === "until" ? dt(fd, "accessUntil") : null,
      isActive: str(fd, "status") !== "stopped", showInBot: on(fd, "showInBot"), isFeatured: on(fd, "isFeatured"), sortOrder: Number(fd.get("sortOrder") || 0),
    };
  } else if (part === "design") {
    const old = cur?.design ?? {};
    let image = old.image ?? undefined;
    const mode = str(fd, "coverMode"); const data = str(fd, "coverData");
    if (mode === "delete") image = undefined; else if (data.startsWith("data:image/")) { if (data.length > 4_000_000) throw new Error("Зображення завелике після стискання"); image = data; }
    row = { ...row, design: { titleMode: str(fd, "titleMode") === "custom" ? "custom" : "offer", title: str(fd, "title").slice(0, 120) || undefined, description: str(fd, "description").slice(0, 4000) || undefined, buttonText: str(fd, "buttonText").slice(0, 64) || undefined, image } };
  } else if (part === "settings") {
    const old = cur?.settings ?? {};
    row = { ...row,
      salesEndAt: dt(fd, "salesEndAt"), spotsLimit: Number(fd.get("spotsLimit") || 0) || null,
      settings: { ...old, removeContentOnEnd: on(fd, "removeContentOnEnd"), postPurchaseText: str(fd, "postPurchaseText").slice(0, 4000) || undefined, retries: on(fd, "retries"), reminder: on(fd, "reminder"),
        expiryReminder: on(fd, "expiryReminder"), expiryDays: Math.max(1, Number(fd.get("expiryDays") || 3)), expiryText: str(fd, "expiryText").slice(0, 1000) || undefined, renewalOfferId: Number(fd.get("renewalOfferId") || 0) || undefined, collectEmail: on(fd, "collectEmail") },
    };
  }
  let oid = id;
  if (id) await db().update(plans).set(row).where(eq(plans.id, id));
  else { const [n] = await db().insert(plans).values(row as typeof plans.$inferInsert).returning({ id: plans.id }); oid = n.id; }
  revalidatePath("/offers"); revalidatePath(`/offers/${oid}`); revalidatePath("/products");
  redirect(`/offers/${oid}?tab=${part}&saved=1`);
}
export async function setOfferStatus(fd: FormData) {
  const id = Number(fd.get("id")); const active = str(fd, "status") === "active";
  await db().update(plans).set({ isActive: active, updatedAt: new Date() }).where(eq(plans.id, id));
  revalidatePath("/offers"); revalidatePath(`/offers/${id}`);
}
export async function deleteOffer(fd: FormData) {
  const id = Number(fd.get("id"));
  await db().update(subscriptions).set({ planId: null }).where(eq(subscriptions.planId, id));
  await db().delete(plans).where(eq(plans.id, id));
  revalidatePath("/offers"); revalidatePath("/products"); redirect("/offers");
}
export async function duplicateOffer(fd: FormData) {
  const id = Number(fd.get("id"));
  const [p] = await db().select().from(plans).where(eq(plans.id, id));
  if (!p) return;
  const [n] = await db().insert(plans).values({ ...p, id: undefined, key: p.key + "_copy_" + Date.now().toString(36), name: p.name + " (копія)", isFeatured: false, isActive: false, createdAt: undefined, updatedAt: undefined }).returning({ id: plans.id });
  revalidatePath("/offers"); redirect(`/offers/${n.id}`);
}
/** Продукт ⇄ оффер із вкладки «Оффери» продукту. */
export async function addProductToOffer(fd: FormData) {
  const productId = Number(fd.get("productId")); const offerId = Number(fd.get("offerId"));
  if (productId && offerId) await db().execute(sql`update plans set products = products || to_jsonb(${productId}::int), updated_at = now() where id = ${offerId} and not products @> to_jsonb(array[${productId}::int])`);
  revalidatePath(`/products/${productId}`); revalidatePath("/offers"); redirect(`/products/${productId}?tab=offers`);
}
export async function removeProductFromOffer(fd: FormData) {
  const productId = Number(fd.get("productId")); const offerId = Number(fd.get("offerId"));
  if (productId && offerId) await db().execute(sql`update plans set products = (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(products) x where x <> to_jsonb(${productId}::int)), updated_at = now() where id = ${offerId}`);
  revalidatePath(`/products/${productId}`); revalidatePath("/offers");
}
export async function createOfferForProduct(fd: FormData) {
  const productId = Number(fd.get("productId"));
  const [f] = await db().select({ name: funnels.name }).from(funnels).where(eq(funnels.id, productId)); if (!f) return;
  const paymentType = str(fd, "paymentType") === "one_time" ? "one_time" : "subscription";
  const [n] = await db().insert(plans).values({ key: `${slugKey(f.name)}_${Date.now().toString(36)}`, name: str(fd, "name") || f.name, price: str(fd, "price") || "0", currency: str(fd, "currency") || "UAH", paymentType, products: [productId], isActive: false, showInBot: true }).returning({ id: plans.id });
  revalidatePath(`/products/${productId}`); revalidatePath("/offers"); redirect(`/offers/${n.id}`);
}
// --- посилання доступу (без оплати) ---
export async function createAccessLink(fd: FormData) {
  const planId = Number(fd.get("planId"));
  await db().insert(accessLinks).values({ planId, token: newLinkToken(), name: str(fd, "name").slice(0, 80) || null, maxUses: Number(fd.get("maxUses") || 0) || null, expiresAt: dt(fd, "expiresAt"), markAsPayment: on(fd, "markAsPayment") });
  revalidatePath(`/offers/${planId}`); redirect(`/offers/${planId}?tab=links`);
}
export async function toggleAccessLink(fd: FormData) {
  const id = Number(fd.get("id")); const planId = Number(fd.get("planId"));
  await db().update(accessLinks).set({ isActive: sql`not ${accessLinks.isActive}` }).where(eq(accessLinks.id, id));
  revalidatePath(`/offers/${planId}`);
}
export async function deleteAccessLink(fd: FormData) {
  const id = Number(fd.get("id")); const planId = Number(fd.get("planId"));
  await db().delete(accessLinks).where(eq(accessLinks.id, id));
  revalidatePath(`/offers/${planId}`);
}
/** Дати людині доступ за оффером без оплати (з картки людини). */
export async function grantOfferToPerson(fd: FormData) {
  const personId = Number(fd.get("personId")); const planId = Number(fd.get("planId"));
  const until = dt(fd, "until");
  const r = await grantOffer(personId, planId, "admin", until ? { until } : {});
  revalidatePath(`/people/${personId}`); redirect(`/people/${personId}?ok=${encodeURIComponent(`Доступ до «${r.plan.name}» відкрито${r.until ? ` до ${r.until.toLocaleDateString("uk-UA")}` : ""}`)}`);
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
  const [cur] = await db().select().from(resources).where(eq(resources.key, key));
  const config = { ...((cur?.config ?? {}) as Record<string, unknown>), note: str(fd, "note"), zenedu_grants: fd.get("zenedu_grants") === "on", offer_url: str(fd, "offer_url") || undefined, quota_per_day: Number(fd.get("quota_per_day") || 0) || undefined, url: str(fd, "url") || undefined, description: str(fd, "description") || undefined };
  await db().insert(resources).values({ key, name: str(fd, "name") || key, kind: str(fd, "kind") || "bot_feature", config })
    .onConflictDoUpdate({ target: resources.key, set: { name: str(fd, "name") || key, kind: str(fd, "kind") || cur?.kind || "bot_feature", config } });
  revalidatePath("/resources"); revalidatePath("/bots"); revalidatePath(`/resources/${key}`);
  redirect(cur ? `/resources/${key}?saved=1` : `/resources/${key}?new=1`);
}

// ---------- розсилки (Зміст → Отримувачі → Надсилання, як у ZenEdu) ----------
import { resnapshot, startSending, schedule as scheduleBroadcast, cancelScheduled, deleteFromSubscribers, duplicate as duplicateBc, previewToAdmin, processBroadcasts } from "./broadcasts";
import type { BroadcastAudience, BroadcastButton } from "@/db/schema";

export async function createBroadcast(fd: FormData) {
  const [b] = await db().insert(broadcasts).values({ name: str(fd, "name") || "Нова розсилка", status: "draft", audience: {} }).returning({ id: broadcasts.id });
  revalidatePath("/broadcasts"); redirect(`/broadcasts/${b.id}?step=content`);
}
export async function saveBroadcastContent(fd: FormData) {
  const id = Number(fd.get("id"));
  let buttons: BroadcastButton[] = [];
  try { buttons = (JSON.parse(str(fd, "buttonsJson") || "[]") as BroadcastButton[]).filter((b) => b && b.text).map((b) => ({ ...b, text: String(b.text).slice(0, 64), tags: (b.tags ?? []).map(String).filter(Boolean), actions: b.actions ?? [] })); } catch { /* залишаємо старі */ }
  const attachments = str(fd, "attachmentsJson") ? (JSON.parse(str(fd, "attachmentsJson")) as unknown[]).map(Number).filter((n) => n > 0) : [];
  const text = str(fd, "text").slice(0, 4096);
  await db().update(broadcasts).set({ name: str(fd, "name") || "Без назви", text, attachments, attachedToText: fd.get("attachedToText") === "on", spoiler: fd.get("spoiler") === "on", buttons, protectContent: fd.get("protect") === "on", disablePreview: fd.get("preview") !== "on", updatedAt: new Date() }).where(eq(broadcasts.id, id));
  revalidatePath(`/broadcasts/${id}`);
  const next = str(fd, "after");
  if (next === "preview") { const err = await previewToAdmin(id); redirect(`/broadcasts/${id}?step=content&${err ? "err=" + encodeURIComponent(err) : "sent=1"}`); }
  if (next === "exit") redirect("/broadcasts");
  redirect(`/broadcasts/${id}?step=recipients`);
}
const list = (fd: FormData, k: string) => fd.getAll(k).map(String).map((x) => x.trim()).filter(Boolean);
const nums = (fd: FormData, k: string) => list(fd, k).map(Number).filter((n) => n > 0);
export async function saveBroadcastAudience(fd: FormData) {
  const id = Number(fd.get("id"));
  const mode = str(fd, "mode") || "filters";
  const a: BroadcastAudience = mode === "me" ? { onlyAdmin: true } : mode === "all" ? {} : {
    onlyAdmin: false,
    customer: (str(fd, "customer") || "any") as BroadcastAudience["customer"],
    subStatus: list(fd, "subStatus"),
    tagsAny: str(fd, "tagsAny").split(",").map((x) => x.trim()).filter(Boolean),
    tagsAll: str(fd, "tagsAll").split(",").map((x) => x.trim()).filter(Boolean),
    tagsNone: str(fd, "tagsNone").split(",").map((x) => x.trim()).filter(Boolean),
    funnelIn: nums(fd, "funnelIn"), funnelNotIn: nums(fd, "funnelNotIn"), planIds: nums(fd, "planIds"), offerIds: nums(fd, "offerIds"), entitlements: list(fd, "entitlements"),
    activeDays: Number(fd.get("activeDays") || 0) || undefined, startedAfter: str(fd, "startedAfter") || undefined, startedBefore: str(fd, "startedBefore") || undefined,
    excludeIds: str(fd, "excludeIds").split(/[\s,]+/).map(Number).filter((n) => n > 0), includeIds: str(fd, "includeIds").split(/[\s,]+/).map(Number).filter((n) => n > 0),
  };
  await db().update(broadcasts).set({ audience: a, updatedAt: new Date() }).where(eq(broadcasts.id, id));
  const [b] = await db().select({ status: broadcasts.status }).from(broadcasts).where(eq(broadcasts.id, id));
  if (b?.status === "scheduled") await resnapshot(id);
  revalidatePath(`/broadcasts/${id}`);
  const next = str(fd, "after");
  if (next === "exit") redirect("/broadcasts");
  redirect(`/broadcasts/${id}?step=${next === "stay" ? "recipients" : "send"}`);
}
export async function sendBroadcast(fd: FormData) {
  const id = Number(fd.get("id")); const mode = str(fd, "mode");
  const fail = (m: string) => redirect(`/broadcasts/${id}?step=send&err=${encodeURIComponent(m)}`);
  if (mode === "schedule") {
    const at = str(fd, "date") && str(fd, "time") ? kyivToDate(str(fd, "date"), str(fd, "time")) : null;
    if (!at || at.getTime() < Date.now() - 60_000) fail("Вкажіть дату й час у майбутньому");
    try { await scheduleBroadcast(id, at!); } catch (e) { fail("Не вдалося запланувати: " + String(e).slice(0, 200)); }
    revalidatePath("/broadcasts"); redirect("/broadcasts");
  }
  try { await startSending(id); } catch (e) { fail("Не вдалося зафіксувати отримувачів: " + String(e).slice(0, 200)); }
  revalidatePath("/broadcasts");
  // перша порція одразу, решту дошле щохвилинний тік
  await processBroadcasts(40_000).catch(() => null);
  redirect(`/broadcasts/${id}?step=recipients`);
}
/** Дата й час за Києвом → Date. */
function kyivToDate(date: string, time: string) {
  const [y, m, d] = date.split("-").map(Number); const [hh, mm] = time.split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const kyiv = new Date(guess.toLocaleString("en-US", { timeZone: "Europe/Kyiv" }));
  const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() - (kyiv.getTime() - utc.getTime()));
}
export async function cancelBroadcast(fd: FormData) {
  const id = Number(fd.get("id")); await cancelScheduled(id);
  revalidatePath("/broadcasts"); revalidatePath(`/broadcasts/${id}`);
}
export async function deleteBroadcastFromSubscribers(fd: FormData) {
  const id = Number(fd.get("id")); const err = await deleteFromSubscribers(id);
  revalidatePath("/broadcasts"); revalidatePath(`/broadcasts/${id}`);
  if (err) redirect(`/broadcasts?err=${encodeURIComponent(err)}`);
  await processBroadcasts(30_000).catch(() => null);
}
export async function duplicateBroadcast(fd: FormData) {
  const nid = await duplicateBc(Number(fd.get("id")));
  revalidatePath("/broadcasts"); if (nid) redirect(`/broadcasts/${nid}?step=content`);
}
export async function deleteBroadcast(fd: FormData) {
  const id = Number(fd.get("id"));
  const [b] = await db().select({ status: broadcasts.status }).from(broadcasts).where(eq(broadcasts.id, id));
  if (b && b.status !== "sending") await db().delete(broadcasts).where(eq(broadcasts.id, id));
  revalidatePath("/broadcasts"); redirect("/broadcasts");
}
export async function previewBroadcast(fd: FormData) {
  const id = Number(fd.get("id")); const err = await previewToAdmin(id);
  redirect(`/broadcasts/${id}?step=${str(fd, "step") || "content"}&${err ? "err=" + encodeURIComponent(err) : "sent=1"}`);
}
export async function runBroadcastsNow() {
  await processBroadcasts(40_000);
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

/** Шлях розділу для воронки або цифрового продукту (спільний редактор кроків). */
async function fb(id: number) { const [f] = await db().select({ kind: funnels.kind }).from(funnels).where(eq(funnels.id, id)); return f?.kind === "product" ? "/products" : "/funnels"; }
async function refreshFunnelCounts(funnelId: number) {
  await db().update(funnels).set({ stepsCount: sql`(select count(*)::int from funnel_steps where funnel_id = ${funnelId})`, updatedAt: new Date() }).where(eq(funnels.id, funnelId));
}

// --- папки ---
export async function createFolder(fd: FormData) {
  const kind = str(fd, "kind") === "product" ? "product" : "funnel";
  const name = str(fd, "name"); if (!name) return;
  const [f] = await db().insert(funnelFolders).values({ name, kind }).returning({ id: funnelFolders.id });
  revalidatePath("/funnels"); revalidatePath("/products"); redirect(`${kind === "product" ? "/products" : "/funnels"}?folder=${f.id}`);
}
export async function renameFolder(fd: FormData) {
  const id = num(fd, "id"); const name = str(fd, "name");
  if (id && name) await db().update(funnelFolders).set({ name }).where(eq(funnelFolders.id, id));
  revalidatePath("/funnels"); revalidatePath("/products");
}
export async function deleteFolder(fd: FormData) {
  const id = num(fd, "id");
  if (id) await db().delete(funnelFolders).where(eq(funnelFolders.id, id)); // воронки залишаються, folder_id → null
  revalidatePath("/funnels"); revalidatePath("/products"); redirect("/funnels");
}

// --- воронки ---
/** Цифровий продукт (ZenEdu Digital product): той самий редактор кроків, доступ дається офферами. Разом можна створити оффер або додати продукт до наявного. */
export async function createProduct(fd: FormData) {
  const d = db();
  const settings: FunnelSettings = { entryKind: "manual", entryValue: "", accessDirect: false, accessAfterFinish: true, contentProtection: false, restart: false, lessonTitles: true, template: false, quietHours: true };
  const name = str(fd, "name") || "Новий продукт";
  const [f] = await d.insert(funnels).values({ source: "hub", kind: "product", name, folderId: num(fd, "folderId") || null, buttonText: "Отримати доступ", status: "draft", isActive: false, settings }).returning({ id: funnels.id });
  const offerMode = str(fd, "offerMode"); // new | existing | none
  if (offerMode === "new") {
    const paymentType = str(fd, "paymentType") === "one_time" ? "one_time" : "subscription";
    await d.insert(plans).values({ key: `${slugKey(name)}_${Date.now().toString(36)}`, name, price: str(fd, "price") || "0", currency: str(fd, "currency") || "UAH", paymentType, period: "month", intervalCount: 1, products: [f.id], accessMode: "forever", isActive: true, showInBot: true });
  } else if (offerMode === "existing" && num(fd, "offerId")) {
    await d.execute(sql`update plans set products = products || to_jsonb(${f.id}::int), updated_at = now() where id = ${num(fd, "offerId")} and not products @> to_jsonb(array[${f.id}::int])`);
  }
  revalidatePath("/products"); revalidatePath("/offers"); redirect(`/products/${f.id}`);
}
const slugKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "offer";
export async function createFunnel(fd: FormData) {
  const folderId = num(fd, "folderId") || null;
  const settings: FunnelSettings = { entryKind: "start", entryValue: "", accessDirect: false, accessAfterFinish: true, contentProtection: false, restart: false, lessonTitles: false, template: false, quietHours: true };
  const [f] = await db().insert(funnels).values({ source: "hub", name: str(fd, "name") || "Нова воронка", folderId, buttonText: "Отримати доступ", status: "draft", isActive: false, settings }).returning({ id: funnels.id });
  revalidatePath("/funnels"); revalidatePath("/products"); redirect(`${await fb(f.id)}/${f.id}`);
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
  revalidatePath(`${await fb(id)}/${id}`); revalidatePath("/funnels"); revalidatePath("/products"); revalidatePath(`/f/${id}`);
  redirect(`${await fb(id)}/${id}?tab=settings&saved=1`);
}
export async function setFunnelStatus(fd: FormData) {
  const id = num(fd, "id"); const active = str(fd, "status") === "active";
  await db().update(funnels).set({ status: active ? "active" : "stopped", isActive: active, updatedAt: new Date() }).where(eq(funnels.id, id));
  revalidatePath("/funnels"); revalidatePath("/products"); revalidatePath(`${await fb(id)}/${id}`);
}
export async function moveFunnel(fd: FormData) {
  const id = num(fd, "id"); const folderId = num(fd, "folderId") || null;
  await db().update(funnels).set({ folderId, updatedAt: new Date() }).where(eq(funnels.id, id));
  revalidatePath("/funnels"); revalidatePath("/products");
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
  revalidatePath("/funnels"); revalidatePath("/products"); redirect(`${await fb(nf.id)}/${nf.id}`);
}
export async function deleteFunnel(fd: FormData) {
  const id = num(fd, "id"); const base = await fb(id);
  if (base === "/products") await db().execute(sql`update plans set products = (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(products) x where x <> to_jsonb(${id}::int)) where products @> to_jsonb(array[${id}::int])`);
  await db().delete(funnels).where(eq(funnels.id, id));
  revalidatePath("/funnels"); revalidatePath("/products"); revalidatePath("/offers"); redirect(base);
}

// --- модулі ---
export async function addModule(fd: FormData) {
  const funnelId = num(fd, "funnelId"); const name = str(fd, "name") || "Новий модуль";
  const last = await db().select({ p: funnelModules.position }).from(funnelModules).where(eq(funnelModules.funnelId, funnelId)).orderBy(desc(funnelModules.position)).limit(1);
  await db().insert(funnelModules).values({ funnelId, name, position: (last[0]?.p ?? 0) + 10 });
  revalidatePath(`${await fb(funnelId)}/${funnelId}`);
}
export async function renameModule(fd: FormData) {
  const id = num(fd, "id"); const funnelId = num(fd, "funnelId"); const name = str(fd, "name");
  if (name) await db().update(funnelModules).set({ name }).where(eq(funnelModules.id, id));
  revalidatePath(`${await fb(funnelId)}/${funnelId}`);
}
export async function deleteModule(fd: FormData) {
  const id = num(fd, "id"); const funnelId = num(fd, "funnelId");
  await db().delete(funnelModules).where(eq(funnelModules.id, id)); // кроки залишаються без модуля
  revalidatePath(`${await fb(funnelId)}/${funnelId}`);
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
  revalidatePath(`${await fb(funnelId)}/${funnelId}`);
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
  revalidatePath(`${await fb(funnelId)}/${funnelId}`); redirect(`${await fb(funnelId)}/${funnelId}/steps/${s.id}`);
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
  revalidatePath(`${await fb(funnelId)}/${funnelId}`); revalidatePath(`${await fb(funnelId)}/${funnelId}/steps/${id}`);
  const next = str(fd, "after"); // preview | close
  if (next === "preview") { await sendStepToAdmin(id); redirect(`${await fb(funnelId)}/${funnelId}/steps/${id}?sent=1`); }
  if (next === "close") redirect(`${await fb(funnelId)}/${funnelId}`);
  redirect(`${await fb(funnelId)}/${funnelId}/steps/${id}?saved=1`);
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
  redirect(`${await fb(funnelId)}/${funnelId}/steps/${id}?sent=1`);
}
export async function toggleStep(fd: FormData) {
  const id = num(fd, "id"); const funnelId = num(fd, "funnelId");
  await db().update(funnelSteps).set({ isActive: sql`not ${funnelSteps.isActive}` }).where(eq(funnelSteps.id, id));
  revalidatePath(`${await fb(funnelId)}/${funnelId}`);
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
  revalidatePath(`${await fb(funnelId)}/${funnelId}`);
}
export async function deleteStep(fd: FormData) {
  const funnelId = num(fd, "funnelId");
  await db().delete(funnelSteps).where(eq(funnelSteps.id, num(fd, "id")));
  await refreshFunnelCounts(funnelId);
  revalidatePath(`${await fb(funnelId)}/${funnelId}`);
  if (str(fd, "back") === "1") redirect(`${await fb(funnelId)}/${funnelId}`);
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
  revalidatePath(`${await fb(funnelId)}/${funnelId}`);
}

// --- меню (команди) ---
export async function saveCommand(fd: FormData) {
  const funnelId = num(fd, "funnelId"); const id = num(fd, "id");
  const command = str(fd, "command").toLowerCase().replace(/^\//, "").replace(/[^a-z0-9_]/g, "").slice(0, 32); if (!command) return;
  const action = str(fd, "actionType") === "step" ? { type: "step" as const, stepId: num(fd, "stepId") || undefined } : { type: "text" as const, text: str(fd, "text").slice(0, 4096) };
  const row = { funnelId, command, description: str(fd, "description").slice(0, 256) || null, action };
  if (id) await db().update(funnelCommands).set(row).where(eq(funnelCommands.id, id));
  else { const last = await db().select({ p: funnelCommands.position }).from(funnelCommands).where(eq(funnelCommands.funnelId, funnelId)).orderBy(desc(funnelCommands.position)).limit(1); await db().insert(funnelCommands).values({ ...row, position: (last[0]?.p ?? 0) + 10 }); }
  revalidatePath(`${await fb(funnelId)}/${funnelId}`); redirect(`${await fb(funnelId)}/${funnelId}?tab=menu`);
}
export async function deleteCommand(fd: FormData) {
  const funnelId = num(fd, "funnelId");
  await db().delete(funnelCommands).where(eq(funnelCommands.id, num(fd, "id")));
  revalidatePath(`${await fb(funnelId)}/${funnelId}`);
}

// --- проходження ---
export async function enrollToFunnel(fd: FormData) {
  const funnelId = num(fd, "funnelId"); const personId = num(fd, "personId");
  await enrollPerson(funnelId, personId, "manual");
  await processDue(20);
  revalidatePath(`${await fb(funnelId)}/${funnelId}`); revalidatePath(`/people/${personId}`);
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
  revalidatePath(`${await fb(funnelId)}/${funnelId}`); redirect(`${await fb(funnelId)}/${funnelId}?tested=${p[0] ? 1 : 0}`);
}
export async function stopFunnelEnrollment(fd: FormData) {
  const id = num(fd, "id"); const funnelId = num(fd, "funnelId");
  await db().update(funnelEnrollments).set({ status: "stopped", stopReason: "manual", finishedAt: new Date(), awaitingStepId: null }).where(eq(funnelEnrollments.id, id));
  revalidatePath(`${await fb(funnelId)}/${funnelId}`);
}
export async function stopEnrollmentsBulk(fd: FormData) {
  const funnelId = num(fd, "funnelId"); const ids = String(fd.get("ids") ?? "").split(",").map(Number).filter(Boolean);
  if (ids.length) await db().update(funnelEnrollments).set({ status: "stopped", stopReason: "manual", finishedAt: new Date(), awaitingStepId: null }).where(and(eq(funnelEnrollments.funnelId, funnelId), inArray(funnelEnrollments.id, ids)));
  revalidatePath(`${await fb(funnelId)}/${funnelId}`);
}
export async function runTickNow() {
  await processDue(100);
  revalidatePath("/funnels"); revalidatePath("/products");
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
  const config = { ...((cur?.config ?? {}) as Record<string, unknown>), chatId: str(fd, "chatId") || undefined, joinMode: str(fd, "joinMode") || "invite", inviteTtlHours: Number(fd.get("inviteTtlHours") || 24), graceDays: Number(fd.get("graceDays") || 0), inviteText: str(fd, "inviteText") || undefined, kickText: str(fd, "kickText") || undefined, note: str(fd, "note") || undefined, enforce: fd.get("enforce") === "on" };
  await db().update(resources).set({ name: str(fd, "name") || cur?.name || key, config }).where(eq(resources.key, key));
  revalidatePath("/resources"); revalidatePath(`/resources/${key}`);
  redirect(`/resources/${key}?saved=1`);
}
export async function runAccessTickNow() { await accessTick(); revalidatePath("/resources"); }
export async function runReconcileNow() { await reconcileChannels(); revalidatePath("/resources"); }

/** Дані чату з Telegram: назва, тип, аватар (маленький, як data URL), кількість учасників. */
async function fetchChatInfo(chatId: string) {
  const api = getBot().api;
  const chat = await api.getChat(chatId);
  const count = await api.getChatMemberCount(chatId).catch(() => null);
  let cover: string | undefined;
  const photoId = (chat as { photo?: { small_file_id: string } }).photo?.small_file_id;
  if (photoId) {
    try {
      const f = await api.getFile(photoId);
      if (f.file_path) { const res = await fetch(`https://api.telegram.org/file/bot${botToken()}/${f.file_path}`); if (res.ok) cover = `data:image/jpeg;base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`; }
    } catch { /* без аватара */ }
  }
  const type = (chat as { type: string }).type;
  return { title: (chat as { title?: string }).title ?? chatId, kind: type === "channel" ? "telegram_channel" : "telegram_group", cover, memberCount: count ?? undefined, username: (chat as { username?: string }).username };
}
/** Підключити канал або групу (як «Connect channel or group» у ZenEdu): бот уже має бути адміністратором у чаті. */
export async function connectChat(fd: FormData) {
  const chatId = str(fd, "chatId").replace(/\s/g, ""); if (!chatId) return;
  const [dup] = await db().select({ key: resources.key }).from(resources).where(sql`${resources.config}->>'chatId' = ${chatId}`);
  if (dup) redirect(`/resources/${dup.key}`);
  let info: Awaited<ReturnType<typeof fetchChatInfo>>;
  try { info = await fetchChatInfo(chatId); } catch (e) { redirect(`/resources?err=${encodeURIComponent("Telegram не віддає чат " + chatId + ": " + String(e).slice(0, 120) + ". Додайте Hub-бот у чат адміністратором.")}`); }
  const key = `tg.${chatId.replace(/^-100|^-/, "")}`;
  const config = { chatId, cover: info.cover, memberCount: info.memberCount, username: info.username, joinMode: "invite", inviteTtlHours: 24, graceDays: 0, syncedAt: new Date().toISOString() };
  await db().insert(resources).values({ key, name: str(fd, "name") || info.title, kind: info.kind, config }).onConflictDoUpdate({ target: resources.key, set: { name: str(fd, "name") || info.title, kind: info.kind, config } });
  revalidatePath("/resources"); redirect(`/resources/${key}?new=1`);
}
/** Оновити назву, аватар і кількість учасників із Telegram. */
export async function refreshChatInfo(fd: FormData) {
  const key = str(fd, "key");
  const [r] = await db().select().from(resources).where(eq(resources.key, key)); if (!r) return;
  const cfg = (r.config ?? {}) as Record<string, unknown>;
  if (cfg.chatId) {
    try { const info = await fetchChatInfo(String(cfg.chatId)); await db().update(resources).set({ config: { ...cfg, cover: info.cover ?? cfg.cover, memberCount: info.memberCount, username: info.username, syncedAt: new Date().toISOString() } }).where(eq(resources.key, key)); }
    catch (e) { redirect(`/resources?err=${encodeURIComponent(String(e).slice(0, 160))}`); }
  }
  revalidatePath("/resources"); revalidatePath(`/resources/${key}`);
}
export async function toggleResource(fd: FormData) {
  const key = str(fd, "key");
  await db().update(resources).set({ isActive: sql`not ${resources.isActive}` }).where(eq(resources.key, key));
  revalidatePath("/resources"); revalidatePath(`/resources/${key}`);
}
export async function deleteResource(fd: FormData) {
  const key = str(fd, "key");
  await db().delete(resources).where(eq(resources.key, key));
  revalidatePath("/resources"); revalidatePath("/plans"); redirect("/resources");
}
export async function resendInvite(fd: FormData) {
  const personId = Number(fd.get("personId")); const key = str(fd, "resourceKey");
  await db().update(membershipsT).set({ status: "none", inviteLink: null, updatedAt: new Date() }).where(and(eq(membershipsT.personId, personId), eq(membershipsT.resourceKey, key)));
  await processGrants(5);
  revalidatePath(`/people/${personId}`);
}

// ---------- оплати WayForPay ----------
import { setSetting as setPaySetting, payLink, chargeSubscription, cancelAtEnd, resumeSub, pauseSub, refundAttempt } from "./payments";
import { liveConfigured } from "./wayforpay";
import { money as fmtMoney } from "./format";
const { subscriptions: subsT, plans: plansT } = schema;

export async function savePaymentSettings(fd: FormData) {
  const mode = str(fd, "mode") === "live" && liveConfigured() ? "live" : "test";
  await setPaySetting("payments.mode", mode);
  await setPaySetting("payments.migrationDays", Math.max(1, Number(fd.get("migrationDays") || 5)));
  await setPaySetting("payments.reminderDays", Math.max(1, Number(fd.get("reminderDays") || 3)));
  await setPaySetting("payments.trialVerifyAmount", Math.max(1, Number(fd.get("verifyAmount") || 1)));
  await setPaySetting("payments.migrationAuto", fd.get("migrationAuto") === "on");
  await setPaySetting("payments.enabled", fd.get("enabled") === "on");
  revalidatePath("/settings"); redirect("/settings?tab=payments&ok=" + encodeURIComponent(`Збережено. Режим: ${mode === "live" ? "бойовий" : "тестовий"}.`));
}
export async function makeTestPayLink(fd: FormData) {
  const planKey = str(fd, "planKey"); const kind = (str(fd, "kind") || "first") as "first" | "card" | "migrate";
  const p = await db().select({ id: persons.id }).from(persons).where(eq(persons.telegramUserId, adminTelegramId()));
  if (!p[0]) redirect("/settings?tab=payments&err=" + encodeURIComponent("Спершу натисніть /start у Hub-боті з акаунта ADMIN_TELEGRAM_ID"));
  redirect(`/settings?tab=payments&link=${encodeURIComponent(payLink(p[0].id, planKey, kind))}`);
}
export async function refundPayment(fd: FormData) {
  const id = Number(fd.get("id")); const back = str(fd, "back") || "/payments?tab=hub";
  const r = await refundAttempt(id, str(fd, "comment") || "Повернення з Hub");
  revalidatePath("/payments"); redirect(`${back}${back.includes("?") ? "&" : "?"}${r.ok ? "ok=" + encodeURIComponent("Повернення виконано") : "err=" + encodeURIComponent("Повернення не пройшло: " + r.reason)}`);
}
export async function subscriptionAction(fd: FormData) {
  const id = Number(fd.get("id")); const personId = Number(fd.get("personId")); const act = str(fd, "act");
  let msg = "";
  if (act === "cancel") { await cancelAtEnd(id, "admin"); msg = "Продовження вимкнено"; }
  else if (act === "resume") { await resumeSub(id, "admin"); msg = "Підписку відновлено"; }
  else if (act === "pause") { await pauseSub(id, "admin"); msg = "Підписку поставлено на паузу"; }
  else if (act === "charge") { const r = await chargeSubscription(id); msg = r.ok ? "Списання пройшло" : "Списання не пройшло: " + r.reason; }
  revalidatePath(`/people/${personId}`); redirect(`/people/${personId}?${msg.includes("не пройшло") ? "err" : "ok"}=${encodeURIComponent(msg)}`);
}
export async function sendMigrateInvite(fd: FormData) {
  const personId = Number(fd.get("personId")); const planKey = str(fd, "planKey");
  const [zen] = await db().select().from(subsT).where(and(eq(subsT.personId, personId), eq(subsT.source, "zenedu")));
  const link = payLink(personId, planKey, "migrate");
  const ok = await sendToPerson(personId, `Клуб переїжджає на власну платформу. Щоб доступ не перервався, прив'яжіть картку за хвилину: ${link}\n\nЦіна ${zen ? fmtMoney(zen.price, zen.currency) : ""} і дата списання${zen?.currentPeriodEnd ? " " + zen.currentPeriodEnd.toLocaleDateString("uk-UA") : ""} лишаються без змін. Перевірочна сума повертається.`).catch(() => false);
  if (ok) await db().insert(events).values({ personId, type: "payment.migrate_invite", source: "admin", payload: { zenSubId: zen?.id ?? null, periodEnd: zen?.currentPeriodEnd ?? null } });
  revalidatePath("/migration"); redirect(`/migration?${ok ? "ok=" + encodeURIComponent("Запрошення надіслано") : "err=" + encodeURIComponent("Людина не запускала Hub-бот, надіслати неможливо")}`);
}
export async function markZenCancelled(fd: FormData) {
  const id = Number(fd.get("id"));
  await db().update(subsT).set({ zenCancelledAt: fd.get("undo") ? null : new Date(), updatedAt: new Date() }).where(eq(subsT.id, id));
  revalidatePath("/migration"); redirect("/migration");
}
export async function planKeys(subscriptionOnly = false) { return db().select({ key: plansT.key, name: plansT.name }).from(plansT).where(subscriptionOnly ? and(eq(plansT.isActive, true), eq(plansT.paymentType, "subscription")) : eq(plansT.isActive, true)).orderBy(plansT.sortOrder); }
