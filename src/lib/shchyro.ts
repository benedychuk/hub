import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, hasDb, schema } from "@/db";
import { accessGraceHours, subscriptionAllowsSql } from "./access-rule";

/**
 * Керування доступом до бота «Щиро» з Hub (push-модель за ТЗ інтеграції).
 *
 * Hub — головна система для підписок. «Щиро» виконує рішення, які приходять
 * звідси: grant після оплати, revoke після завершення підписки, щоденна
 * звірка повного списку. Бот «Щиро» читає свій access_list із кешем 5 с,
 * тому зміни доїжджають до нього не пізніше ніж за п'ять секунд.
 *
 * Запобіжник: уся автоматика працює лише коли власник увімкнув
 * «Автоматика доступу „Щиро“» (settings shchyro.push_enabled), вимкнено за
 * замовчуванням. Без перемикача Hub нічого не пише і не змінює в «Щиро».
 *
 * Змінні оточення: SHCHYRO_API_URL (базова адреса панелі «Щиро» разом із
 * ADMIN_BASE_PATH, напр. https://panel.example.com/panel-x7k2) і
 * SHCHYRO_API_SECRET (той самий, що HUB_API_SECRET у «Щиро»).
 */

const { persons, settings, events, entitlements, resources } = schema;

export const DEFAULT_RESOURCE = "shchyro.access";
const TIMEOUT_MS = 8_000;
const PUSH_BATCH = 60; // grant/revoke за один тік: укладається в хвилину й не б'є по «Щиро»
const KEYS = { enabled: "shchyro.push_enabled", resource: "shchyro.resource_key", pushed: "shchyro.pushed_ids", lastSync: "shchyro.last_sync", lastPush: "shchyro.last_push", lastCheck: "shchyro.last_check" } as const;

export type ShchyroResult<T = Record<string, unknown>> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string; data?: Record<string, unknown> };
export type SyncSummary = { at: string; mode: "preview" | "reconcile"; ok: boolean; error?: string; total_received?: number; activated?: number; deactivated?: number; protected_untouched?: number; unchanged?: number; applied?: boolean; activated_ids?: number[]; deactivated_ids?: number[]; limit?: number };
export type ShchyroAccess = { is_active: boolean; is_admin: boolean; has_access: boolean; source: string | null; note: string; added_at: string | null; removed_at: string | null };
export type ShchyroClientRow = { user_id: number; username: string | null; first_name: string | null; last_name: string | null; created_at: string; last_seen_at: string; total_messages: number; sessions_count: number; is_blocked: boolean; admin_notes: string; access: ShchyroAccess; profile_version: number };
export type ShchyroClientCard = { user_id: number; found: boolean; access: ShchyroAccess; client: Omit<ShchyroClientRow, "access" | "profile_version"> | null; profile: { summary_text: string; data: Record<string, unknown>; version: number; updated_at: string | null } | null; window_chars?: number; consolidation_threshold_chars?: number; sessions: { id: number; started_at: string; last_activity_at: string; messages_count: number; opened_by: string | null }[]; summaries_count: number; messages: { id: number; role: string; content: string; created_at: string; archived: boolean }[] };
export type ShchyroRun = { id: number; status: string; started_at: string; finished_at: string | null; started_by: string | null; clients_analyzed: number; prompt_tokens: number; completion_tokens: number; total_tokens: number; error: string | null; report_md?: string; stats?: Record<string, unknown> };
export type ShchyroStats = { totals: { clients: number; messages: number; profiles: number; active_24h: number }; activity: { active_7d: number; active_30d: number; new_7d: number; new_30d: number; dormant_30d: number; engagement: { tried: number; engaged: number; loyal: number } }; usage: { by_kind: Record<string, { calls: number; prompt_tokens: number; completion_tokens: number; total_tokens: number }>; total_tokens: number; total_calls: number }; access: { active_count: number; admin_ids: number[]; cache_ttl_seconds: number; managed_by_db: boolean }; analytics: { running: boolean; days_left: number | null; period_days: number; model: string; last_ok: ShchyroRun | null }; memory: { enabled: boolean; llm_model: string; summary_model: string; consolidation_threshold_chars: number }; time: string };
export type ShchyroAnalytics = { running: boolean; days_left: number | null; next_due_at: string | null; period_days: number; model: string; latest: ShchyroRun | null; last_ok: ShchyroRun | null; runs: ShchyroRun[] };
export type Entitled = { personId: number; telegramUserId: number; validUntil: Date | null; source: "manual" | "plan" | "zenedu"; planKey: string | null; subscriptionId: number | null };

