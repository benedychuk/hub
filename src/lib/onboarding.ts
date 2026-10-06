import { and, desc, eq, gt, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { db, schema } from "@/db";
import { hashPassword, verifyPassword } from "./auth";
import { appUrl, botToken } from "./bot";
import { shchyroConfigured, shchyroRequestPublic } from "./shchyro";
import { accessGraceHours, accessEnd, subscriptionAllows } from "./access-rule";

/**
 * Платформа онбордингу (кабінет кандидатки) як частина Hub.
 *
 * Акаунт кабінету живе в таблиці onboarding_accounts; браузер лише кешує його в localStorage.
 * Головний ключ людини — Telegram ID: акаунт прив'язується до persons через deep link у Hub-бот
 * (t.me/<бот>?start=ob_<link_code>) або через magic link з бота в кабінет.
 *
 * Кожна дія на платформі → подія `onboarding.<event_type>` у events + тег у картку (persons.tags і
 * onboarding_accounts.tags). Результат квізу додатково записується в пам'ять бота «Щиро».
 */

const { onboardingAccounts, persons, events, identities } = schema;
export type Account = typeof onboardingAccounts.$inferSelect;

export const TRIAL_DAYS = 14;
export const EXTENSION_DAYS = 7;
const DAY = 86400_000;
const MAGIC_TTL_SEC = 48 * 3600;
const SESSION_TTL_SEC = 30 * 86400;

/** Сценарії кризи базового квізу: id → тег і назва (матриця ТЗ, рядок 4). */
export const SCENARIOS: Record<number, { tag: string; name: string; summary: string }> = {
  1: { tag: "crisis_acute", name: "Гостра криза", summary: "гостра криза після болючої події чи зради; потребує стабілізації стану, а не стратегій, і підтримки в проживанні втрати ілюзій" },
  2: { tag: "crisis_lost_boundaries", name: "Втрата себе і порушені кордони", summary: "розчинення в партнері, відмова від власних бажань, страх конфлікту; потребує м'якої підтримки в поверненні фокусу на власні потреби та витримуванні дискомфорту сепарації" },
  3: { tag: "crisis_emotional_cold", name: "Емоційний холод", summary: "дистанція і самотність у парі, зникнення близькості; потребує роботи з поверненням тепла й відкритого діалогу про потреби" },
  4: { tag: "crisis_toxic_dynamics", name: "Токсична динаміка і маніпуляції", summary: "виснажлива динаміка конфліктів, критики й маніпуляцій; потребує розпізнавання деструктивних сценаріїв, кордонів і безпечного виходу" },
  5: { tag: "crisis_breakup_recovery", name: "Відновлення після розриву", summary: "завершення стосунків і втрата звичного життя; потребує часу на горювання, аналізу патернів і відбудови опор" },
  6: { tag: "crisis_total_exhaustion", name: "Загальне виснаження", summary: "тотальне виснаження майже в усіх сферах, дезорієнтація; потребує повільного перезавантаження і контакту з тілом та емоціями" },
};
/** Дозволені події та теги матриці ТЗ (розділ 3). video_lesson_N_opened — динамічний. */
export const EVENT_TAGS: Record<string, string | null> = {
  onboarding_registered: "onboarding_registered", quiz_started: "quiz_started", quiz_completed: "quiz_completed",
  deep_quiz_test_completed: null, deep_quiz_completed: "deep_quiz_completed", diagnostic_completed: "diagnostic_completed",
  feedback_completed: "feedback_completed", cta_club_clicked: "cta_club_clicked", cta_schyro_clicked: "cta_schyro_clicked",
  trial_expiring_soon: "trial_expiring_soon", trial_14_expired: "trial_14_expired", trial_extended_7_days: "trial_extended_7_days", trial_fully_expired: "trial_fully_expired",
  cabinet_opened: null, telegram_confirmed: "onboarding_registered",
};
export const TAG_LABELS: Record<string, string> = {
  onboarding_registered: "зареєструвалась у кабінеті", quiz_started: "почала квіз", quiz_completed: "пройшла квіз", deep_quiz_completed: "пройшла глибинний тест", diagnostic_completed: "пройшла діагностику",
  feedback_completed: "заповнила анкету", cta_club_clicked: "цікавилась клубом", cta_schyro_clicked: "відкривала «Щиро»", trial_expiring_soon: "тріал закінчується", trial_14_expired: "14 днів минули",
  trial_extended_7_days: "бонус +7 днів", trial_fully_expired: "доступ завершено", crisis_acute: "Гостра криза", crisis_lost_boundaries: "Втрата себе і кордони", crisis_emotional_cold: "Емоційний холод",
  crisis_toxic_dynamics: "Токсична динаміка", crisis_breakup_recovery: "Відновлення після розриву", crisis_total_exhaustion: "Загальне виснаження",
};

// ---------- конфігурація ----------
export function onboardingUrl() { return (process.env.ONBOARDING_URL ?? "").replace(/\/$/, ""); }
export function onboardingConfigured() { return Boolean(onboardingUrl()); }
function secret() { return process.env.ONBOARDING_TOKEN_SECRET ?? process.env.SESSION_SECRET ?? (process.env.TELEGRAM_BOT_TOKEN ? botToken() : "hub-onboarding"); }
/** Дозволені origin для CORS: ONBOARDING_ORIGINS через кому, інакше origin з ONBOARDING_URL; localhost для розробки. */
export function corsHeaders(reqOrigin: string | null) {
  const allowed = new Set((process.env.ONBOARDING_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  try { if (onboardingUrl()) allowed.add(new URL(onboardingUrl()).origin); } catch { /* ignore */ }
  const dev = process.env.NODE_ENV !== "production" && reqOrigin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(reqOrigin);
  const origin = reqOrigin && (allowed.has(reqOrigin) || dev) ? reqOrigin : (allowed.size ? [...allowed][0] : "*");
  return { "access-control-allow-origin": origin, "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "authorization,content-type", "access-control-max-age": "600", vary: "origin", "cache-control": "no-store" };
}

// ---------- токени (HMAC, без стану) ----------
const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
export function signToken(payload: Record<string, unknown>, ttlSec: number) {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec, jti: randomBytes(8).toString("hex") }));
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}
export function verifyToken<T extends Record<string, unknown>>(token: string | null | undefined): (T & { exp: number; jti: string }) | null {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expect = createHmac("sha256", secret()).update(body).digest("base64url");
  if (sig.length !== expect.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try { const p = JSON.parse(Buffer.from(body, "base64url").toString()); if (!p.exp || p.exp < Date.now() / 1000) return null; return p; } catch { return null; }
}
/** Magic link у кабінет для людини з Hub (бот, картка людини): одноразовий, 48 годин. */
export function magicLinkFor(personId: number, page = "cabinet.html") {
  const token = signToken({ t: "magic", p: personId }, MAGIC_TTL_SEC);
  return `${onboardingUrl() || appUrl() + "/app"}/${page}?auth_token=${token}`;
}
export const sessionTokenFor = (accountId: number) => signToken({ t: "session", a: accountId }, SESSION_TTL_SEC);
export function bearer(req: Request) { const h = req.headers.get("authorization") ?? ""; return h.startsWith("Bearer ") ? h.slice(7).trim() : null; }

// ---------- контакти ----------
export function normalizeContact(c: string) {
  const s = String(c ?? "").trim().toLowerCase().replace(/^https?:\/\/t\.me\//, "").replace(/^@/, "");
  if (s.includes("@")) return s; // email
  const digits = s.replace(/[\s\-()+.]/g, "");
  if (/^\d{9,15}$/.test(digits)) return digits.slice(-9); // телефон: національна частина
  return s.replace(/[\s\-()+.]/g, "");
}

// ---------- акаунти ----------
export async function accountById(id: number) { const [a] = await db().select().from(onboardingAccounts).where(eq(onboardingAccounts.id, id)); return a ?? null; }
export async function accountForPerson(personId: number) { const [a] = await db().select().from(onboardingAccounts).where(eq(onboardingAccounts.personId, personId)); return a ?? null; }
export async function accountByLinkCode(code: string) { const [a] = await db().select().from(onboardingAccounts).where(eq(onboardingAccounts.linkCode, code)); return a ?? null; }
export async function accountBySession(req: Request) {
  const p = verifyToken<{ t: string; a: number }>(bearer(req));
  if (!p || p.t !== "session" || !p.a) return null;
  const a = await accountById(Number(p.a));
  if (a) await db().update(onboardingAccounts).set({ lastSeenAt: new Date() }).where(eq(onboardingAccounts.id, a.id)).catch(() => null);
  return a;
}
const newLinkCode = () => randomBytes(9).toString("base64url");

/** Реєстрація з форми платформи. Контакт унікальний: повторна реєстрація повертає помилку, якщо є пароль. */
export async function registerAccount(input: { name: string; contact: string; password?: string; source?: string; utm?: Record<string, string> }) {
  const d = db(); const norm = normalizeContact(input.contact);
  if (!input.name.trim() || !norm) return { ok: false as const, error: "Вкажіть ім'я та контакт" };
  const [exists] = await d.select().from(onboardingAccounts).where(eq(onboardingAccounts.contactNorm, norm));
  if (exists) return { ok: false as const, error: "account_exists", account: exists };
  const now = new Date();
  const [a] = await d.insert(onboardingAccounts).values({ name: input.name.trim().slice(0, 120), contact: input.contact.trim().slice(0, 120), contactNorm: norm, passwordHash: input.password ? hashPassword(input.password) : null, linkCode: newLinkCode(), source: input.source ?? "web", utm: input.utm ?? {}, trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY), tags: ["onboarding_registered"], lastSeenAt: now }).returning();
  await logEvent(a, "onboarding_registered", { contact: input.contact, source: input.source ?? "web", via: "web" });
  return { ok: true as const, account: a };
}
export async function loginAccount(contact: string, password: string) {
  const norm = normalizeContact(contact);
  const [a] = norm ? await db().select().from(onboardingAccounts).where(eq(onboardingAccounts.contactNorm, norm)) : [];
  if (!a) return { ok: false as const, error: "not_found" };
  if (a.passwordHash && !verifyPassword(password, a.passwordHash)) return { ok: false as const, error: "bad_password" };
  if (!a.passwordHash && password) await db().update(onboardingAccounts).set({ passwordHash: hashPassword(password) }).where(eq(onboardingAccounts.id, a.id)); // старий акаунт без пароля: перший вхід задає його
  return { ok: true as const, account: a };
}
/** Вхід за magic link з бота: акаунт для людини Hub створюється або знаходиться, Telegram одразу підтверджений. */
export async function magicLogin(token: string) {
  const p = verifyToken<{ t: string; p: number }>(token);
  if (!p || p.t !== "magic" || !p.p) return { ok: false as const, error: "invalid_token" };
  const d = db();
  const [used] = await d.select({ id: events.id }).from(events).where(and(eq(events.type, "onboarding.magic_used"), sql`${events.payload}->>'jti' = ${p.jti}`)).limit(1);
  if (used) return { ok: false as const, error: "token_used" };
  const [person] = await d.select().from(persons).where(eq(persons.id, Number(p.p)));
  if (!person) return { ok: false as const, error: "unknown_person" };
  const a = await ensureAccountForPerson(person, "magic");
  await d.insert(events).values({ personId: person.id, type: "onboarding.magic_used", source: "onboarding", payload: { jti: p.jti, account_id: a.id } });
  return { ok: true as const, account: a };
}
/** Акаунт для людини Hub (бот, magic link, картка): створює з ім'ям і @username, Telegram підтверджено. */
export async function ensureAccountForPerson(person: typeof persons.$inferSelect, source: string) {
  const d = db(); const cur = await accountForPerson(person.id); if (cur) return cur;
  const now = new Date();
  const [a] = await d.insert(onboardingAccounts).values({ personId: person.id, name: [person.firstName, person.lastName].filter(Boolean).join(" ") || person.username || null, contact: person.username ? "@" + person.username : person.phone ?? null, contactNorm: person.username ? person.username.toLowerCase() : person.phone ? normalizeContact(person.phone) : null, linkCode: newLinkCode(), source, trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY), tags: ["onboarding_registered"], confirmedAt: now, lastSeenAt: now }).returning();
  await addPersonTags(person.id, ["onboarding_registered"]);
  await logEvent(a, "onboarding_registered", { via: source });
  return a;
}
/** Deep link з confirm.html: ob_<code> → акаунт прив'язується до людини, яка натиснула /start у Hub-боті. */
export async function linkAccountToPerson(code: string, personId: number) {
  const d = db(); const a = await accountByLinkCode(code); if (!a) return { ok: false as const, error: "unknown_code" };
  if (a.personId && a.personId !== personId) return { ok: false as const, error: "linked_to_other" };
  const other = await accountForPerson(personId);
  let acc = a;
  if (other && other.id !== a.id) {
    // у людини вже є акаунт (напр., з magic link): переносимо дані вебреєстрації в нього, старий лишаємо без person
    const merged = { name: other.name ?? a.name, contact: other.contact ?? a.contact, contactNorm: other.contactNorm ?? a.contactNorm, passwordHash: other.passwordHash ?? a.passwordHash, tags: [...new Set([...(other.tags ?? []), ...(a.tags ?? [])])], quizResultId: other.quizResultId ?? a.quizResultId, quizScenario: other.quizScenario ?? a.quizScenario, quiz: Object.keys(other.quiz ?? {}).length ? other.quiz : a.quiz, quizCompletedAt: other.quizCompletedAt ?? a.quizCompletedAt, feedback: other.feedback ?? a.feedback, feedbackAt: other.feedbackAt ?? a.feedbackAt, extensionCount: Math.max(other.extensionCount, a.extensionCount), trialEndsAt: other.trialEndsAt > a.trialEndsAt ? other.trialEndsAt : a.trialEndsAt, confirmedAt: other.confirmedAt ?? new Date(), updatedAt: new Date() };
    [acc] = await d.update(onboardingAccounts).set(merged).where(eq(onboardingAccounts.id, other.id)).returning();
    await d.update(onboardingAccounts).set({ contactNorm: null, updatedAt: new Date() }).where(eq(onboardingAccounts.id, a.id));
  } else {
    [acc] = await d.update(onboardingAccounts).set({ personId, confirmedAt: a.confirmedAt ?? new Date(), updatedAt: new Date() }).where(eq(onboardingAccounts.id, a.id)).returning();
  }
  await addPersonTags(personId, acc.tags ?? []);
  await logEvent(acc, "telegram_confirmed", { via: "bot_start", link_code: code });
  if (acc.quizResultId && !acc.shchyroSyncedAt) await bridgeQuizToShchyro(acc).catch(() => null);
  return { ok: true as const, account: acc };
}

// ---------- теги й події ----------
async function addPersonTags(personId: number | null, tags: string[]) {
  if (!personId || !tags.length) return;
  await db().update(persons).set({ tags: sql`(select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements(${persons.tags} || ${JSON.stringify(tags)}::jsonb) x)`, updatedAt: new Date() }).where(eq(persons.id, personId));
}
async function addAccountTags(a: Account, tags: string[]) {
  const next = [...new Set([...(a.tags ?? []), ...tags])];
  if (next.length === (a.tags ?? []).length) return a;
  const [u] = await db().update(onboardingAccounts).set({ tags: next, updatedAt: new Date() }).where(eq(onboardingAccounts.id, a.id)).returning();
  await addPersonTags(a.personId, tags);
  return u;
}
async function logEvent(a: Account, type: string, payload: Record<string, unknown>) {
  await db().insert(events).values({ personId: a.personId, type: `onboarding.${type}`, source: "onboarding", payload: { ...payload, account_id: a.id } }).catch(() => null);
}

export type TrackInput = { event_type: string; tag?: string | null; page?: string | null; payload?: Record<string, unknown> };
/** Подія з платформи: тег у картку, запис в історію, оновлення стану акаунта за типом події. */
export async function trackEvent(acc: Account, input: TrackInput) {
  const d = db(); const now = new Date();
  const type = String(input.event_type ?? "").replace(/[^a-z0-9_]/gi, "").slice(0, 48);
  if (!type) return { ok: false as const, error: "event_type required" };
  const videoMatch = type.match(/^video_lesson_(\d{1,2})_opened$/);
  if (!(type in EVENT_TAGS) && !videoMatch) return { ok: false as const, error: `unknown event_type ${type}` };
  const payload = (input.payload ?? {}) as Record<string, unknown>;
  const tags: string[] = [];
  const matrixTag = videoMatch ? type : EVENT_TAGS[type];
  if (matrixTag) tags.push(matrixTag);
  const patch: Partial<typeof onboardingAccounts.$inferInsert> = { lastSeenAt: now, updatedAt: now };

  if (type === "quiz_started" && !acc.quizStartedAt) patch.quizStartedAt = now;
  if (type === "quiz_completed") {
    const rid = Number(payload.quiz_result_id ?? payload.resultId ?? 0);
    const sc = SCENARIOS[rid];
    if (sc) { tags.push(sc.tag); patch.quizResultId = rid; patch.quizScenario = String(payload.scenario_name ?? sc.name).replace(/<[^>]+>/g, "").slice(0, 120); patch.quiz = { answers: (payload.answers as Record<string, unknown>) ?? {}, scores: (payload.scores as Record<string, number>) ?? {} }; patch.quizCompletedAt = now; patch.quizStartedAt = acc.quizStartedAt ?? now; patch.shchyroSyncedAt = null; }
  }
  if (type === "deep_quiz_test_completed" || type === "deep_quiz_completed") {
    const dq = { ...(acc.deepQuiz ?? {}) } as schema.OnboardingDeepQuiz;
    if (payload.test1) dq.test1 = payload.test1 as schema.OnboardingDeepQuiz["test1"]; if (payload.test2) dq.test2 = payload.test2 as schema.OnboardingDeepQuiz["test2"];
    dq.completed = Boolean(dq.test1 && dq.test2) || type === "deep_quiz_completed";
    patch.deepQuiz = dq; if (dq.completed) { patch.deepQuizCompletedAt = acc.deepQuizCompletedAt ?? now; if (!tags.includes("deep_quiz_completed")) tags.push("deep_quiz_completed"); }
  }
  if (type === "diagnostic_completed") patch.diagnosticCompletedAt = acc.diagnosticCompletedAt ?? now;
  if (input.tag && /^[a-z0-9_]{2,48}$/.test(input.tag) && !tags.includes(input.tag)) tags.push(input.tag); // явний тег із запиту (у межах формату)

  let updated = acc;
  if (Object.keys(patch).length > 2) [updated] = await d.update(onboardingAccounts).set(patch).where(eq(onboardingAccounts.id, acc.id)).returning();
  updated = await addAccountTags(updated, tags);
  await logEvent(updated, type, { tag: tags[0] ?? null, page: input.page ?? null, ...sanitize(payload) });
  if (type === "quiz_completed" && updated.personId) await bridgeQuizToShchyro(updated).catch(() => null);
  return { ok: true as const, account: updated, tag_added: tags[0] ?? null, tags_added: tags, active_tags_count: (updated.tags ?? []).length };
}
const sanitize = (p: Record<string, unknown>) => Object.fromEntries(Object.entries(p).filter(([k]) => !["answers", "password"].includes(k)).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 500) : v]));

