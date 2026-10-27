import { and, asc, eq, sql } from "drizzle-orm";
import type { Message, MessageEntity } from "grammy/types";
import { db, schema } from "@/db";
import type { StepButton, StepConfig } from "./funnels";

/**
 * Запис кроків воронки з Telegram: член команди відкриває Hub-бот за посиланням ?start=rec_<id воронки>
 * і пересилає повідомлення (наприклад, із чату з ботом ZenEdu). Кожне повідомлення стає кроком
 * «Повідомлення» з текстом, форматуванням, медіа й кнопками-посиланнями; альбом склеюється в один крок на /done.
 * Нові кроки мають час «Ні» (не надсилаються автоматично): затримки виставляються в редакторі.
 * Нікому з учасниць нічого не пише і доступів не змінює.
 */

const { funnels, funnelSteps, media, settings } = schema;
const SESSION_TTL_MS = 3 * 3600_000;
const key = (tg: number) => `funnel_rec:${tg}`;

type Session = { funnelId: number; session: string; startMsg: number; basePos: number; lastAt: string };
export type ImportMark = { session: string; msg: number; group?: string };
type RecConfig = StepConfig & { import?: ImportMark };

const MEDIA_LABEL: Record<string, string> = { video_note: "кружечок", photo: "фото", video: "відео", animation: "GIF", voice: "голосове", audio: "аудіо", document: "файл", sticker: "стікер" };

/** Медіа з повідомлення Telegram у вигляді, придатному для бібліотеки. */
export function mediaOf(m: Message) {
  return m.video_note ? { kind: "video_note", f: m.video_note, w: m.video_note.length, h: m.video_note.length, d: m.video_note.duration, mime: undefined as string | undefined }
    : m.photo ? { kind: "photo", f: m.photo[m.photo.length - 1], w: m.photo[m.photo.length - 1].width, h: m.photo[m.photo.length - 1].height, d: undefined, mime: undefined }
    : m.video ? { kind: "video", f: m.video, w: m.video.width, h: m.video.height, d: m.video.duration, mime: m.video.mime_type }
    : m.animation ? { kind: "animation", f: m.animation, w: m.animation.width, h: m.animation.height, d: m.animation.duration, mime: undefined }
    : m.voice ? { kind: "voice", f: m.voice, w: undefined, h: undefined, d: m.voice.duration, mime: undefined }
    : m.audio ? { kind: "audio", f: m.audio, w: undefined, h: undefined, d: m.audio.duration, mime: m.audio.mime_type }
    : m.document ? { kind: "document", f: m.document, w: undefined, h: undefined, d: undefined, mime: m.document.mime_type }
    : m.sticker ? { kind: "sticker", f: m.sticker, w: undefined, h: undefined, d: undefined, mime: undefined } : null;
}
export type MediaInfo = NonNullable<ReturnType<typeof mediaOf>>;

/** Зберігає медіа в бібліотеку (або оновлює file_id наявного) і повертає id запису. */
export async function saveMedia(med: MediaInfo, caption: string | null, personId: number) {
  const f = med.f as { file_id: string; file_unique_id: string; file_size?: number; file_name?: string };
  const [row] = await db().insert(media).values({ kind: med.kind, fileId: f.file_id, fileUniqueId: f.file_unique_id, title: f.file_name ?? null, caption, width: med.w ?? null, height: med.h ?? null, duration: med.d ?? null, fileSize: f.file_size ?? null, mimeType: med.mime ?? null, fromPersonId: personId })
    .onConflictDoUpdate({ target: media.fileUniqueId, set: { fileId: f.file_id, caption } }).returning({ id: media.id });
  return row.id;
}

