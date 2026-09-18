import { currentUser, myTelegramId } from "@/lib/auth";
import { uploadToLibrary, UPLOAD_LIMIT } from "@/lib/media";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Завантаження файлу в бібліотеку з браузера (лише для користувачів Hub). */
export async function POST(req: Request) {
  const me = await currentUser(); if (!me) return Response.json({ error: "Потрібен вхід" }, { status: 401 });
  const tg = await myTelegramId(); if (!tg) return Response.json({ error: "Вкажіть свій Telegram ID у Налаштування → Мій акаунт" }, { status: 400 });
  let fd: FormData;
  try { fd = await req.formData(); } catch { return Response.json({ error: `Файл завеликий для завантаження з браузера (до ${Math.round(UPLOAD_LIMIT / 1024 / 1024)} МБ). Надішліть його в Hub-бот.` }, { status: 413 }); }
  const file = fd.get("file"); if (!(file instanceof File)) return Response.json({ error: "Немає файлу" }, { status: 400 });
  if (file.size > UPLOAD_LIMIT) return Response.json({ error: `Файл більший за ${Math.round(UPLOAD_LIMIT / 1024 / 1024)} МБ: надішліть його в Hub-бот зі свого Telegram, він зʼявиться в бібліотеці.` }, { status: 413 });
  try {
    const row = await uploadToLibrary(Buffer.from(await file.arrayBuffer()), file.name, file.type || "application/octet-stream", tg, String(fd.get("kind") ?? "") || undefined, String(fd.get("title") ?? "") || undefined);
    return Response.json({ ok: true, media: row });
  } catch (e) { return Response.json({ error: String((e as Error).message ?? e).slice(0, 300) }, { status: 400 }); }
}
