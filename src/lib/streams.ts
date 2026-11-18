import { createHmac, randomBytes } from "crypto";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { accessGraceHours, subscriptionAllowsSql } from "./access-rule";
import { addTag } from "./funnels";
import { clubAccess } from "./club";

/**
 * Етери клубу: посилання-прокладка фіксує Telegram ID кожного, хто перейшов на трансляцію.
 * Звичайна вебсторінка не знає, хто її відкрив із Telegram, тому прокладка — це Hub-бот:
 *  - бот: t.me/<bot>?start=ev_<code> → людина натискає «Старт», бот записує перехід і дає кнопку на YouTube;
 *  - Mini App (якщо налаштовано TELEGRAM_MINIAPP_NAME у Vercel і /newapp у @BotFather з адресою <hub>/live):
 *    t.me/<bot>/<app>?startapp=ev_<code> → Telegram відкриває сторінку /live із підписаними даними людини,
 *    Hub перевіряє підпис, записує перехід і одразу відкриває YouTube.
 * Перехід — це клік, не перегляд: скільки людина дивилась, YouTube не повідомляє.
 */

const { streams, streamVisits, persons, events, bots } = schema;
export type Stream = typeof streams.$inferSelect;

export const newStreamCode = () => randomBytes(5).toString("base64url").replace(/[-_]/g, "x").slice(0, 7);
const kyiv = (d: Date) => d.toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric" });
export const defaultStreamTag = (d: Date) => `етер_${kyiv(d)}`;
export const defaultStreamTitle = (d: Date) => `Етер ${kyiv(d).slice(0, 5)}`;
export const miniAppName = () => (process.env.TELEGRAM_MINIAPP_NAME ?? "").trim() || null;

export async function hubBotUsername() {
  const [b] = await db().select({ u: bots.username }).from(bots).where(eq(bots.key, "hub"));
  return b?.u ?? null;
}
/** Посилання для публікації в каналі: Mini App (якщо налаштовано) і через бота (працює завжди). */
export function streamLinks(code: string, botUser: string | null) {
  if (!botUser) return { bot: null, miniapp: null };
  const app = miniAppName();
  return { bot: `https://t.me/${botUser}?start=ev_${code}`, miniapp: app ? `https://t.me/${botUser}/${app}?startapp=ev_${code}` : null };
}

/** Запис переходу: одна людина — один рядок на етер (повтори рахуються), тег етеру при першому переході, подія в історії. */
export async function recordStreamVisit(code: string, personId: number, telegramUserId: number, via: "bot" | "miniapp" | "cabinet" | "recording") {
  const d = db();
  const [s] = await d.select().from(streams).where(eq(streams.code, code));
  if (!s) return null;
  const r = await d.insert(streamVisits).values({ streamId: s.id, personId, telegramUserId, via })
    .onConflictDoUpdate({ target: [streamVisits.streamId, streamVisits.personId], set: { clicks: sql`${streamVisits.clicks} + 1`, lastAt: new Date() } })
    .returning({ clicks: streamVisits.clicks });
  if (r[0]?.clicks === 1) {
    await d.insert(events).values({ personId, type: "stream.visit", source: via, payload: { streamId: s.id, title: s.title } });
    if (s.tag) await addTag(personId, s.tag, "stream", { streamId: s.id });
  }
  return s;
}

/** Людина з Mini App (без чату з ботом): створюємо або оновлюємо за Telegram ID. */
export async function upsertPersonFromWebApp(u: { id: number; first_name?: string; last_name?: string; username?: string }) {
  const [p] = await db().insert(persons).values({ telegramUserId: u.id, firstName: u.first_name ?? null, lastName: u.last_name ?? null, username: u.username ?? null, lastActiveAt: new Date() })
    .onConflictDoUpdate({ target: persons.telegramUserId, set: { lastActiveAt: new Date(), updatedAt: new Date() } }).returning({ id: persons.id });
  return p.id;
}

