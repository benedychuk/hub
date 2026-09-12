"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StepButton } from "@/lib/funnels";
import { RichText } from "./rich-text";
import { ConfirmSubmitButton } from "./ui/confirm";
import { ArrowUp, ArrowDown, X, Plus, Upload, Trash2 } from "lucide-react";

/** Кнопка сабміту з підтвердженням (видалення тощо). */
export function ConfirmSubmit({ message, className, children, formAction, name, value }: { message: string; className?: string; children: React.ReactNode; formAction?: (fd: FormData) => void | Promise<void>; name?: string; value?: string }) {
  return <ConfirmSubmitButton message={message} danger className={className} formAction={formAction} name={name} value={value}>{children}</ConfirmSubmitButton>;
}

/** Обкладинка: PNG/JPG/WEBP до 20 МБ; стискається в браузері до 1200px і зберігається як data URL. */
export function CoverInput({ current }: { current: string | null }) {
  const [preview, setPreview] = useState<string | null>(current);
  const [mode, setMode] = useState<"keep" | "delete" | "replace">("keep");
  const [data, setData] = useState("");
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  async function pick(file: File | undefined) {
    setErr(""); if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setErr("Підтримуються лише PNG, JPG або WEBP."); return; }
    if (file.size > 20 * 1024 * 1024) { setErr("Файл більший за 20 МБ."); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1200; const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      const out = file.type === "image/png" ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.86);
      setData(out); setPreview(out); setMode("replace"); URL.revokeObjectURL(url);
    };
    img.onerror = () => setErr("Не вдалося прочитати зображення.");
    img.src = url;
  }
  return (
    <div className="cover-input">
      <input type="hidden" name="coverMode" value={mode} /><input type="hidden" name="coverData" value={data} />
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} />
      {preview ? <div className="cover-prev" style={{ backgroundImage: `url(${preview})` }} /> : <div className="cover-prev empty" onClick={() => fileRef.current?.click()}>Натисніть, щоб завантажити обкладинку<br /><small>PNG, JPG або WEBP · до 20 МБ · рекомендовано 1200×675</small></div>}
      <div className="row-actions" style={{ marginTop: 8 }}>
        <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}><Upload size={14} /> {preview ? "Замінити" : "Завантажити"}</button>
        {preview && <button type="button" className="btn sm danger ghost" onClick={() => { setPreview(null); setData(""); setMode("delete"); }}><Trash2 size={14} /> Видалити</button>}
        {err && <span className="muted" style={{ color: "var(--crit)" }}>{err}</span>}
      </div>
    </div>
  );
}

/** Текст кроку: візуальний редактор Telegram-форматування. */
export function StepText({ name, defaultValue, max = 4096, minHeight = 200, variables, placeholder }: { name: string; defaultValue: string; max?: number; rows?: number; minHeight?: number; variables?: { key: string; label: string }[]; placeholder?: string }) {
  return <RichText name={name} defaultValue={defaultValue} max={max} minHeight={minHeight} variables={variables} placeholder={placeholder} />;
}

type Media = { id: number; kind: string; title: string | null; caption: string | null; duration: number | null; width: number | null; height: number | null };
const KIND: Record<string, string> = { video_note: "кружечок", photo: "фото", video: "відео", animation: "GIF", voice: "голосове", audio: "аудіо", document: "файл", sticker: "стікер" };
const mediaLabel = (m: Media) => `#${m.id} ${KIND[m.kind] ?? m.kind}${m.title ? " · " + m.title : m.caption ? " · " + m.caption.slice(0, 30) : ""}${m.duration ? ` · ${m.duration} с` : ""}`;

