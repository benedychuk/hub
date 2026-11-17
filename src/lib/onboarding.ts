import { and, desc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { db, schema } from "@/db";
import { appUrl, botToken } from "./bot";
import { shchyroConfigured, shchyroRequestPublic } from "./shchyro";
import { accessGraceHours, subscriptionAllowsSql } from "./access-rule";
import { SHCHYRO_BOT_URL } from "./shchyro";
import { clubAccess, clubMemberSql } from "./club";

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

const { onboardingAccounts, persons, events, identities } = schema; // settings — через schema.settings (коди входу через бота)
export type Account = typeof onboardingAccounts.$inferSelect;

// Пробного періоду кабінету немає: доступ до платформи дає лише чинна підписка клубу (lib/club). Поле trial_ends_at у базі лишається заради сумісності, не використовується.
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
  // пробного періоду більше немає: старі події тріалу приймаються (сумісність), але тегів не ставлять
  trial_expiring_soon: null, trial_14_expired: null, trial_extended_7_days: null, trial_fully_expired: null,
  cabinet_opened: null, telegram_confirmed: "onboarding_registered",
};
export const TAG_LABELS: Record<string, string> = {
  onboarding_registered: "зареєструвалась у кабінеті", quiz_started: "почала квіз", quiz_completed: "пройшла квіз", deep_quiz_completed: "пройшла глибинний тест", diagnostic_completed: "пройшла діагностику",
  feedback_completed: "заповнила анкету", cta_club_clicked: "цікавилась клубом", cta_schyro_clicked: "відкривала «Щиро»",
  crisis_acute: "Гостра криза", crisis_lost_boundaries: "Втрата себе і кордони", crisis_emotional_cold: "Емоційний холод",
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
/** Сесія кабінету (30 днів). telegram: вхід підтвердив Telegram — позначка tv лишається для сумісності. */
export const sessionTokenFor = (accountId: number, opts: { telegram?: boolean } = {}) =>
  signToken({ t: "session", a: accountId, ...(opts.telegram ? { tv: Math.floor(Date.now() / 1000) } : {}) }, SESSION_TTL_SEC);
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
export async function accountBySession(req: Request) { return (await sessionFrom(req))?.account ?? null; }
/** Сесія з токена: кабінет. */
export async function sessionFrom(req: Request) {
  const p = verifyToken<{ t: string; a: number; tv?: number }>(bearer(req));
  if (!p || p.t !== "session" || !p.a) return null;
  const a = await accountById(Number(p.a));
  if (!a) return null;
  await db().update(onboardingAccounts).set({ lastSeenAt: new Date() }).where(eq(onboardingAccounts.id, a.id)).catch(() => null);
  return { account: a };
}
const newLinkCode = () => randomBytes(9).toString("base64url");

/** Реєстрація з форми платформи (ім'я й контакт; паролів немає — далі людина підтверджує Telegram). Контакт унікальний: повторно — account_exists, вхід через Telegram. */
export async function registerAccount(input: { name: string; contact: string; source?: string; utm?: Record<string, string> }) {
  const d = db(); const norm = normalizeContact(input.contact);
  if (!input.name.trim() || !norm) return { ok: false as const, error: "Вкажіть ім'я та контакт" };
  const [exists] = await d.select().from(onboardingAccounts).where(eq(onboardingAccounts.contactNorm, norm));
  if (exists) return { ok: false as const, error: "account_exists", account: exists };
  const now = new Date();
  const [a] = await d.insert(onboardingAccounts).values({ name: input.name.trim().slice(0, 120), contact: input.contact.trim().slice(0, 120), contactNorm: norm, linkCode: newLinkCode(), source: input.source ?? "web", utm: input.utm ?? {}, trialEndsAt: now, tags: ["onboarding_registered"], lastSeenAt: now }).returning();
  await logEvent(a, "onboarding_registered", { contact: input.contact, source: input.source ?? "web", via: "web" });
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
/**
 * Вхід через Telegram Login Widget на платформі: Telegram підписує дані людини ключем бота (SHA-256 від токена).
 * Перевіряємо підпис і свіжість, знаходимо людину за Telegram ID (учасниці ZenEdu вже є з імпорту) і її кабінет;
 * якщо кабінету ще немає — створюємо. Паролів немає: це єдиний спосіб входу (разом із кнопкою в боті й Mini App).
 */
export function verifyTelegramLogin(data: Record<string, string | number | undefined>, maxAgeSec = 24 * 3600) {
  const hash = String(data.hash ?? ""); if (!hash || !process.env.TELEGRAM_BOT_TOKEN) return null;
  const check = Object.keys(data).filter((k) => k !== "hash" && data[k] !== undefined && data[k] !== null && data[k] !== "").sort().map((k) => `${k}=${data[k]}`).join("\n");
  const key = createHash("sha256").update(botToken()).digest();
  const calc = createHmac("sha256", key).update(check).digest("hex");
  if (calc.length !== hash.length || !timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  const authDate = Number(data.auth_date ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  const id = Number(data.id); if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { id, first_name: data.first_name ? String(data.first_name) : undefined, last_name: data.last_name ? String(data.last_name) : undefined, username: data.username ? String(data.username) : undefined };
}
export async function telegramLogin(data: Record<string, string | number | undefined>) {
  const u = verifyTelegramLogin(data); if (!u) return { ok: false as const, error: "bad_signature" };
  return loginByTelegramUser(u, "telegram_login");
}
/** Кабінет людини за перевіреним Telegram-користувачем (віджет, бот, Mini App): знаходимо або створюємо. */
export async function loginByTelegramUser(u: { id: number; first_name?: string; last_name?: string; username?: string }, via: string) {
  const d = db();
  const [p] = await d.insert(persons).values({ telegramUserId: u.id, firstName: u.first_name ?? null, lastName: u.last_name ?? null, username: u.username ?? null, lastActiveAt: new Date() })
    .onConflictDoUpdate({ target: persons.telegramUserId, set: { lastActiveAt: new Date(), updatedAt: new Date() } }).returning();
  const a = (await accountForPerson(p.id)) ?? await ensureAccountForPerson(p, "telegram");
  await logEvent(a, "cabinet_opened", { via });
  return { ok: true as const, account: a };
}

/**
 * Вхід у кабінет в один дотик через Hub-бота (замість Telegram Login Widget).
 * 1) сайт: POST auth/telegram-bot/start → одноразовий код (5 хв, 192 біти) і посилання t.me/<бот>?start=login_<код>;
 * 2) бот: /start login_<код> → «Підтвердіть вхід у кабінет на сайті» з кнопкою; лише натискання кнопки підтверджує вхід
 *    (простий Start не підтверджує: інакше чужий код, підсунутий людині, відкрив би її кабінет у чужому браузері);
 * 3) сайт опитує GET auth/telegram-bot/status?code= → після підтвердження отримує session_token один раз.
 * Стан коду — у settings (ключ tglogin:<код>), прострочені прибираються.
 */
const BOT_LOGIN_TTL_MS = 5 * 60_000;
type BotLogin = { status: "pending" | "confirmed" | "used"; next: string; exp: number; accountId?: number };
const loginKey = (code: string) => `tglogin:${code}`;
const okCode = (c: string) => /^[A-Za-z0-9_-]{20,60}$/.test(c);
const safeNext = (n: unknown) => typeof n === "string" && /^[a-z0-9_-]+\.html$/i.test(n) ? n : "cabinet.html";
export async function botLoginStart(next?: string) {
  const d = db();
  await d.delete(schema.settings).where(and(sql`${schema.settings.key} like 'tglogin:%'`, lt(schema.settings.updatedAt, new Date(Date.now() - 3600_000))));
  const code = randomBytes(24).toString("base64url");
  await d.insert(schema.settings).values({ key: loginKey(code), value: { status: "pending", next: safeNext(next), exp: Date.now() + BOT_LOGIN_TTL_MS } satisfies BotLogin });
  return { code, expiresIn: BOT_LOGIN_TTL_MS / 1000 };
}
async function readBotLogin(code: string) {
  if (!okCode(code)) return null;
  const [row] = await db().select().from(schema.settings).where(eq(schema.settings.key, loginKey(code)));
  return (row?.value as BotLogin | undefined) ?? null;
}
/** Бот: чи код ще чекає підтвердження (для повідомлення з кнопкою). */
export async function botLoginPending(code: string) { const v = await readBotLogin(code); return Boolean(v && v.status === "pending" && v.exp > Date.now()); }
/** Бот: людина натиснула «Так, це я входжу» — прив'язуємо кабінет до коду. Повертає next для кнопки «Відкрити кабінет». */
export async function botLoginConfirm(code: string, u: { id: number; first_name?: string; last_name?: string; username?: string }) {
  const v = await readBotLogin(code);
  if (!v || v.status !== "pending" || v.exp < Date.now()) return { ok: false as const, error: "expired" };
  const r = await loginByTelegramUser(u, "telegram_bot");
  await db().update(schema.settings).set({ value: { ...v, status: "confirmed", accountId: r.account.id }, updatedAt: new Date() }).where(eq(schema.settings.key, loginKey(code)));
  return { ok: true as const, next: v.next, personId: r.account.personId };
}
/** Сайт: стан коду; після підтвердження один раз віддає сесію (далі код — used). */
export async function botLoginStatus(code: string) {
  const v = await readBotLogin(code);
  if (!v) return { status: "expired" as const };
  if (v.status === "pending") return v.exp > Date.now() ? { status: "pending" as const } : { status: "expired" as const };
  if (v.status === "used" || !v.accountId) return { status: "expired" as const };
  const a = await accountById(v.accountId); if (!a) return { status: "expired" as const };
  await db().update(schema.settings).set({ value: { ...v, status: "used" }, updatedAt: new Date() }).where(eq(schema.settings.key, loginKey(code)));
  return { status: "confirmed" as const, account: a };
}

/**
 * Кабінети всім учасницям клубу, в яких їх ще немає: чинна підписка ZenEdu або чинна бойова підписка Hub на оффер клубу
 * (відкриває канал чи групу). Мовчки: без повідомлень, тегів і подій матриці. Вхід — лише через Telegram.
 * Контакт @username; якщо такий контакт уже має інший кабінет — без контакту для входу (щоб вхід за контактом не плутав людей).
 */
export async function clubMembersWithoutCabinet(limit = 5000) {
  const grace = await accessGraceHours();
  return (await db().execute(sql`
    select p.id, p.first_name, p.last_name, p.username, p.phone from persons p
    where not exists (select 1 from onboarding_accounts oa where oa.person_id = p.id)
      and exists (select 1 from subscriptions s where s.person_id = p.id and ${sql.raw(subscriptionAllowsSql("s", grace))}
        and (s.source = 'zenedu' or (s.source = 'hub'
          and exists (select 1 from payment_attempts pa where pa.subscription_id = s.id and pa.mode = 'live' and pa.status = 'approved')
          and exists (select 1 from plans pl, resources r where pl.id = s.plan_id and r.kind in ('telegram_channel','telegram_group') and pl.entitlements ? r.key))))
    order by p.id limit ${limit}`)).rows as { id: number; first_name: string | null; last_name: string | null; username: string | null; phone: string | null }[];
}
export async function createClubCabinets(limit = 5000) {
  const d = db(); const rows = await clubMembersWithoutCabinet(limit); const now = new Date();
  let created = 0, noContact = 0;
  for (const p of rows) {
    const contact = p.username ? "@" + p.username : p.phone ?? null;
    let norm = p.username ? p.username.toLowerCase() : p.phone ? normalizeContact(p.phone) : null;
    if (norm) { const [taken] = await d.select({ id: onboardingAccounts.id }).from(onboardingAccounts).where(eq(onboardingAccounts.contactNorm, norm)).limit(1); if (taken) norm = null; }
    if (!norm) noContact++;
    const ins = await d.insert(onboardingAccounts).values({ personId: p.id, name: [p.first_name, p.last_name].filter(Boolean).join(" ") || p.username || null, contact, contactNorm: norm, linkCode: newLinkCode(), source: "club", trialEndsAt: now, tags: [], confirmedAt: now }).onConflictDoNothing().returning({ id: onboardingAccounts.id });
    created += ins.length;
  }
  return { created, noContact };
}

/** Акаунт для людини Hub (бот, magic link, картка): створює з ім'ям і @username, Telegram підтверджено. */
export async function ensureAccountForPerson(person: typeof persons.$inferSelect, source: string) {
  const d = db(); const cur = await accountForPerson(person.id); if (cur) return cur;
  const now = new Date();
  const [a] = await d.insert(onboardingAccounts).values({ personId: person.id, name: [person.firstName, person.lastName].filter(Boolean).join(" ") || person.username || null, contact: person.username ? "@" + person.username : person.phone ?? null, contactNorm: person.username ? person.username.toLowerCase() : person.phone ? normalizeContact(person.phone) : null, linkCode: newLinkCode(), source, trialEndsAt: now, tags: ["onboarding_registered"], confirmedAt: now, lastSeenAt: now }).returning();
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

/** Анкета зворотного зв'язку: зберегти й поставити тег. Бонусу днів немає — доступ дає лише підписка клубу. */
export async function submitFeedback(acc: Account, answers: Record<string, unknown>) {
  const d = db(); const now = new Date();
  const [u] = await d.update(onboardingAccounts).set({ feedback: answers, feedbackAt: now, lastSeenAt: now, updatedAt: now }).where(eq(onboardingAccounts.id, acc.id)).returning();
  const tagged = await addAccountTags(u, ["feedback_completed"]);
  await logEvent(tagged, "feedback_completed", { answers: sanitizeFeedback(answers) });
  return { ok: true as const, account: tagged, extended: false };
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
  // доступ до платформи: єдине правило «учасниця клубу» (lib/club): чинна підписка клубу ZenEdu чи Hub, право на канал клубу або команда
  const club = await clubAccess(acc.personId);
  const live = club.member;
  const botUser = (await d.select({ u: schema.bots.username }).from(schema.bots).where(eq(schema.bots.key, "hub")))[0]?.u ?? null;
  // актуальний етер разом із профілем: банер і сторінка етеру показуються одразу, без окремого запиту (лише учасницям)
  const stream = live ? await import("./streams").then((m) => m.cabinetStream()).catch(() => null) : null;
  return {
    stream,
    account_id: acc.id, user_id: p?.telegramUserId ?? null, telegram_linked: Boolean(acc.personId), telegram_link: botUser ? `https://t.me/${botUser}?start=ob_${acc.linkCode}` : null,
    first_name: acc.name ?? p?.firstName ?? null, name: acc.name ?? ([p?.firstName, p?.lastName].filter(Boolean).join(" ") || null), telegram_username: p?.username ?? null, contact: acc.contact,
    subscription_status: live ? "active" : club.hadClub ? "ended" : "none", subscription_plan: live ? club.plan : null, subscription_until: live && club.until ? club.until.toISOString() : null,
    club_member: live, club_access_via: club.via, // zenedu | hub | grant | team
    // доступ до платформи — лише за чинною підпискою клубу (ZenEdu чи Hub) і поки вона діє; пробного періоду немає.
    // access_mode: subscription — є доступ; subscription_ended — підписка була й закінчилась; no_subscription — підписки клубу не було
    access_mode: live ? "subscription" : club.hadClub ? "subscription_ended" : "no_subscription",
    access_until: live && club.until ? club.until.toISOString() : null,
    access_active: live,
    subscription_ended_at: null,
    registered_at: acc.registeredAt.toISOString(), registration_time: acc.registeredAt.getTime(),
    // сумісність зі старою версією платформи: поля тріалу повторюють доступ за підпискою
    trial_expires_at: live && club.until ? club.until.toISOString() : null, extended_end_time: live && club.until ? club.until.getTime() : null, extension_count: 0,
    trial_state: live ? "subscription" : club.hadClub ? "subscription_ended" : "no_subscription",
    quiz_completed: Boolean(acc.quizCompletedAt), quiz_result_id: acc.quizResultId, quiz_scenario: acc.quizScenario, quiz: acc.quiz ?? {}, deep_quiz: acc.deepQuiz ?? {}, diagnostic_completed: Boolean(acc.diagnosticCompletedAt),
    feedback_completed: Boolean(acc.feedbackAt), feedback: acc.feedback ?? null, feedback_at: acc.feedbackAt?.toISOString() ?? null, tags: acc.tags ?? [],
    shchyro_url: SHCHYRO_BOT_URL,
    // вхід лише через Telegram (рішення 2026-11): паролів немає, форму пароля платформа не показує
    login_method: "telegram", password_set: false, must_set_password: false,
  };
}

// ---------- для панелі Hub ----------
export type OnboardingStats = { total: number; confirmed: number; linked: number; quiz: number; deep: number; diagnostic: number; feedback: number; members: number; no_access: number; new7: number; shchyro: number; cta_club: number; cta_schyro: number; byScenario: { id: number; name: string; c: number }[] };
export async function onboardingStats(): Promise<OnboardingStats> {
  const d = db(); const member = await clubMemberSql("onboarding_accounts.person_id");
  const [r] = (await d.execute(sql`select count(*)::int as total, count(*) filter (where confirmed_at is not null)::int as confirmed, count(*) filter (where person_id is not null)::int as linked,
    count(*) filter (where quiz_completed_at is not null)::int as quiz, count(*) filter (where deep_quiz_completed_at is not null)::int as deep, count(*) filter (where diagnostic_completed_at is not null)::int as diagnostic,
    count(*) filter (where feedback_at is not null)::int as feedback, count(*) filter (where ${member})::int as members, count(*) filter (where not ${member})::int as no_access, count(*) filter (where registered_at >= now() - interval '7 days')::int as new7, count(*) filter (where shchyro_synced_at is not null)::int as shchyro,
    count(*) filter (where tags ? 'cta_club_clicked')::int as cta_club, count(*) filter (where tags ? 'cta_schyro_clicked')::int as cta_schyro from onboarding_accounts`)).rows as Record<string, number>[];
  const byScenario = (await d.select({ id: onboardingAccounts.quizResultId, c: sql<number>`count(*)::int` }).from(onboardingAccounts).where(isNotNull(onboardingAccounts.quizResultId)).groupBy(onboardingAccounts.quizResultId)).map((x) => ({ id: x.id!, name: SCENARIOS[x.id!]?.name ?? String(x.id), c: x.c }));
  return { ...(r as Omit<OnboardingStats, "byScenario">), byScenario };
}
export type ObFilter = { q?: string; scenario?: number; state?: string; page?: number };
export async function onboardingList(f: ObFilter) {
  const d = db(); const per = 50; const page = Math.max(1, f.page ?? 1); const conds = [];
  if (f.q) { const q = `%${f.q.trim()}%`; conds.push(or(sql`${onboardingAccounts.name} ilike ${q}`, sql`${onboardingAccounts.contact} ilike ${q}`, sql`exists (select 1 from persons p where p.id = ${onboardingAccounts.personId} and (p.username ilike ${q} or p.telegram_user_id::text = ${f.q.trim()}))`)); }
  if (f.scenario) conds.push(eq(onboardingAccounts.quizResultId, f.scenario));
  const member = await clubMemberSql("onboarding_accounts.person_id");
  if (f.state === "member") conds.push(member);
  else if (f.state === "no_access") conds.push(sql`not ${member}`);
  else if (f.state === "unlinked") conds.push(isNull(onboardingAccounts.personId));
  else if (f.state === "noquiz") conds.push(isNull(onboardingAccounts.quizCompletedAt));
  const where = conds.length ? and(...conds) : undefined;
  const rows = await d.select({ a: onboardingAccounts, member: sql<boolean>`${member}`, p: { id: persons.id, firstName: persons.firstName, lastName: persons.lastName, username: persons.username, telegramUserId: persons.telegramUserId } }).from(onboardingAccounts).leftJoin(persons, eq(persons.id, onboardingAccounts.personId)).where(where).orderBy(desc(onboardingAccounts.lastSeenAt), desc(onboardingAccounts.id)).limit(per).offset((page - 1) * per);
  const [t] = await d.select({ c: sql<number>`count(*)::int` }).from(onboardingAccounts).where(where);
  return { rows, total: t.c, page, per };
}
/** Чи є в людини Hub-бот (куди надіслати magic link). */
export async function hubChatFor(personId: number) { const [i] = await db().select().from(identities).where(and(eq(identities.personId, personId), eq(identities.botKey, "hub"))); return i && !i.blockedAt ? i : null; }