/** Анкета зворотного зв'язку: зберегти, тег, +7 днів один раз (ТЗ 4.3, рядки 8 і 11.3). */
export async function submitFeedback(acc: Account, answers: Record<string, unknown>) {
  const d = db(); const now = new Date();
  const extend = acc.extensionCount === 0;
  const base = acc.trialEndsAt > now ? acc.trialEndsAt : now;
  const [u] = await d.update(onboardingAccounts).set({ feedback: answers, feedbackAt: now, lastSeenAt: now, updatedAt: now, ...(extend ? { trialEndsAt: new Date(base.getTime() + EXTENSION_DAYS * DAY), extensionCount: 1 } : {}) }).where(eq(onboardingAccounts.id, acc.id)).returning();
  const tagged = await addAccountTags(u, extend ? ["feedback_completed", "trial_extended_7_days"] : ["feedback_completed"]);
  await logEvent(tagged, "feedback_completed", { answers: sanitizeFeedback(answers), extended: extend });
  if (extend) await logEvent(tagged, "trial_extended_7_days", { until: tagged.trialEndsAt });
  return { ok: true as const, account: tagged, extended: extend };
}
const sanitizeFeedback = (a: Record<string, unknown>) => Object.fromEntries(Object.entries(a).slice(0, 20).map(([k, v]) => [k.slice(0, 40), typeof v === "string" ? v.slice(0, 1000) : v]));