/** Вкладення кроку: файли з бібліотеки (надіслані в Hub-бот). */
export function AttachmentsPicker({ media, initial }: { media: Media[]; initial: number[] }) {
  const [ids, setIds] = useState<number[]>(initial);
  const [pick, setPick] = useState("");
  const chosen = ids.map((id) => media.find((m) => m.id === id)).filter(Boolean) as Media[];
  const free = media.filter((m) => !ids.includes(m.id));
  return (
    <div>
      <input type="hidden" name="attachmentsJson" value={JSON.stringify(ids)} />
      {chosen.map((m, i) => <div key={m.id} className="att"><span className={`pill ${m.kind === "video_note" ? "acc" : "moon"}`}>{KIND[m.kind] ?? m.kind}</span><span style={{ flex: 1 }}>{mediaLabel(m)}</span>
        <button type="button" className="btn sm ghost" disabled={i === 0} aria-label="Вище" onClick={() => setIds((a) => { const b = [...a]; [b[i - 1], b[i]] = [b[i], b[i - 1]]; return b; })}><ArrowUp size={14} /></button>
        <button type="button" className="btn sm ghost" disabled={i === chosen.length - 1} aria-label="Нижче" onClick={() => setIds((a) => { const b = [...a]; [b[i + 1], b[i]] = [b[i], b[i + 1]]; return b; })}><ArrowDown size={14} /></button>
        <button type="button" className="btn sm danger ghost" aria-label="Прибрати" onClick={() => setIds((a) => a.filter((x) => x !== m.id))}><X size={14} /></button></div>)}
      <div className="row-actions" style={{ marginTop: 6 }}>
        <select value={pick} onChange={(e) => setPick(e.target.value)} className="input" style={{ maxWidth: 360 }}><option value="">Файл із бібліотеки…</option>{free.map((m) => <option key={m.id} value={m.id}>{mediaLabel(m)}</option>)}</select>
        <button type="button" className="btn sm" disabled={!pick} onClick={() => { setIds((a) => [...a, Number(pick)]); setPick(""); }}><Plus size={14} /> Додати</button>
        {!media.length && <span className="muted">Бібліотека порожня: перешліть медіа в Hub-бот.</span>}
      </div>
      <p className="fld-h">Кружечки й стікери завжди йдуть окремими повідомленнями. Одне фото/відео з текстом до 1024 знаків надсилається з підписом і кнопками; кілька фото/відео йдуть альбомом, а текст окремо.</p>
    </div>
  );
}

const KINDS: { k: StepButton["kind"]; label: string; hint: string }[] = [
  { k: "url", label: "Посилання", hint: "https://…" },
  { k: "next", label: "Наступний крок одразу", hint: "" },
  { k: "step", label: "Перейти до кроку", hint: "" },
  { k: "funnel", label: "Запустити воронку", hint: "" },
  { k: "offer", label: "Оффер / оплата", hint: "" },
  { k: "tag", label: "Лише поставити тег", hint: "" },
  { k: "option", label: "Варіант відповіді", hint: "" },
];

