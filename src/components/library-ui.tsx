"use client";
import { useState } from "react";
import { Trash2, Pencil } from "lucide-react";
import { Kebab, MenuAction } from "@/components/ui/controls";
import { UploadButton, MediaThumb } from "@/components/funnel-ui";
import { deleteMedia, renameMedia } from "@/lib/actions";

type Media = { id: number; kind: string; title: string | null; caption: string | null; duration: number | null; width: number | null; height: number | null; fileSize?: number | null; createdAt?: Date | string };
const KIND: Record<string, string> = { video_note: "кружечок", photo: "фото", video: "відео", animation: "GIF", voice: "голосове", audio: "аудіо", document: "файл", sticker: "стікер" };

/** Сітка бібліотеки з превʼю, перейменуванням на місці й завантаженням. */
export function LibraryGrid({ media: initial, onlyUpload }: { media: Media[]; onlyUpload?: boolean }) {
  const [media, setMedia] = useState<Media[]>(initial);
  const [q, setQ] = useState(""); const [kind, setKind] = useState("");
  const rows = media.filter((m) => (!kind || m.kind === kind) && (!q || `${m.title ?? ""} ${m.caption ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const upload = <UploadButton label="Завантажити файл" onDone={(m) => setMedia((all) => [m as Media, ...all.filter((x) => x.id !== m.id)])} />;
  if (onlyUpload) return upload;
  return (
    <div className="form">
      <div className="row-actions" style={{ justifyContent: "space-between" }}>
        <div className="row-actions">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Пошук за назвою" className="input" style={{ width: 240 }} aria-label="Пошук" />
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="input" style={{ width: 160 }} aria-label="Тип"><option value="">Усі типи</option>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <span className="fld-h">{rows.length} з {media.length}</span>
        </div>
        {upload}
      </div>
      <div className="mgrid">
        {rows.map((m) => <div key={m.id} className="mcard">
          <div className={`mprev ${m.kind === "video_note" ? "round" : ""}`}>{["photo", "video", "video_note", "animation", "sticker"].includes(m.kind) ? <MediaThumb m={m} size={180} /> : <span className="pill moon">{KIND[m.kind] ?? m.kind}</span>}</div>
          <div className="mbody">
            <form action={renameMedia}><input type="hidden" name="id" value={m.id} /><input name="title" defaultValue={m.title ?? m.caption ?? ""} placeholder="Назва" aria-label="Назва" onBlur={(e) => { if (e.target.value !== (m.title ?? m.caption ?? "")) e.target.form?.requestSubmit(); }} /></form>
            <span className="fld-h mono">#{m.id} · {KIND[m.kind] ?? m.kind}{m.duration ? ` · ${m.duration} с` : ""}{m.width && m.kind !== "video_note" ? ` · ${m.width}×${m.height}` : ""}{m.fileSize ? ` · ${Math.round(m.fileSize / 1024)} КБ` : ""}</span>
          </div>
          <Kebab><MenuAction action={renameMedia} fields={{ id: m.id, title: m.title ?? "" }} icon={<Pencil />}>Назва: клікніть у полі</MenuAction><MenuAction action={deleteMedia} fields={{ id: m.id }} icon={<Trash2 />} danger confirm="Видалити файл із бібліотеки? Кроки, де він вставлений, залишаться без нього.">Видалити</MenuAction></Kebab>
        </div>)}
      </div>
    </div>
  );
}