/** Перевірка підпису даних Telegram Mini App (initData) ключем бота. Повертає користувача й start_param або null. */
export function verifyWebAppInitData(initData: string, botToken: string, maxAgeSec = 24 * 3600) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash"); if (!hash) return null;
  params.delete("hash");
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = createHmac("sha256", secret).update(check).digest("hex");
  if (calc !== hash) return null;
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  try {
    const user = JSON.parse(params.get("user") ?? "null") as { id: number; first_name?: string; last_name?: string; username?: string } | null;
    if (!user?.id) return null;
    return { user, startParam: params.get("start_param") ?? "" };
  } catch { return null; }
}

// ---------- для панелі ----------
/** Членство людини зараз: є чинна підписка ZenEdu чи Hub (за єдиним правилом доступу). */
async function memberSql() {
  const grace = await accessGraceHours();
  return sql.raw(subscriptionAllowsSql("s", grace));
}
export async function streamList() {
  const live = await memberSql();
  return (await db().execute(sql`
    select st.*, count(v.id)::int as visitors,
      count(v.id) filter (where exists (select 1 from subscriptions s where s.person_id = v.person_id and ${live}))::int as members
    from streams st left join stream_visits v on v.stream_id = st.id
    group by st.id order by st.starts_at desc`)).rows as (Record<string, unknown> & { id: number; code: string; title: string; youtube_url: string | null; starts_at: string; tag: string | null; visitors: number; members: number })[];
}
export type StreamVisitor = { personId: number; name: string; username: string | null; telegramUserId: number; via: string; clicks: number; firstAt: string; zen: boolean; hub: boolean };
export async function streamDetail(id: number) {
  const d = db();
  const [s] = await d.select().from(streams).where(eq(streams.id, id));
  if (!s) return null;
  const live = await memberSql();
  const visitors = (await d.execute(sql`
    select v.person_id, v.telegram_user_id, v.via, v.clicks, v.first_at, p.username,
      coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.username, p.telegram_user_id::text) as name,
      exists (select 1 from subscriptions s where s.person_id = v.person_id and s.source = 'zenedu' and ${live}) as zen,
      exists (select 1 from subscriptions s where s.person_id = v.person_id and s.source = 'hub' and ${live}) as hub
    from stream_visits v join persons p on p.id = v.person_id
    where v.stream_id = ${id} order by v.first_at`)).rows as { person_id: number; telegram_user_id: string | number; via: string; clicks: number; first_at: string; username: string | null; name: string; zen: boolean; hub: boolean }[];
  // скільки учасниць клубу зараз загалом — щоб бачити охоплення етеру
  const [m] = (await d.execute(sql`select count(distinct s.person_id)::int as c from subscriptions s where ${live}`)).rows as { c: number }[];
  return {
    s, members: m?.c ?? 0,
    visitors: visitors.map((v): StreamVisitor => ({ personId: v.person_id, name: v.name, username: v.username, telegramUserId: Number(v.telegram_user_id), via: v.via, clicks: v.clicks, firstAt: v.first_at, zen: v.zen, hub: v.hub })),
  };
}

// ---------- етер у кабінеті платформи ----------
/**
 * Етер для кабінету: найближчий, що ще не завершився (до 3 год після початку), інакше — останній за 7 днів (запис).
 * Стан для банера: upcoming — пізніше ніж за добу; today — протягом доби; live — від 15 хв до початку до 3 год після;
 * recent — уже минув (можна дивитись запис, якщо посилання діє).
 */