// ---------- конфігурація ----------
export function shchyroConfigured() { return Boolean(process.env.SHCHYRO_API_URL && process.env.SHCHYRO_API_SECRET); }
export function shchyroBaseUrl() { return (process.env.SHCHYRO_API_URL ?? "").replace(/\/$/, ""); }

export async function shchyroSettings() {
  if (!hasDb()) return { enabled: false, resourceKey: DEFAULT_RESOURCE, pushedIds: [] as number[], lastSync: null as SyncSummary | null, lastPush: null as Record<string, unknown> | null, lastCheck: null as Record<string, unknown> | null };
  const rows = await db().select().from(settings).where(inArray(settings.key, Object.values(KEYS)));
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    enabled: m[KEYS.enabled] === true,
    resourceKey: typeof m[KEYS.resource] === "string" && m[KEYS.resource] ? String(m[KEYS.resource]) : DEFAULT_RESOURCE,
    pushedIds: Array.isArray(m[KEYS.pushed]) ? (m[KEYS.pushed] as number[]).map(Number).filter((n) => n > 0) : [],
    lastSync: (m[KEYS.lastSync] as SyncSummary | undefined) ?? null,
    lastPush: (m[KEYS.lastPush] as Record<string, unknown> | undefined) ?? null,
    lastCheck: (m[KEYS.lastCheck] as Record<string, unknown> | undefined) ?? null,
  };
}
async function setSetting(key: string, value: unknown) {
  await db().insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}
export async function saveShchyroSettings(v: { enabled: boolean; resourceKey: string }) {
  await setSetting(KEYS.enabled, v.enabled);
  await setSetting(KEYS.resource, v.resourceKey || DEFAULT_RESOURCE);
}

// ---------- HTTP ----------
async function request<T = Record<string, unknown>>(method: "GET" | "POST", path: string, body?: unknown): Promise<ShchyroResult<T>> {
  if (!shchyroConfigured()) return { ok: false, status: 0, error: "SHCHYRO_API_URL або SHCHYRO_API_SECRET не задані" };
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(shchyroBaseUrl() + path, {
      method, signal: ctrl.signal, cache: "no-store",
      headers: { "X-Hub-Secret": process.env.SHCHYRO_API_SECRET!, "Content-Type": "application/json", "User-Agent": "hub/1.0" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let data: Record<string, unknown> = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 300) }; }
    if (!r.ok) return { ok: false, status: r.status, error: String(data.error ?? data.detail ?? `HTTP ${r.status}`), data };
    return { ok: true, status: r.status, data: data as T };
  } catch (e) {
    return { ok: false, status: 0, error: String((e as Error).name === "AbortError" ? "таймаут" : (e as Error).message ?? e).slice(0, 200) };
  } finally { clearTimeout(t); }
}

export const shchyroHealth = () => request("GET", "/api/v1/hub/health");
/** Довільний запит до API «Щиро» для інших модулів Hub (онбординг). */
export const shchyroRequestPublic = (method: "GET" | "POST", path: string, body?: unknown) => request(method, path, body);
export const shchyroStatus = (telegramUserId: number) => request("GET", `/api/v1/hub/access/status/${telegramUserId}`);
export const shchyroList = (onlyActive = true) => request<{ total: number; admin_ids: number[]; items: { user_id: number; is_active: boolean; source: string | null; note: string; username: string | null; first_name: string | null }[] }>("GET", `/api/v1/hub/access/list?only_active=${onlyActive}&limit=5000`);
export const shchyroGrant = (b: { user_id: number; subscription_id?: string | null; product_code?: string | null; expires_at?: string | null; note?: string }) => request("POST", "/api/v1/hub/access/grant", b);
export const shchyroRevoke = (b: { user_id: number; reason: string; note?: string }) => request("POST", "/api/v1/hub/access/revoke", b);
export const shchyroNotify = (b: { user_id: number; message: string; parse_mode?: "HTML" }) => request("POST", "/api/v1/hub/bot/notify", { parse_mode: "HTML", ...b });