/** Міст у пам'ять «Щиро» (ТЗ, розділ 5): результат квізу → картка клієнтки, щоб бот знав ситуацію з першого повідомлення. */
export async function bridgeQuizToShchyro(acc: Account) {
  if (!shchyroConfigured() || !acc.personId || !acc.quizResultId) return { ok: false as const, reason: "not_applicable" };
  const [p] = await db().select().from(persons).where(eq(persons.id, acc.personId)); if (!p) return { ok: false as const, reason: "no_person" };
  const sc = SCENARIOS[acc.quizResultId]; if (!sc) return { ok: false as const, reason: "no_scenario" };
  const deep = acc.deepQuiz ?? {}; const parts = [`Клієнтка пройшла онбординг на платформі. Основний вектор кризи: «${sc.name}» (сценарій ${acc.quizResultId}). Головні складнощі: ${sc.summary}.`];
  if (deep.test1) parts.push(`Психоемоційний ресурс (тест 02): категорія ${deep.test1.category} з 3, бал ${deep.test1.score}.`);
  if (deep.test2) parts.push(`Кордони та безпека в парі (тест 03): категорія ${deep.test2.category} з 3${deep.test2.hasCriticalRedFlag ? ", є критичний маркер небезпеки" : ""}.`);
  const r = await shchyroRequestPublic("POST", `/api/v1/hub/clients/${p.telegramUserId}/onboarding`, { summary_text: parts.join(" "), data: { quiz_result: acc.quizResultId, crisis: sc.name, scores: acc.quiz?.scores ?? {}, deep_quiz: deep, source: "onboarding_platform", synced_at: new Date().toISOString() }, first_name: p.firstName ?? acc.name, username: p.username, source: "onboarding" });
  if (r.ok) await db().update(onboardingAccounts).set({ shchyroSyncedAt: new Date(), updatedAt: new Date() }).where(eq(onboardingAccounts.id, acc.id));
  await db().insert(events).values({ personId: acc.personId, type: r.ok ? "onboarding.shchyro_synced" : "onboarding.shchyro_sync_failed", source: "onboarding", payload: r.ok ? { scenario: sc.name } : { error: r.error } }).catch(() => null);
  return r.ok ? { ok: true as const } : { ok: false as const, reason: r.error };
}