export type CabinetStream = { code: string; title: string; starts_at: string; state: "upcoming" | "today" | "live" | "recent"; has_link: boolean; watch_from: string };
const LIVE_BEFORE_MS = 15 * 60_000, LIVE_AFTER_MS = 3 * 3600_000;
export async function cabinetStream(now = new Date()): Promise<CabinetStream | null> {
  const d = db();
  const [next] = await d.select().from(streams).where(sql`${streams.startsAt} > ${new Date(now.getTime() - LIVE_AFTER_MS)}`).orderBy(streams.startsAt).limit(1);
  const s = next ?? (await d.select().from(streams).where(sql`${streams.startsAt} > ${new Date(now.getTime() - 7 * 86400_000)}`).orderBy(sql`${streams.startsAt} desc`).limit(1))[0];
  if (!s) return null;
  const t = s.startsAt.getTime(), n = now.getTime();
  const state: CabinetStream["state"] = n >= t - LIVE_BEFORE_MS && n <= t + LIVE_AFTER_MS ? "live" : n > t + LIVE_AFTER_MS ? "recent" : t - n <= 86400_000 ? "today" : "upcoming";
  return { code: s.code, title: s.title, starts_at: s.startsAt.toISOString(), state, has_link: Boolean(s.youtubeUrl), watch_from: new Date(t - LIVE_BEFORE_MS).toISOString() };
}
/**
 * Записи етерів для кабінету: етери, що вже завершились (понад 3 год після початку), за останні 30 днів, не більше 4,
 * найновіші спершу. Через місяць етер зникає сам. Посилання YouTube тут немає — лише через POST streams/watch.
 */
export const ARCHIVE_DAYS = 30, ARCHIVE_MAX = 4;
export type ArchiveStream = { code: string; title: string; starts_at: string; has_link: boolean; available_until: string };
export async function cabinetArchive(now = new Date()): Promise<ArchiveStream[]> {
  const rows = await db().select().from(streams)
    .where(sql`${streams.startsAt} < ${new Date(now.getTime() - LIVE_AFTER_MS)} and ${streams.startsAt} > ${new Date(now.getTime() - ARCHIVE_DAYS * 86400_000)}`)
    .orderBy(sql`${streams.startsAt} desc`).limit(ARCHIVE_MAX);
  return rows.map((s) => ({ code: s.code, title: s.title, starts_at: s.startsAt.toISOString(), has_link: Boolean(s.recordingUrl || s.youtubeUrl), available_until: new Date(s.startsAt.getTime() + ARCHIVE_DAYS * 86400_000).toISOString() }));
}
/** Чи учасниця клубу зараз (чинна підписка ZenEdu чи Hub) — етери лише для учасниць. */
export async function isClubMember(personId: number | null) {
  return (await clubAccess(personId)).member; // те саме правило, що й для кабінету платформи
}
/** Перехід на етер із кабінету: людина вже увійшла (сесія платформи), записуємо і віддаємо посилання на YouTube. */
export async function watchFromCabinet(personId: number, telegramUserId: number, code?: string, now = new Date()) {
  const cur = code ? { code } : await cabinetStream(now);
  if (!cur) return { ok: false as const, error: "no_stream" };
  const [st] = await db().select().from(streams).where(eq(streams.code, cur.code));
  if (!st) return { ok: false as const, error: "no_stream" };
  const ended = now.getTime() > st.startsAt.getTime() + LIVE_AFTER_MS;
  // запис — лише поки він у списку кабінету (30 днів і не більше 4 найновіших); старіші на платформі вже не показуються
  if (ended && !(await cabinetArchive(now)).some((x) => x.code === st.code)) return { ok: false as const, error: "expired" };
  const url = ended ? st.recordingUrl || st.youtubeUrl : st.youtubeUrl;
  if (!url) return { ok: false as const, error: "no_link_yet", starts_at: st.startsAt.toISOString() };
  const s = await recordStreamVisit(st.code, personId, telegramUserId, ended ? "recording" : "cabinet");
  if (!s) return { ok: false as const, error: "no_stream" };
  return { ok: true as const, url, title: s.title, recording: ended };
}
/** Постійне посилання для каналу й закріпленого поста: сторінка етеру в кабінеті, завжди відкриває актуальний етер. */
export function platformStreamLink() {
  const base = (process.env.ONBOARDING_URL ?? "").replace(/\/$/, "");
  return base ? `${base}/efir.html` : null;
}
