import { createHmac, randomBytes } from "crypto";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { accessGraceHours, subscriptionAllowsSql } from "./access-rule";
import { addTag } from "./funnels";

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
export async function recordStreamVisit(code: string, personId: number, telegramUserId: number, via: "bot" | "miniapp") {
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