/** Кнопки під кроком: до 10 рядків; для тестів і опитувань — варіанти відповіді. */
export function ButtonsEditor({ initial, steps, funnels, offers, stepType }: { initial: StepButton[]; steps: { id: number; title: string | null; position: number }[]; funnels: { id: number; name: string }[]; offers: { id: number; name: string; url: string | null }[]; stepType: string }) {
  const optionOnly = stepType === "survey" || stepType === "quiz";
  const [rows, setRows] = useState<StepButton[]>(initial.length ? initial : []);
  const json = useMemo(() => JSON.stringify(rows), [rows]);
  const upd = (i: number, patch: Partial<StepButton>) => setRows((r) => r.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const kinds = optionOnly ? KINDS.filter((k) => k.k === "option" || k.k === "url") : KINDS.filter((k) => k.k !== "option" || stepType === "question");
  return (
    <div>
      <input type="hidden" name="buttonsJson" value={json} />
      {rows.map((b, i) => (
        <div key={i} className="btnrow">
          <input value={b.text} onChange={(e) => upd(i, { text: e.target.value })} placeholder={optionOnly ? `Варіант ${i + 1}` : `Кнопка ${i + 1}`} maxLength={64} />
          <select value={b.kind} onChange={(e) => upd(i, { kind: e.target.value as StepButton["kind"], target: undefined })}>{kinds.map((k) => <option key={k.k} value={k.k}>{k.label}</option>)}</select>
          {b.kind === "url" && <input value={b.target ?? ""} onChange={(e) => upd(i, { target: e.target.value })} placeholder="https://…" />}
          {b.kind === "step" && <select value={b.target ?? ""} onChange={(e) => upd(i, { target: e.target.value })}><option value="">Оберіть крок</option>{steps.map((s, n) => <option key={s.id} value={s.id}>{n + 1}. {s.title ?? "Крок"}</option>)}</select>}
          {b.kind === "funnel" && <select value={b.target ?? ""} onChange={(e) => upd(i, { target: e.target.value })}><option value="">Оберіть воронку</option>{funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>}
          {b.kind === "offer" && <select value={b.target ?? ""} onChange={(e) => upd(i, { target: e.target.value })}><option value="">Оберіть оффер</option>{offers.filter((o) => o.url).map((o) => <option key={o.id} value={o.url!}>{o.name}</option>)}</select>}
          {(b.kind === "next" || b.kind === "tag" || b.kind === "option") && <input value={b.tag ?? ""} onChange={(e) => upd(i, { tag: e.target.value })} placeholder="тег за клік (порожньо = автотег)" />}
          {stepType === "quiz" && b.kind === "option" ? <label className="ck" title="Правильна відповідь"><input type="checkbox" checked={Boolean(b.correct)} onChange={(e) => upd(i, { correct: e.target.checked })} /> правильна</label> : <span />}
          <span className="row-actions">
            <button type="button" className="btn sm ghost" disabled={i === 0} aria-label="Вище" onClick={() => setRows((r) => { const a = [...r]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; return a; })}><ArrowUp size={14} /></button>
            <button type="button" className="btn sm ghost" disabled={i === rows.length - 1} aria-label="Нижче" onClick={() => setRows((r) => { const a = [...r]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; return a; })}><ArrowDown size={14} /></button>
            <button type="button" className="btn sm danger ghost" aria-label="Прибрати" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}><X size={14} /></button>
          </span>
        </div>
      ))}
      <div className="row-actions" style={{ marginTop: 6 }}>
        <button type="button" className="btn sm" disabled={rows.length >= 10} onClick={() => setRows((r) => [...r, { text: "", kind: optionOnly ? "option" : "url", correct: false }])}><Plus size={14} /> Додати {optionOnly ? "варіант" : "кнопку"}</button>
        <span className="fld-h">до 10 кнопок, кожна окремим рядком</span>
      </div>
    </div>
  );
}

/** Налаштування часу надсилання: Ні / Одразу / Через N / У конкретний день о HH:MM. */
export function SendTimeFields({ initial }: { initial: { mode: string; value?: number; unit?: string; day?: number; time?: string } }) {
  const [mode, setMode] = useState(initial.mode || "immediately");
  return (
    <div className="form">
      <label className="fld"><span className="fld-l">Час надсилання</span>
        <select name="sendMode" value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="no">Ні: лише за кнопкою, командою або вручну</option>
          <option value="immediately">Одразу після попереднього кроку</option>
          <option value="after">Через певний час після попереднього кроку</option>
          <option value="exact">У конкретний день о вказаній годині</option>
          <option value="after_action">Після дії: коли людина відповість або натисне кнопку попереднього кроку</option>
        </select></label>
      {mode === "after" && <div className="row-actions"><span className="muted">через</span><input name="sendValue" type="number" min={0} defaultValue={initial.value ?? 1} className="input" style={{ width: 90 }} /><select name="sendUnit" defaultValue={initial.unit ?? "hours"} className="input" style={{ width: 120 }}><option value="minutes">хвилин</option><option value="hours">годин</option><option value="days">днів</option></select></div>}
      {mode === "exact" && <div className="row-actions"><span className="muted">день</span><input name="sendDay" type="number" min={0} defaultValue={initial.day ?? 1} className="input" style={{ width: 80 }} /><span className="muted">після попереднього кроку (0 = того ж дня), о</span><input name="sendTime" type="time" defaultValue={initial.time ?? "12:00"} className="input" style={{ width: 120 }} /><span className="muted">за Києвом</span></div>}
    </div>
  );
}

export function AutoDeleteFields({ initial }: { initial: { mode: string; value?: number; unit?: string } }) {
  const [mode, setMode] = useState(initial.mode || "never");
  return (
    <div className="form">
      <label className="fld"><span className="fld-l">Автовидалення повідомлення</span>
        <select name="autodeleteMode" value={mode} onChange={(e) => setMode(e.target.value)}><option value="never">Ніколи</option><option value="in">Через певний час (до 48 годин)</option></select></label>
      {mode === "in" && <div className="row-actions"><span className="muted">через</span><input name="autodeleteValue" type="number" min={1} defaultValue={initial.value ?? 24} className="input" style={{ width: 90 }} /><select name="autodeleteUnit" defaultValue={initial.unit ?? "hours"} className="input" style={{ width: 120 }}><option value="seconds">секунд</option><option value="minutes">хвилин</option><option value="hours">годин</option></select><span className="muted">Telegram дозволяє видаляти повідомлення бота лише впродовж 48 годин</span></div>}
    </div>
  );
}

/** Прапорець, що одразу сабмітить форму (перемикач у таблиці). */
export function AutoSubmitToggle({ checked, label }: { checked: boolean; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return <label className="switch" title={label}><input ref={ref} type="checkbox" defaultChecked={checked} onChange={() => ref.current?.form?.requestSubmit()} /><i /></label>;
}

/** Закриває відкриті меню ⋮ при кліку поза ними. */
export function MenuCloser() {
  useEffect(() => {
    const h = (e: MouseEvent) => { document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((d) => { if (!d.contains(e.target as Node)) d.open = false; }); };
    document.addEventListener("click", h); return () => document.removeEventListener("click", h);
  }, []);
  return null;
}