// ---------- дані панелі «Щиро» для сторінок Hub ----------
export const shchyroStats = () => request<ShchyroStats>("GET", "/api/v1/hub/stats");
export const shchyroClients = (q = "", limit = 200, offset = 0, order = "last_seen_at") => request<{ total: number; limit: number; offset: number; items: ShchyroClientRow[] }>("GET", `/api/v1/hub/clients?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}&order=${encodeURIComponent(order)}`);
export const shchyroClient = (telegramUserId: number, messages = 0) => request<ShchyroClientCard>("GET", `/api/v1/hub/clients/${telegramUserId}?messages=${messages}`);
export const shchyroAnalytics = (report = false) => request<ShchyroAnalytics>("GET", `/api/v1/hub/analytics?report=${report}`);
export const shchyroAnalyticsRun = (id: number) => request<ShchyroRun>("GET", `/api/v1/hub/analytics/${id}`);
export const shchyroStartAnalytics = () => request<{ success: boolean; run: ShchyroRun }>("POST", "/api/v1/hub/analytics/run");
/** Адреса картки клієнтки в адмінпанелі «Щиро» (панель живе за тією самою базовою адресою). */
export const shchyroPanelClientUrl = (telegramUserId: number) => shchyroConfigured() ? `${shchyroBaseUrl()}/clients/${telegramUserId}` : null;

// ---------- хто має право зараз ----------
/**
 * Усі, хто зараз має право на ресурс «Щиро», одним запитом. Джерела ті самі, що в checkAccess:
 * ручне право з чинним valid_until; активна Hub-підписка на тариф із ресурсом; активна підписка ZenEdu,
 * якщо ресурс має config.zenedu_grants (перехідний режим). Денна квота тут не враховується: вона не
 * означає втрату доступу.
 */
export async function shchyroEntitled(resourceKey?: string, personId?: number): Promise<Entitled[]> {
  const d = db();
  const key = resourceKey ?? (await shchyroSettings()).resourceKey;
  const pf = personId ? sql`and b.person_id = ${personId}` : sql``;
  const [res] = await d.select().from(resources).where(eq(resources.key, key));
  const zen = Boolean((res?.config as { zenedu_grants?: boolean } | undefined)?.zenedu_grants);
  const grace = await accessGraceHours();
  const allowSql = sql.raw(subscriptionAllowsSql("s", grace)); // єдине правило: активна або грейс після кінця періоду
  const graceIv = sql.raw(`(${Math.max(0, Math.round(grace))} * interval '1 hour')`);
  const rows = (await d.execute(sql`
    with src as (
      select e.person_id, e.valid_until, 'manual' as source, null::text as plan_key, e.subscription_id, 1 as pri
        from entitlements e
       where e.resource_key = ${key} and e.revoked_at is null and (e.valid_until is null or e.valid_until > now()) ${personId ? sql`and e.person_id = ${personId}` : sql``}
      union all
      select s.person_id, s.current_period_end + ${graceIv}, 'plan', p.key, s.id, 2
        from subscriptions s join plans p on p.id = s.plan_id
       where ${allowSql} and p.entitlements ? ${key} ${personId ? sql`and s.person_id = ${personId}` : sql``}
      union all
      select s.person_id, s.current_period_end + ${graceIv}, 'zenedu', 'zenedu', s.id, 3
        from subscriptions s
       where ${sql.raw(zen ? "true" : "false")} and s.source = 'zenedu' and ${allowSql} ${personId ? sql`and s.person_id = ${personId}` : sql``}
    ), best as (
      select distinct on (person_id) person_id, valid_until, source, plan_key, subscription_id
        from src order by person_id, pri, valid_until desc nulls first
    )
    select b.person_id, p.telegram_user_id, b.valid_until, b.source, b.plan_key, b.subscription_id
      from best b join persons p on p.id = b.person_id where true ${pf}`)).rows as { person_id: number; telegram_user_id: string | number; valid_until: string | null; source: string; plan_key: string | null; subscription_id: number | null }[];
  return rows.map((r) => ({ personId: r.person_id, telegramUserId: Number(r.telegram_user_id), validUntil: r.valid_until ? new Date(r.valid_until) : null, source: r.source as Entitled["source"], planKey: r.plan_key, subscriptionId: r.subscription_id }));
}

async function logEvent(personId: number | null, type: string, payload: Record<string, unknown>) {
  await db().insert(events).values({ personId, type, source: "hub", payload }).catch(() => null);
}
const grantBody = (e: Entitled) => ({
  user_id: e.telegramUserId,
  subscription_id: e.subscriptionId ? `sub_${e.subscriptionId}` : null,
  product_code: e.planKey ?? (e.source === "manual" ? "manual" : null),
  expires_at: e.validUntil ? e.validUntil.toISOString() : null,
  note: e.source === "manual" ? `Hub: ручне право${e.validUntil ? ` до ${e.validUntil.toLocaleDateString("uk-UA")}` : ""}` : e.source === "zenedu" ? `Hub: підписка ZenEdu${e.validUntil ? ` до ${e.validUntil.toLocaleDateString("uk-UA")}` : ""}` : `Hub: тариф ${e.planKey ?? ""}${e.validUntil ? ` до ${e.validUntil.toLocaleDateString("uk-UA")}` : ""}`,
});

