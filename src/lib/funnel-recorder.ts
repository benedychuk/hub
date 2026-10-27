import { and, asc, eq, sql } from "drizzle-orm";
import type { Message, MessageEntity } from "grammy/types";
import { db, schema } from "@/db";
import type { StepButton, StepConfig } from "./funnels";

/**
 * Запис кроків воронки з Telegram: член команди відкриває Hub-бот за посиланням ?start=rec_<id воронки>
 * і пересилає або пише матеріали кроку (кружечок, текст, фото, альбом, кнопки-посилання), потім тисне
 * «Крок готовий» (/ready): усе надіслане до цього стає ОДНИМ кроком. «Завершити запис» (/done) зберігає останній.
 * Кожне повідомлення спершу пишеться як прихована частина-чернетка (isActive=false), а крок збирається з частин
 * за номерами повідомлень: межі кроків — номери повідомлень «Крок готовий». Так порядок і склад кроку правильні,
 * навіть коли Telegram доставляє переслану пачку паралельно або частина приходить уже після «Крок готовий».
 * Нові кроки мають час «Ні» (не надсилаються автоматично): затримки виставляються в редакторі.
 * Нікому з учасниць нічого не пише і доступів не змінює.
 */

const { funnels, funnelSteps, media, settings } = schema;
const SESSION_TTL_MS = 3 * 3600_000;
const key = (tg: number) => `funnel_rec:${tg}`;

type Session = { funnelId: number; session: string; startMsg: number; basePos: number; lastAt: string; bounds?: number[] };
/** Одна частина кроку: те, що прийшло одним повідомленням. */
type Part = { msg: number; body: string; attachments: number[]; buttons: StepButton[]; preview: boolean; label: string };
export type ImportMark = { session: string; draft?: boolean; msg?: number; part?: Part; group?: number; parts?: Part[] };
type RecConfig = StepConfig & { import?: ImportMark };

/** Підписи кнопок під полем вводу під час запису (reply keyboard). */
export const REC_KEYS = { ready: "Крок готовий", undo: "Прибрати останнє", done: "Завершити запис" } as const;
export type RecKeyboard = "rec" | "remove";

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
/** Точкові оновлення сесії в jsonb, щоб паралельні повідомлення не затирали межі кроків одне одного. */
async function touchSession(tg: number) {
  await db().update(settings).set({ value: sql`jsonb_set(${settings.value}, '{lastAt}', to_jsonb(${new Date().toISOString()}::text))`, updatedAt: new Date() }).where(eq(settings.key, key(tg)));
}
async function addBound(tg: number, msg: number) {
  await db().update(settings).set({ value: sql`jsonb_set(${settings.value}, '{bounds}', coalesce(${settings.value}->'bounds', '[]'::jsonb) || to_jsonb(${msg}::int))`, updatedAt: new Date() }).where(eq(settings.key, key(tg)));
}
async function sessionRows(funnelId: number, session: string) {
  return db().select().from(funnelSteps).where(and(eq(funnelSteps.funnelId, funnelId), sql`${funnelSteps.config}->'import'->>'session' = ${session}`)).orderBy(asc(funnelSteps.position));
}
async function refreshCount(funnelId: number) {
  await db().update(funnels).set({ stepsCount: sql`(select count(*)::int from funnel_steps where funnel_id = ${funnelId})`, updatedAt: new Date() }).where(eq(funnels.id, funnelId));
}
const editorPath = (f: { id: number; kind: string }) => `${f.kind === "product" ? "/products" : "/funnels"}/${f.id}`;
const imp = (row: { config: unknown }) => ((row.config ?? {}) as RecConfig).import ?? ({} as ImportMark);
/** Номер кроку для повідомлення: скільки меж «Крок готовий» було до нього. */
const groupOf = (msg: number, bounds: number[]) => bounds.filter((b) => b < msg).length;
const describe = (parts: Part[]) => {
  const count = new Map<string, number>();
  for (const p of parts) count.set(p.label, (count.get(p.label) ?? 0) + 1);
  const btn = parts.reduce((n, p) => n + p.buttons.length, 0);
  return [...count].map(([l, n]) => (n > 1 && l !== "текст" ? `${n} ${l}` : l)).join(" + ") + (btn ? ` + кнопок ${btn}` : "");
};