// ---------- текст із форматуванням Telegram → HTML для кроку ----------
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => esc(s).replace(/"/g, "&quot;");
function tagFor(e: MessageEntity): [string, string] | null {
  switch (e.type) {
    case "bold": return ["<b>", "</b>"];
    case "italic": return ["<i>", "</i>"];
    case "underline": return ["<u>", "</u>"];
    case "strikethrough": return ["<s>", "</s>"];
    case "spoiler": return ["<tg-spoiler>", "</tg-spoiler>"];
    case "code": return ["<code>", "</code>"];
    case "pre": return e.language ? [`<pre><code class="language-${escAttr(e.language)}">`, "</code></pre>"] : ["<pre>", "</pre>"];
    case "text_link": return [`<a href="${escAttr(e.url)}">`, "</a>"];
    case "text_mention": return [`<a href="tg://user?id=${e.user.id}">`, "</a>"];
    case "blockquote": return ["<blockquote>", "</blockquote>"];
    case "expandable_blockquote": return ["<blockquote expandable>", "</blockquote>"];
    default: return null; // url, mention, hashtag тощо Telegram підсвічує сам
  }
}
/** Перетворює текст з entities (зсуви в UTF-16, як і рядки JS) на HTML, який розуміє Telegram. */
export function entitiesToHtml(text: string, entities: MessageEntity[] = []) {
  const list = entities.map((e) => ({ e, end: e.offset + e.length, tag: tagFor(e) })).filter((x) => x.tag && x.e.length > 0)
    .sort((a, b) => a.e.offset - b.e.offset || b.e.length - a.e.length);
  const cuts = [...new Set([0, text.length, ...list.flatMap((x) => [x.e.offset, x.end])])].filter((n) => n >= 0 && n <= text.length).sort((a, b) => a - b);
  const stack: typeof list = []; let out = ""; let next = 0;
  for (let ci = 0; ci < cuts.length; ci++) {
    const pos = cuts[ci];
    // закриваємо все, що закінчується тут; перехресні сутності закриваються й відкриваються знову
    if (stack.some((x) => x.end <= pos)) {
      const reopen: typeof list = [];
      while (stack.some((x) => x.end <= pos)) { const top = stack.pop()!; out += top.tag![1]; if (top.end > pos) reopen.unshift(top); }
      for (const x of reopen) { out += x.tag![0]; stack.push(x); }
    }
    while (next < list.length && list[next].e.offset === pos) { const x = list[next++]; out += x.tag![0]; stack.push(x); }
    if (ci + 1 < cuts.length) out += esc(text.slice(pos, cuts[ci + 1]));
  }
  while (stack.length) out += stack.pop()!.tag![1];
  return out;
}

// ---------- сесія запису ----------
async function getSession(tg: number): Promise<Session | null> {
  const [r] = await db().select().from(settings).where(eq(settings.key, key(tg)));
  const s = r?.value as Session | undefined;
  if (!s || Date.now() - new Date(s.lastAt).getTime() > SESSION_TTL_MS) return null;
  return s;
}
async function putSession(tg: number, s: Session | null) {
  if (!s) { await db().delete(settings).where(eq(settings.key, key(tg))); return; }
  await db().insert(settings).values({ key: key(tg), value: s }).onConflictDoUpdate({ target: settings.key, set: { value: s, updatedAt: new Date() } });
}
async function sessionSteps(funnelId: number, session: string) {
  return db().select().from(funnelSteps).where(and(eq(funnelSteps.funnelId, funnelId), sql`${funnelSteps.config}->'import'->>'session' = ${session}`)).orderBy(asc(funnelSteps.position));
}
async function refreshCount(funnelId: number) {
  await db().update(funnels).set({ stepsCount: sql`(select count(*)::int from funnel_steps where funnel_id = ${funnelId})`, updatedAt: new Date() }).where(eq(funnels.id, funnelId));
}
const editorPath = (f: { id: number; kind: string }) => `${f.kind === "product" ? "/products" : "/funnels"}/${f.id}`;

/** Початок запису за посиланням ?start=rec_<id>. Повертає текст відповіді. */
export async function startRecording(tg: number, funnelId: number, startMsg: number) {
  const [f] = await db().select().from(funnels).where(eq(funnels.id, funnelId));
  if (!f || f.source !== "hub") return "Воронку не знайдено. Відкрийте її в Hub і натисніть «Записати з Telegram» ще раз.";
  const [last] = await db().select({ p: sql<number>`coalesce(max(${funnelSteps.position}), 0)::int` }).from(funnelSteps).where(eq(funnelSteps.funnelId, funnelId));
  await putSession(tg, { funnelId, session: `${funnelId}-${Date.now().toString(36)}`, startMsg, basePos: last?.p ?? 0, lastAt: new Date().toISOString() });
  return `Запис у «${f.name}» почато.\n\nПересилайте сюди повідомлення по порядку: текст, фото, відео, кружечки, голосові, файли, альбоми. Можна виділити кілька повідомлень і переслати разом. Можна й написати текст кроку самостійно.\n\nКожне повідомлення стане окремим кроком; я позначатиму прийняті реакцією.\n/undo — прибрати останній крок\n/done — завершити запис`;
}

/**
 * Обробляє повідомлення члена команди під час запису. Повертає null, якщо запису немає (звичайна обробка),
 * інакше { reply?, react } — що відповісти в чат.
 */
export async function recordMessage(tg: number, personId: number, m: Message, appUrl: string): Promise<{ reply?: string; react?: boolean } | null> {
  const s = await getSession(tg);
  if (!s) return null;
  const cmd = m.text?.trim().toLowerCase().split(/[\s@]/)[0];
  if (cmd === "/done" || cmd === "/stop_rec") return { reply: await finishRecording(tg, s, appUrl) };
  if (cmd === "/undo") return { reply: await undoLast(s) };
  if (cmd?.startsWith("/")) return { reply: "Зараз іде запис кроків. /undo — прибрати останній крок, /done — завершити." };

  const med = mediaOf(m);
  const text = m.text ?? m.caption ?? "";
  const body = entitiesToHtml(text, m.text ? m.entities : m.caption_entities);
  const buttons: StepButton[] = (m.reply_markup?.inline_keyboard ?? []).flat()
    .filter((b): b is typeof b & { url: string } => "url" in b && typeof b.url === "string")
    .map((b) => ({ text: b.text, kind: "url" as const, target: b.url }));
  if (!med && !text.trim() && !buttons.length) return { reply: "Цей тип повідомлення (опитування, контакт, геолокація тощо) не переноситься. Пропущено." };

  await putSession(tg, { ...s, lastAt: new Date().toISOString() });
  // повтор того самого оновлення від Telegram не створює другий крок
  const mark: ImportMark = { session: s.session, msg: m.message_id, ...(m.media_group_id ? { group: m.media_group_id } : {}) };
  const [dup] = await db().select({ id: funnelSteps.id }).from(funnelSteps).where(and(eq(funnelSteps.funnelId, s.funnelId), sql`${funnelSteps.config}->'import'->>'session' = ${s.session}`, sql`(${funnelSteps.config}->'import'->>'msg')::bigint = ${m.message_id}`));
  if (dup) return { react: true };

  const attachments = med ? [await saveMedia(med, m.caption ?? null, personId)] : [];
  const plain = text.replace(/\s+/g, " ").trim();
  const title = plain ? (plain.length > 48 ? plain.slice(0, 47) + "…" : plain) : med ? MEDIA_LABEL[med.kind] ?? "Медіа" : "Повідомлення";
  const preview = Boolean(m.text && (m.entities ?? []).some((e) => e.type === "url" || e.type === "text_link") && !m.link_preview_options?.is_disabled);
  const config: RecConfig = { sendTime: { mode: "no" }, autodelete: { mode: "never" }, protect: false, preview, quietHours: true, attachments, buttons, import: mark };
  // позиція з номера повідомлення в чаті: пересилання йдуть по порядку, навіть якщо Telegram доставив їх паралельно
  const position = s.basePos + Math.max(1, m.message_id - s.startMsg) * 10;
  await db().insert(funnelSteps).values({ funnelId: s.funnelId, position, type: "message", title, body, isActive: true, config: config as Record<string, unknown> });
  await refreshCount(s.funnelId);
  return { react: true };
}

/** Склеює частини альбомів в один крок (порядок за номером повідомлення). Повертає кількість об'єднань. */
async function mergeAlbums(s: Session) {
  const steps = await sessionSteps(s.funnelId, s.session);
  const groups = new Map<string, typeof steps>();
  for (const st of steps) { const g = ((st.config ?? {}) as RecConfig).import?.group; if (g) groups.set(g, [...(groups.get(g) ?? []), st]); }
  let merged = 0;
  for (const items of groups.values()) {
    if (items.length < 2) continue;
    items.sort((a, b) => (((a.config ?? {}) as RecConfig).import?.msg ?? 0) - (((b.config ?? {}) as RecConfig).import?.msg ?? 0));
    const [head, ...rest] = items; const hc = (head.config ?? {}) as RecConfig;
    const withText = items.find((x) => x.body?.trim());
    const config: RecConfig = { ...hc, attachments: items.flatMap((x) => ((x.config ?? {}) as RecConfig).attachments ?? []), buttons: items.flatMap((x) => ((x.config ?? {}) as RecConfig).buttons ?? []) };
    await db().update(funnelSteps).set({ body: withText?.body ?? head.body, title: withText?.title ?? `Альбом · ${items.length}`, config: config as Record<string, unknown> }).where(eq(funnelSteps.id, head.id));
    for (const x of rest) await db().delete(funnelSteps).where(eq(funnelSteps.id, x.id));
    merged += rest.length;
  }
  return merged;
}

async function undoLast(s: Session) {
  const steps = await sessionSteps(s.funnelId, s.session);
  const last = steps.at(-1);
  if (!last) return "У цьому записі ще немає кроків.";
  const g = ((last.config ?? {}) as RecConfig).import?.group;
  const drop = g ? steps.filter((x) => ((x.config ?? {}) as RecConfig).import?.group === g) : [last];
  for (const x of drop) await db().delete(funnelSteps).where(eq(funnelSteps.id, x.id));
  await refreshCount(s.funnelId);
  return `Прибрано: «${last.title}»${drop.length > 1 ? ` (альбом, ${drop.length} частин)` : ""}.`;
}

async function finishRecording(tg: number, s: Session, appUrl: string) {
  const merged = await mergeAlbums(s);
  const steps = await sessionSteps(s.funnelId, s.session);
  await putSession(tg, null);
  await refreshCount(s.funnelId);
  const [f] = await db().select({ id: funnels.id, kind: funnels.kind, name: funnels.name }).from(funnels).where(eq(funnels.id, s.funnelId));
  if (!steps.length) return "Запис завершено, нових кроків немає.";
  const lines = steps.slice(0, 30).map((st, i) => {
    const c = (st.config ?? {}) as RecConfig;
    return `${i + 1}. ${st.title}${c.attachments?.length ? ` · вкладень ${c.attachments.length}` : ""}${c.buttons?.length ? ` · кнопок ${c.buttons.length}` : ""}`;
  });
  return [
    `Готово: у «${f?.name ?? "воронку"}» додано кроків: ${steps.length}${merged ? ` (альбоми склеєно)` : ""}.`,
    "", ...lines, steps.length > 30 ? `… і ще ${steps.length - 30}` : "",
    "", "Що лишилось у редакторі:",
    "• виставити затримки: зараз нові кроки мають час «Ні» і самі не надсилаються;",
    "• додати кнопки-дії («Далі», перехід до кроку): Telegram при пересиланні лишає тільки кнопки-посилання;",
    "• замінити кнопки оплати ZenEdu на оффер Hub.",
    "", f ? `${appUrl}${editorPath(f)}` : "",
  ].filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n").trim();
}