/**
 * Тік: порівнює, хто має право зараз, зі знімком тих, кому Hub уже відкрив доступ у «Щиро»,
 * і надсилає grant новим та revoke тим, у кого право зникло. Знімок оновлюється лише
 * успішними викликами, тому недоступність «Щиро» просто відкладає зміну до наступного тіку.
 * Revoke іде лише тим, кого Hub сам колись увімкнув: ручні записи панелі «Щиро» й усе, що було
 * до переїзду, ця функція не чіпає — для цього є щоденна звірка.
 */
export async function shchyroPushChanges() {
  const st = await shchyroSettings();
  if (!st.enabled) return { skipped: "disabled" as const };
  if (!shchyroConfigured()) return { skipped: "not_configured" as const };
  const entitled = await shchyroEntitled(st.resourceKey);
  const byTg = new Map(entitled.map((e) => [e.telegramUserId, e]));
  const pushed = new Set(st.pushedIds);
  const toGrant = entitled.filter((e) => !pushed.has(e.telegramUserId)).slice(0, PUSH_BATCH);
  const toRevoke = [...pushed].filter((tg) => !byTg.has(tg)).slice(0, PUSH_BATCH);
  let granted = 0, revoked = 0, failed = 0; let lastError: string | null = null;
  for (const e of toGrant) {
    const r = await shchyroGrant(grantBody(e));
    if (r.ok) { pushed.add(e.telegramUserId); granted++; await logEvent(e.personId, "shchyro.granted", { source: e.source, plan: e.planKey, until: e.validUntil }); }
    else { failed++; lastError = r.error; await logEvent(e.personId, "shchyro.error", { op: "grant", error: r.error, status: r.status }); }
  }
  if (toRevoke.length) {
    const ps = await db().select({ id: persons.id, tg: persons.telegramUserId }).from(persons).where(inArray(persons.telegramUserId, toRevoke));
    const pid = new Map(ps.map((p) => [p.tg, p.id]));
    for (const tg of toRevoke) {
      const r = await shchyroRevoke({ user_id: tg, reason: "expired", note: "Hub: право закінчилось або підписку завершено" });
      if (r.ok || r.status === 403) { pushed.delete(tg); if (r.ok) revoked++; await logEvent(pid.get(tg) ?? null, r.ok ? "shchyro.revoked" : "shchyro.error", r.ok ? { telegram_user_id: tg } : { op: "revoke", error: r.error, status: r.status, telegram_user_id: tg }); }
      else { failed++; lastError = r.error; await logEvent(pid.get(tg) ?? null, "shchyro.error", { op: "revoke", error: r.error, status: r.status, telegram_user_id: tg }); }
    }
  }
  const summary = { at: new Date().toISOString(), entitled: entitled.length, granted, revoked, failed, pending: Math.max(0, entitled.filter((e) => !pushed.has(e.telegramUserId)).length), error: lastError };
  await setSetting(KEYS.pushed, [...pushed]);
  await setSetting(KEYS.lastPush, summary);
  return summary;
}