/** Початок запису за посиланням ?start=rec_<id>. */
export async function startRecording(tg: number, funnelId: number, startMsg: number): Promise<{ reply: string; keyboard?: RecKeyboard }> {
  const [f] = await db().select().from(funnels).where(eq(funnels.id, funnelId));
  if (!f || f.source !== "hub") return { reply: "Воронку не знайдено. Відкрийте її в Hub і натисніть «Записати з Telegram» ще раз." };
  const prev = await getSession(tg);
  if (prev) await consolidate(tg, true); // незавершений попередній запис зберігаємо, щоб матеріали не загубились
  const [last] = await db().select({ p: sql<number>`coalesce(max(${funnelSteps.position}), 0)::int` }).from(funnelSteps).where(eq(funnelSteps.funnelId, funnelId));
  await putSession(tg, { funnelId, session: `${funnelId}-${Date.now().toString(36)}`, startMsg, basePos: last?.p ?? 0, lastAt: new Date().toISOString(), bounds: [] });
  return { keyboard: "rec", reply: [
    `Запис у «${f.name}» почато.`, "",
    "1. Надішліть або перешліть усе, що має бути в одному кроці: кружечок, текст, фото чи відео, альбом, повідомлення з кнопками-посиланнями.",
    `2. Натисніть «${REC_KEYS.ready}»: це стане одним кроком воронки.`,
    "3. Так само наступний крок.",
    `4. «${REC_KEYS.done}» зберігає останній крок і закриває запис.`, "",
    `«${REC_KEYS.undo}» прибирає останній матеріал кроку, що збирається, а якщо він порожній — останній збережений крок.`,
    "Прийняті матеріали я позначаю реакцією.",
  ].join("\n") };
}

/**
 * Обробляє повідомлення члена команди під час запису. Повертає null, якщо запису немає (звичайна обробка),
 * інакше { reply?, react?, keyboard? } — що відповісти в чат.
 */