/** Профіль для кабінету (відповідь magic-login / user/profile за ТЗ 4.1). */
export async function profilePayload(acc: Account) {
  const d = db();
  const [p] = acc.personId ? await d.select().from(persons).where(eq(persons.id, acc.personId)) : [];
  const grace = await accessGraceHours();
  // підписки людини: кабінет відкритий, поки хоч одна дає доступ за єдиним правилом (активна або грейс після кінця періоду)
  const subs = acc.personId ? await d.select({ s: schema.subscriptions, planName: schema.plans.name }).from(schema.subscriptions).leftJoin(schema.plans, eq(schema.plans.id, schema.subscriptions.planId)).where(eq(schema.subscriptions.personId, acc.personId)).orderBy(desc(schema.subscriptions.updatedAt)) : [];
  const sub = subs.find((x) => subscriptionAllows(x.s, grace)) ?? subs[0];
  const live = Boolean(sub && subscriptionAllows(sub.s, grace));
  const subEnd = sub ? accessEnd(sub.s, grace) : null;
  const now = Date.now(); const ends = acc.trialEndsAt.getTime();
  const botUser = (await d.select({ u: schema.bots.username }).from(schema.bots).where(eq(schema.bots.key, "hub")))[0]?.u ?? null;
  return {
    account_id: acc.id, user_id: p?.telegramUserId ?? null, telegram_linked: Boolean(acc.personId), telegram_link: botUser ? `https://t.me/${botUser}?start=ob_${acc.linkCode}` : null,
    first_name: acc.name ?? p?.firstName ?? null, name: acc.name ?? ([p?.firstName, p?.lastName].filter(Boolean).join(" ") || null), telegram_username: p?.username ?? null, contact: acc.contact,
    subscription_status: sub ? sub.s.status : "none", subscription_plan: live ? sub!.planName ?? (sub!.s.source === "zenedu" ? "Клуб (ZenEdu)" : "Підписка Hub") : null, subscription_until: live && sub!.s.currentPeriodEnd ? sub!.s.currentPeriodEnd.toISOString() : null,
    // доступ до кабінету: за підпискою безстроково (поки вона діє, з грейсом), інакше тріал 14 + 7 днів; колишня учасниця без тріалу бачить «доступ завершено»
    access_mode: live ? "subscription" : sub ? "subscription_ended" : "trial",
    access_until: live ? (sub!.s.currentPeriodEnd ? subEnd!.toISOString() : null) : acc.trialEndsAt.toISOString(),
    access_active: live || ends > now,
    subscription_ended_at: !live && sub ? (subEnd ?? sub.s.currentPeriodEnd)?.toISOString() ?? null : null,
    registered_at: acc.registeredAt.toISOString(), registration_time: acc.registeredAt.getTime(), trial_expires_at: acc.trialEndsAt.toISOString(), extended_end_time: ends, extension_count: acc.extensionCount,
    trial_state: live ? "subscription" : ends > now ? (ends - now < 72 * 3600_000 ? "expiring_soon" : "active") : acc.extensionCount > 0 ? "fully_expired" : "expired_14",
    quiz_completed: Boolean(acc.quizCompletedAt), quiz_result_id: acc.quizResultId, quiz_scenario: acc.quizScenario, quiz: acc.quiz ?? {}, deep_quiz: acc.deepQuiz ?? {}, diagnostic_completed: Boolean(acc.diagnosticCompletedAt),
    feedback_completed: Boolean(acc.feedbackAt), feedback: acc.feedback ?? null, feedback_at: acc.feedbackAt?.toISOString() ?? null, tags: acc.tags ?? [],
    shchyro_url: "https://t.me/m_kravchuk_ai_bot",
  };
}