/** Повна звірка: Hub надсилає всіх, хто має право, «Щиро» вмикає їх і вимикає решту (крім ручних і адміністраторів). */
export async function shchyroFullSync(opts: { preview?: boolean; force?: boolean; by?: string } = {}) {
  const st = await shchyroSettings();
  const mode: "preview" | "reconcile" = opts.preview ? "preview" : "reconcile";
  if (!shchyroConfigured()) { const s: SyncSummary = { at: new Date().toISOString(), mode, ok: false, error: "SHCHYRO_API_URL або SHCHYRO_API_SECRET не задані" }; await setSetting(KEYS.lastSync, s); return s; }
  if (mode === "reconcile" && !st.enabled) { const s: SyncSummary = { at: new Date().toISOString(), mode, ok: false, error: "Автоматика доступу «Щиро» вимкнена: доступна лише перевірка розбіжностей" }; await setSetting(KEYS.lastSync, s); return s; }
  const entitled = await shchyroEntitled(st.resourceKey);
  const ids = [...new Set(entitled.map((e) => e.telegramUserId))];
  const r = await request("POST", "/api/v1/hub/access/sync", { active_user_ids: ids, mode, force: Boolean(opts.force), allow_empty: false });
  const d = (r.ok ? r.data : r.data ?? {}) as Record<string, unknown>;
  const summary: SyncSummary = { at: new Date().toISOString(), mode, ok: r.ok, error: r.ok ? undefined : r.error,
    total_received: Number(d.total_received ?? ids.length), activated: Number(d.activated ?? 0), deactivated: Number(d.deactivated ?? 0), protected_untouched: Number(d.protected_untouched ?? 0), unchanged: Number(d.unchanged ?? 0), applied: d.applied === true,
    activated_ids: Array.isArray(d.activated_ids) ? (d.activated_ids as number[]).slice(0, 200) : [], deactivated_ids: Array.isArray(d.deactivated_ids) ? (d.deactivated_ids as number[]).slice(0, 200) : [], limit: d.limit != null ? Number(d.limit) : undefined };
  await setSetting(KEYS.lastSync, summary);
  if (r.ok && mode === "reconcile" && summary.applied) await setSetting(KEYS.pushed, ids); // знімок вирівняно з повним списком
  await logEvent(null, r.ok ? "shchyro.sync" : r.status === 409 ? "shchyro.sync_blocked" : "shchyro.error", { ...summary, by: opts.by ?? "cron", activated_ids: undefined, deactivated_ids: undefined });
  return summary;
}

/** Перевірка зв'язку й секрету; результат показується на сторінці ботів. */
export async function shchyroCheck() {
  const r = await shchyroHealth();
  const info = { at: new Date().toISOString(), ok: r.ok, error: r.ok ? undefined : r.error, active_count: r.ok ? Number(r.data.active_count ?? 0) : undefined, admin_ids: r.ok && Array.isArray(r.data.admin_ids) ? (r.data.admin_ids as number[]) : undefined, cache_ttl_seconds: r.ok ? Number(r.data.cache_ttl_seconds ?? 0) : undefined };
  await setSetting(KEYS.lastCheck, info);
  return info;
}

/**
 * Початкова міграція (етап 2 ТЗ): усі, хто зараз має доступ у «Щиро», отримують у Hub ручне право на N днів.
 * Так жодна учасниця не випаде під час переходу, а далі право з підписки замінить перехідне.
 * Повторний запуск нічого не дублює: кому право вже є, той пропускається.
 */
export async function shchyroImport(days: number, by = "admin") {
  const st = await shchyroSettings();
  const r = await shchyroList(true);
  if (!r.ok) return { ok: false as const, error: r.error };
  const d = db(); const now = new Date(); const until = new Date(now.getTime() + Math.max(1, days) * 86400_000);
  const entitled = new Set((await shchyroEntitled(st.resourceKey)).map((e) => e.telegramUserId));
  let createdPersons = 0, granted = 0, already = 0;
  for (const it of r.data.items) {
    if (!it.user_id || !it.is_active) continue;
    if (entitled.has(it.user_id)) { already++; continue; }
    const [p] = await d.insert(persons).values({ telegramUserId: it.user_id, firstName: it.first_name ?? null, username: it.username ?? null })
      .onConflictDoUpdate({ target: persons.telegramUserId, set: { updatedAt: now } }).returning({ id: persons.id, created: sql<boolean>`(xmax = 0)` });
    if (p.created) createdPersons++;
    const [ex] = await d.select({ id: entitlements.id }).from(entitlements).where(and(eq(entitlements.personId, p.id), eq(entitlements.resourceKey, st.resourceKey), isNull(entitlements.revokedAt), sql`(${entitlements.validUntil} is null or ${entitlements.validUntil} > now())`)).limit(1);
    if (ex) { already++; continue; }
    await d.insert(entitlements).values({ personId: p.id, resourceKey: st.resourceKey, grantedBy: "manual", validUntil: until });
    await logEvent(p.id, "entitlement.granted", { key: st.resourceKey, days, by: "shchyro_import", source: it.source, note: it.note });
    granted++;
  }
  const summary = { ok: true as const, at: now.toISOString(), received: r.data.total, granted, already, createdPersons, until: until.toISOString(), by };
  await logEvent(null, "shchyro.import", summary);
  return summary;
}

/** Право однієї людини на «Щиро» (джерело й дата), або null. */
export async function shchyroEntitledFor(personId: number) {
  const st = await shchyroSettings();
  const [e] = await shchyroEntitled(st.resourceKey, personId);
  return e ?? null;
}