export async function recordMessage(tg: number, personId: number, m: Message, appUrl: string): Promise<{ reply?: string; react?: boolean; keyboard?: RecKeyboard } | null> {
  const s = await getSession(tg);
  if (!s) return null;
  const t = m.text?.trim() ?? "";
  const cmd = t.toLowerCase().split(/[\s@]/)[0];
  if (t === REC_KEYS.ready || ["/ready", "/next", "ready", "готово"].includes(cmd)) return { reply: await readyStep(tg, s, m.message_id), keyboard: "rec" };
  if (t === REC_KEYS.done || cmd === "/done" || cmd === "done") return { reply: await finishRecording(tg, s, appUrl), keyboard: "remove" };
  if (t === REC_KEYS.undo || cmd === "/undo") return { reply: await undoLast(tg, s), keyboard: "rec" };
  if (cmd.startsWith("/")) return { reply: `Зараз іде запис кроків. «${REC_KEYS.ready}» — зберегти крок, «${REC_KEYS.undo}», «${REC_KEYS.done}».`, keyboard: "rec" };

  const med = mediaOf(m);
  const text = m.text ?? m.caption ?? "";
  const buttons: StepButton[] = (m.reply_markup?.inline_keyboard ?? []).flat()
    .filter((b): b is typeof b & { url: string } => "url" in b && typeof b.url === "string")
    .map((b) => ({ text: b.text, kind: "url" as const, target: b.url }));
  if (!med && !text.trim() && !buttons.length) return { reply: "Цей тип повідомлення (опитування, контакт, геолокація тощо) не переноситься. Пропущено." };

  await touchSession(tg);
  // повтор того самого оновлення від Telegram не створює другу частину
  const [dup] = await db().select({ id: funnelSteps.id }).from(funnelSteps).where(and(eq(funnelSteps.funnelId, s.funnelId), sql`${funnelSteps.config}->'import'->>'session' = ${s.session}`,
    sql`((${funnelSteps.config}->'import'->>'msg')::bigint = ${m.message_id} or coalesce(${funnelSteps.config}->'import'->'parts', '[]'::jsonb) @> ${JSON.stringify([{ msg: m.message_id }])}::jsonb)`));
  if (dup) return { react: true };

  const attachments = med ? [await saveMedia(med, m.caption ?? null, personId)] : [];
  const part: Part = {
    msg: m.message_id, body: entitiesToHtml(text, m.text ? m.entities : m.caption_entities), attachments, buttons,
    preview: Boolean(m.text && (m.entities ?? []).some((e) => e.type === "url" || e.type === "text_link") && !m.link_preview_options?.is_disabled),
    label: med ? MEDIA_LABEL[med.kind] ?? "медіа" : "текст",
  };
  const config: RecConfig = { sendTime: { mode: "no" }, autodelete: { mode: "never" }, attachments: [], buttons: [], import: { session: s.session, draft: true, msg: m.message_id, part } };
  // прихована частина: у воронці не надсилається, поки не зібрана в крок
  await db().insert(funnelSteps).values({ funnelId: s.funnelId, position: s.basePos + Math.max(1, m.message_id - s.startMsg) * 10, type: "message", title: `Частина кроку · ${part.label}`, body: "", isActive: false, config: config as Record<string, unknown> });
  // частина, що запізнилась після «Крок готовий», одразу доїжджає у свій уже збережений крок
  const fresh = await getSession(tg);
  if (fresh?.bounds?.some((b) => b > m.message_id)) await consolidate(tg, false);
  return { react: true };
}

/**
 * Збирає частини-чернетки в кроки: усе між двома «Крок готовий» — один крок. includeOpen додає й частини після
 * останньої межі (на «Завершити запис»). Ідемпотентно: крок пам'ятає свої частини й перебудовується з їхнього об'єднання.
 */
async function consolidate(tg: number, includeOpen: boolean) {
  const s = await getSession(tg); if (!s) return [] as number[];
  const bounds = [...(s.bounds ?? [])].sort((a, b) => a - b);
  const rows = await sessionRows(s.funnelId, s.session);
  const drafts = rows.filter((r) => imp(r).draft && imp(r).part);
  const finals = new Map(rows.filter((r) => !imp(r).draft && imp(r).group != null).map((r) => [imp(r).group!, r]));
  const byGroup = new Map<number, typeof drafts>();
  for (const d of drafts) {
    const g = groupOf(imp(d).msg ?? 0, bounds);
    if (g >= bounds.length && !includeOpen) continue; // крок, що ще збирається
    byGroup.set(g, [...(byGroup.get(g) ?? []), d]);
  }
  const touched: number[] = [];
  for (const [g, items] of byGroup) {
    const fin = finals.get(g);
    const parts = [...(fin ? imp(fin).parts ?? [] : []), ...items.map((d) => imp(d).part!)].sort((a, b) => a.msg - b.msg);
    const text = parts.map((p) => p.body).filter((b) => b.trim());
    const firstText = text[0]?.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim() ?? "";
    const title = firstText ? (firstText.length > 48 ? firstText.slice(0, 47) + "…" : firstText) : describe(parts);
    const config: RecConfig = {
      sendTime: { mode: "no" }, autodelete: { mode: "never" }, protect: false, preview: parts.some((p) => p.preview), quietHours: true,
      attachments: parts.flatMap((p) => p.attachments), buttons: parts.flatMap((p) => p.buttons),
      import: { session: s.session, group: g, parts },
    };
    const values = { title, body: text.join("\n\n"), isActive: true, config: config as Record<string, unknown>, position: s.basePos + Math.max(1, parts[0].msg - s.startMsg) * 10 };
    if (fin) { await db().update(funnelSteps).set(values).where(eq(funnelSteps.id, fin.id)); touched.push(fin.id); }
    else { const [n] = await db().insert(funnelSteps).values({ funnelId: s.funnelId, type: "message", ...values }).returning({ id: funnelSteps.id }); touched.push(n.id); }
    for (const d of items) await db().delete(funnelSteps).where(eq(funnelSteps.id, d.id));
  }
  await refreshCount(s.funnelId);
  return touched;
}