// ---------- щоденний крон: стани тріалу (ТЗ, рядки 11.1–11.4) ----------
export async function onboardingDaily() {
  const d = db(); const now = new Date(); const soon = new Date(now.getTime() + 72 * 3600_000); const grace = await accessGraceHours();
  let expiring = 0, expired14 = 0, expiredFinal = 0;
  const rows = await d.select().from(onboardingAccounts).where(or(and(gt(onboardingAccounts.trialEndsAt, now), lte(onboardingAccounts.trialEndsAt, soon)), lt(onboardingAccounts.trialEndsAt, now)));
  for (const a of rows) {
    const tags = a.tags ?? [];
    if (a.personId) { // учасниця з підпискою: тріал не має значення, теги станів тріалу не ставимо
      const subs = await d.select({ status: schema.subscriptions.status, currentPeriodEnd: schema.subscriptions.currentPeriodEnd }).from(schema.subscriptions).where(eq(schema.subscriptions.personId, a.personId));
      if (subs.some((x) => subscriptionAllows(x, grace, now))) continue;
    }
    if (a.trialEndsAt > now) { if (!tags.includes("trial_expiring_soon")) { await trackEvent(a, { event_type: "trial_expiring_soon", payload: { days: 3, by: "cron" } }); expiring++; } continue; }
    if (a.extensionCount > 0) { if (!tags.includes("trial_fully_expired")) { await trackEvent(a, { event_type: "trial_fully_expired", payload: { by: "cron" } }); expiredFinal++; } }
    else if (!tags.includes("trial_14_expired")) { await trackEvent(a, { event_type: "trial_14_expired", payload: { by: "cron" } }); expired14++; }
  }
  return { checked: rows.length, expiring, expired14, expiredFinal };
}

