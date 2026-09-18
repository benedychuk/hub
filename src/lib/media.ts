import { InputFile } from "grammy";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getBot, botToken, BOT_KEY } from "./bot";

const { media, persons, identities } = schema;
export type MediaKind = "photo" | "video" | "video_note" | "animation" | "audio" | "voice" | "document" | "sticker";
export const MEDIA_LABEL: Record<string, string> = { video_note: "кружечок", photo: "фото", video: "відео", animation: "GIF", voice: "голосове", audio: "аудіо", document: "файл", sticker: "стікер" };
/** Ліміт тіла запиту на Vercel: більші файли надсилають у бот з Telegram. */
export const UPLOAD_LIMIT = 4 * 1024 * 1024;

export function kindFor(mime: string, wanted?: string): MediaKind {
  if (wanted === "video_note" || wanted === "voice" || wanted === "document") return wanted;
  if (mime === "image/gif") return "animation";
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

/** Завантаження з браузера: файл іде через Hub-бот у Telegram-чат користувача (щоб отримати file_id), і запис лягає в бібліотеку. */
export async function uploadToLibrary(buf: Buffer, filename: string, mime: string, telegramUserId: number, wanted?: string, title?: string) {
  const d = db();
  const [p] = await d.select({ id: persons.id }).from(persons).where(eq(persons.telegramUserId, telegramUserId));
  const [idn] = p ? await d.select().from(identities).where(and(eq(identities.personId, p.id), eq(identities.botKey, BOT_KEY))) : [];
  if (!idn?.chatId || idn.blockedAt) throw new Error("Запустіть Hub-бот зі свого Telegram (/start): файл завантажується через нього.");
  const kind = kindFor(mime, wanted);
  const api = getBot().api; const chat = idn.chatId; const file = new InputFile(buf, filename);
  const caption = `Завантажено в бібліотеку Hub${title ? `: ${title}` : ""}`;
  type Sent = { message_id: number; photo?: { file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }[]; video?: F; video_note?: F; animation?: F; audio?: F; voice?: F; document?: F };
  type F = { file_id: string; file_unique_id: string; width?: number; height?: number; duration?: number; file_size?: number; mime_type?: string; length?: number };
  const sent: Sent = kind === "photo" ? await api.sendPhoto(chat, file, { caption })
    : kind === "video" ? await api.sendVideo(chat, file, { caption })
    : kind === "video_note" ? await api.sendVideoNote(chat, file)
    : kind === "animation" ? await api.sendAnimation(chat, file, { caption })
    : kind === "audio" ? await api.sendAudio(chat, file, { caption })
    : kind === "voice" ? await api.sendVoice(chat, file, { caption })
    : await api.sendDocument(chat, file, { caption });
  const f: F | undefined = kind === "photo" ? sent.photo?.[sent.photo.length - 1] : (sent[kind as keyof Sent] as F | undefined);
  if (!f) throw new Error("Telegram не повернув файл");
  const [row] = await d.insert(media).values({ kind, fileId: f.file_id, fileUniqueId: f.file_unique_id, title: title || filename, caption: null, width: f.width ?? f.length ?? null, height: f.height ?? f.length ?? null, duration: f.duration ?? null, fileSize: f.file_size ?? buf.length, mimeType: f.mime_type ?? mime, fromPersonId: p?.id ?? null })
    .onConflictDoUpdate({ target: media.fileUniqueId, set: { fileId: f.file_id, title: title || filename } }).returning();
  return row;
}

/** Файл із Telegram для прев’ю в бібліотеці: тимчасова адреса через getFile. */
export async function telegramFileUrl(fileId: string) {
  const f = await getBot().api.getFile(fileId);
  if (!f.file_path) return null;
  return `https://api.telegram.org/file/bot${botToken()}/${f.file_path}`;
}