async function readyStep(tg: number, s: Session, msg: number) {
  // межа ставиться завжди: якщо пачку переслали й одразу натиснули кнопку, частини можуть ще бути в дорозі
  await addBound(tg, msg);
  await touchSession(tg);
  await new Promise((r) => setTimeout(r, 1500));
  await consolidate(tg, false);
  const g = (s.bounds ?? []).length; // номер кроку, який щойно закрито
  const rows = (await sessionRows(s.funnelId, s.session)).filter((r) => !imp(r).draft).sort((a, b) => (imp(a).group ?? 0) - (imp(b).group ?? 0));
  const step = rows.find((r) => imp(r).group === g);
  if (!step) return `У кроці ще нічого немає. Надішліть матеріали, потім натисніть «${REC_KEYS.ready}».`;
  return `Крок ${rows.indexOf(step) + 1} збережено: ${describe(imp(step).parts ?? [])}.\nНадсилайте матеріали наступного кроку або натисніть «${REC_KEYS.done}».`;
}

async function undoLast(tg: number, s: Session) {
  const rows = await sessionRows(s.funnelId, s.session);
  const bounds = s.bounds ?? [];
  const open = rows.filter((r) => imp(r).draft && groupOf(imp(r).msg ?? 0, bounds) >= bounds.length).sort((a, b) => (imp(a).msg ?? 0) - (imp(b).msg ?? 0));
  if (open.length) {
    const last = open.at(-1)!;
    await db().delete(funnelSteps).where(eq(funnelSteps.id, last.id));
    await refreshCount(s.funnelId);
    return `Прибрано з кроку, що збирається: ${imp(last).part?.label ?? "матеріал"}. У ньому лишилось матеріалів: ${open.length - 1}.`;
  }
  const finals = rows.filter((r) => !imp(r).draft);
  const lastStep = finals.at(-1);
  if (!lastStep) return "У цьому записі ще немає кроків.";
  await db().delete(funnelSteps).where(eq(funnelSteps.id, lastStep.id));
  await refreshCount(s.funnelId);
  return `Прибрано крок «${lastStep.title}».`;
}

async function finishRecording(tg: number, s: Session, appUrl: string) {
  await consolidate(tg, true);
  const steps = (await sessionRows(s.funnelId, s.session)).filter((r) => !imp(r).draft);
  await putSession(tg, null);
  await refreshCount(s.funnelId);
  const [f] = await db().select({ id: funnels.id, kind: funnels.kind, name: funnels.name }).from(funnels).where(eq(funnels.id, s.funnelId));
  if (!steps.length) return "Запис завершено, нових кроків немає.";
  const lines = steps.slice(0, 30).map((st, i) => `${i + 1}. ${st.title} · ${describe(imp(st).parts ?? [])}`);
  return [
    `Готово: у «${f?.name ?? "воронку"}» додано кроків: ${steps.length}.`,
    "", ...lines, steps.length > 30 ? `… і ще ${steps.length - 30}` : "",
    "", "Що лишилось у редакторі:",
    "• виставити затримки: зараз нові кроки мають час «Ні» і самі не надсилаються;",
    "• додати кнопки-дії («Далі», перехід до кроку): Telegram при пересиланні лишає тільки кнопки-посилання;",
    "• замінити кнопки оплати ZenEdu на оффер Hub.",
    "", f ? `${appUrl}${editorPath(f)}` : "",
  ].filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n").trim();
}