// ---------- для панелі Hub ----------
export type OnboardingStats = { total: number; confirmed: number; linked: number; quiz: number; deep: number; diagnostic: number; feedback: number; trial_active: number; expiring: number; expired: number; new7: number; shchyro: number; cta_club: number; cta_schyro: number; byScenario: { id: number; name: string; c: number }[] };
export async function onboardingStats(): Promise<OnboardingStats> {
  const d = db();
  const [r] = (await d.execute(sql`select count(*)::int as total, count(*) filter (where confirmed_at is not null)::int as confirmed, count(*) filter (where person_id is not null)::int as linked,
    count(*) filter (where quiz_completed_at is not null)::int as quiz, count(*) filter (where deep_quiz_completed_at is not null)::int as deep, count(*) filter (where diagnostic_completed_at is not null)::int as diagnostic,
    count(*) filter (where feedback_at is not null)::int as feedback, count(*) filter (where trial_ends_at > now())::int as trial_active, count(*) filter (where trial_ends_at > now() and trial_ends_at <= now() + interval '3 days')::int as expiring,
    count(*) filter (where trial_ends_at <= now())::int as expired, count(*) filter (where registered_at >= now() - interval '7 days')::int as new7, count(*) filter (where shchyro_synced_at is not null)::int as shchyro,
    count(*) filter (where tags ? 'cta_club_clicked')::int as cta_club, count(*) filter (where tags ? 'cta_schyro_clicked')::int as cta_schyro from onboarding_accounts`)).rows as Record<string, number>[];
  const byScenario = (await d.select({ id: onboardingAccounts.quizResultId, c: sql<number>`count(*)::int` }).from(onboardingAccounts).where(isNotNull(onboardingAccounts.quizResultId)).groupBy(onboardingAccounts.quizResultId)).map((x) => ({ id: x.id!, name: SCENARIOS[x.id!]?.name ?? String(x.id), c: x.c }));
  return { ...(r as Omit<OnboardingStats, "byScenario">), byScenario };
}
export type ObFilter = { q?: string; scenario?: number; state?: string; page?: number };
export async function onboardingList(f: ObFilter) {
  const d = db(); const per = 50; const page = Math.max(1, f.page ?? 1); const conds = [];
  if (f.q) { const q = `%${f.q.trim()}%`; conds.push(or(sql`${onboardingAccounts.name} ilike ${q}`, sql`${onboardingAccounts.contact} ilike ${q}`, sql`exists (select 1 from persons p where p.id = ${onboardingAccounts.personId} and (p.username ilike ${q} or p.telegram_user_id::text = ${f.q.trim()}))`)); }
  if (f.scenario) conds.push(eq(onboardingAccounts.quizResultId, f.scenario));
  if (f.state === "active") conds.push(gt(onboardingAccounts.trialEndsAt, new Date()));
  else if (f.state === "expiring") conds.push(and(gt(onboardingAccounts.trialEndsAt, new Date()), lte(onboardingAccounts.trialEndsAt, new Date(Date.now() + 3 * DAY))));
  else if (f.state === "expired") conds.push(lte(onboardingAccounts.trialEndsAt, new Date()));
  else if (f.state === "unlinked") conds.push(isNull(onboardingAccounts.personId));
  else if (f.state === "noquiz") conds.push(isNull(onboardingAccounts.quizCompletedAt));
  const where = conds.length ? and(...conds) : undefined;
  const rows = await d.select({ a: onboardingAccounts, p: { id: persons.id, firstName: persons.firstName, lastName: persons.lastName, username: persons.username, telegramUserId: persons.telegramUserId } }).from(onboardingAccounts).leftJoin(persons, eq(persons.id, onboardingAccounts.personId)).where(where).orderBy(desc(onboardingAccounts.lastSeenAt), desc(onboardingAccounts.id)).limit(per).offset((page - 1) * per);
  const [t] = await d.select({ c: sql<number>`count(*)::int` }).from(onboardingAccounts).where(where);
  return { rows, total: t.c, page, per };
}
/** Чи є в людини Hub-бот (куди надіслати magic link). */
export async function hubChatFor(personId: number) { const [i] = await db().select().from(identities).where(and(eq(identities.personId, personId), eq(identities.botKey, "hub"))); return i && !i.blockedAt ? i : null; }
