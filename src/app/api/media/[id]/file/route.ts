import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { currentUser } from "@/lib/auth";
import { telegramFileUrl } from "@/lib/media";

export const dynamic = "force-dynamic";

/** Прев’ю файлу бібліотеки: Hub бере файл у Telegram і віддає лише авторизованим користувачам. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser(); if (!me) return new Response("Потрібен вхід", { status: 401 });
  const { id } = await params;
  const [m] = await db().select().from(schema.media).where(eq(schema.media.id, Number(id)));
  if (!m) return new Response("Не знайдено", { status: 404 });
  const url = await telegramFileUrl(m.fileId).catch(() => null);
  if (!url) return new Response("Файл недоступний", { status: 404 });
  const r = await fetch(url);
  if (!r.ok || !r.body) return new Response("Файл недоступний", { status: 404 });
  const type = m.mimeType || (m.kind === "photo" ? "image/jpeg" : m.kind === "video" || m.kind === "video_note" ? "video/mp4" : m.kind === "voice" ? "audio/ogg" : "application/octet-stream");
  return new Response(r.body, { headers: { "content-type": type, "cache-control": "private, max-age=3600" } });
}
