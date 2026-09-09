"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Send, CalendarClock, Plus, ChevronDown, ChevronUp, ArrowUp, ArrowDown, X } from "lucide-react";
import { Segmented } from "@/components/ui/controls";
import { ConfirmSubmitButton } from "@/components/ui/confirm";
import type { BroadcastButton } from "@/db/schema";

type Ref = { id: number; name: string };
const COLORS: { k: NonNullable<BroadcastButton["color"]>; label: string; css: string }[] = [
  { k: "default", label: "Звичайна", css: "#e7eef0" }, { k: "primary", label: "Синя", css: "#3b82f6" }, { k: "success", label: "Зелена", css: "#22c55e" }, { k: "danger", label: "Червона", css: "#ef4444" },
];
const TYPES: { k: BroadcastButton["type"]; label: string }[] = [{ k: "link", label: "Посилання" }, { k: "action", label: "Дія" }, { k: "payment", label: "Оплата" }, { k: "miniapp", label: "Mini App" }];
type Action = NonNullable<BroadcastButton["actions"]>[number];
const ACTIONS: { k: Action["type"]; label: string }[] = [
  { k: "send_text", label: "Надіслати текст" }, { k: "call_command", label: "Викликати команду" }, { k: "add_offer", label: "Додати до офферу" }, { k: "add_funnel", label: "Додати у воронку" },
  { k: "remove_funnel", label: "Прибрати з воронки" }, { k: "add_tags", label: "Додати теги" }, { k: "remove_tags", label: "Прибрати теги" }, { k: "delete_message", label: "Видалити повідомлення" },
];

/** Кнопки розсилки: колір, тип (посилання / дія / оплата / Mini App), теги за клік, список дій. */
export function BroadcastButtonsEditor({ initial, funnels, offers }: { initial: BroadcastButton[]; funnels: Ref[]; offers: (Ref & { link: string | null })[] }) {
  const [rows, setRows] = useState<BroadcastButton[]>(initial);
  const [open, setOpen] = useState<number | null>(null);
  const json = useMemo(() => JSON.stringify(rows), [rows]);
  const upd = (i: number, patch: Partial<BroadcastButton>) => setRows((r) => r.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const updAction = (i: number, ai: number, patch: Partial<Action>) => setRows((r) => r.map((b, j) => (j === i ? { ...b, actions: (b.actions ?? []).map((a, k) => (k === ai ? { ...a, ...patch } : a)) } : b)));
  return (
    <div>
      <input type="hidden" name="buttonsJson" value={json} />
      {rows.map((b, i) => (
        <div key={i} className="bcbtn">
          <div className="row-actions" style={{ flexWrap: "nowrap" }}>
            <span className="swatch" style={{ background: COLORS.find((c) => c.k === (b.color ?? "default"))?.css }} />
            <b style={{ flex: 1, fontWeight: 500 }}>{b.text || <span className="muted">без назви</span>}</b>
            <span className="pill mute">{TYPES.find((t) => t.k === b.type)?.label}{b.type === "action" ? ` · ${(b.actions ?? []).length}` : ""}</span>
            <button type="button" className="btn sm ghost" onClick={() => setOpen(open === i ? null : i)}>{open === i ? <><ChevronUp size={14} /> Згорнути</> : <><ChevronDown size={14} /> Змінити</>}</button>
            <button type="button" className="btn sm ghost" disabled={i === 0} onClick={() => setRows((r) => { const a = [...r]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; return a; })} aria-label="Вище"><ArrowUp size={14} /></button>
            <button type="button" className="btn sm ghost" disabled={i === rows.length - 1} onClick={() => setRows((r) => { const a = [...r]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; return a; })} aria-label="Нижче"><ArrowDown size={14} /></button>
            <button type="button" className="btn sm danger ghost" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} aria-label="Прибрати"><X size={14} /></button>
          </div>
          {open === i && <div className="form" style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
            <div className="form two">
              <label className="field">Назва<div className="row-actions" style={{ flexWrap: "nowrap" }}>
                <select value={b.color ?? "default"} onChange={(e) => upd(i, { color: e.target.value as BroadcastButton["color"] })} className="input" style={{ width: 130 }}>{COLORS.map((c) => <option key={c.k} value={c.k}>{c.label}</option>)}</select>
                <input value={b.text} onChange={(e) => upd(i, { text: e.target.value })} maxLength={64} className="input" style={{ flex: 1 }} placeholder="Текст кнопки" /></div></label>
              <label className="field">Тип<select value={b.type} onChange={(e) => upd(i, { type: e.target.value as BroadcastButton["type"] })} className="input">{TYPES.map((t) => <option key={t.k} value={t.k}>{t.label}</option>)}</select></label>
            </div>
            {(b.type === "link" || b.type === "miniapp") && <label className="field">{b.type === "miniapp" ? "URL Mini App (https)" : "Посилання"}<input value={b.url ?? ""} onChange={(e) => upd(i, { url: e.target.value })} placeholder="https://…" className="input" /></label>}
            {b.type === "payment" && <label className="field">Оффер (посилання на оплату)<select value={b.url ?? ""} onChange={(e) => upd(i, { url: e.target.value })} className="input"><option value="">Оберіть оффер</option>{offers.filter((o) => o.link).map((o) => <option key={o.id} value={o.link!}>{o.name}</option>)}</select></label>}
            {b.type === "link" && <div className="row-actions" style={{ gap: 16 }}>
              <label className="ck" title="Посилання йде через редирект Hub: адресу не видно, клік рахується"><input type="checkbox" checked={!b.directLink} onChange={(e) => upd(i, { directLink: !e.target.checked })} /> Захист від копіювання й облік кліків</label>
              <label className="ck" title="Пряме посилання без редиректу: клік не рахується"><input type="checkbox" checked={Boolean(b.directLink)} onChange={(e) => upd(i, { directLink: e.target.checked })} /> Пряме посилання</label>
            </div>}
            {b.type === "action" && <div className="form">
              {(b.actions ?? []).map((a, ai) => <div key={ai} className="row-actions" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                <select value={a.type} onChange={(e) => updAction(i, ai, { type: e.target.value as Action["type"] })} className="input" style={{ width: 200 }}>{ACTIONS.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}</select>
                {a.type === "send_text" && <textarea value={a.text ?? ""} onChange={(e) => updAction(i, ai, { text: e.target.value })} rows={2} className="input" style={{ flex: 1, height: "auto", padding: 8 }} placeholder="Текст відповіді (HTML-теги Telegram)" />}
                {a.type === "call_command" && <input value={a.command ?? ""} onChange={(e) => updAction(i, ai, { command: e.target.value })} className="input" style={{ flex: 1 }} placeholder="lesson1 (команда меню воронки)" />}
                {(a.type === "add_funnel" || a.type === "remove_funnel") && <select value={a.funnelId ?? ""} onChange={(e) => updAction(i, ai, { funnelId: Number(e.target.value) || undefined })} className="input" style={{ flex: 1 }}><option value="">Оберіть воронку</option>{funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>}
                {a.type === "add_offer" && <select value={a.offerId ?? ""} onChange={(e) => updAction(i, ai, { offerId: Number(e.target.value) || undefined })} className="input" style={{ flex: 1 }}><option value="">Оберіть оффер</option>{offers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
                {(a.type === "add_tags" || a.type === "remove_tags") && <input value={(a.tags ?? []).join(", ")} onChange={(e) => updAction(i, ai, { tags: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} className="input" style={{ flex: 1 }} placeholder="теги через кому" />}
                {a.type === "delete_message" && <span className="muted" style={{ flex: 1, paddingTop: 6 }}>видалить це повідомлення розсилки в людини</span>}
                <button type="button" className="btn sm danger ghost" onClick={() => upd(i, { actions: (b.actions ?? []).filter((_, k) => k !== ai) })} aria-label="Прибрати дію"><X size={14} /></button>
              </div>)}
              <div><button type="button" className="btn sm" onClick={() => upd(i, { actions: [...(b.actions ?? []), { type: "send_text", text: "" }] })}><Plus size={14} /> Дія</button></div>
            </div>}
            <label className="field">Теги за клік (через кому)<input value={(b.tags ?? []).join(", ")} onChange={(e) => upd(i, { tags: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} className="input" placeholder="click:efir, interested" /></label>
          </div>}
        </div>
      ))}
      <div className="row-actions" style={{ marginTop: 6 }}>
        <button type="button" className="btn sm" disabled={rows.length >= 10} onClick={() => { setRows((r) => [...r, { text: "", color: "default", type: "link", url: "", tags: [], actions: [] }]); setOpen(rows.length); }}><Plus size={14} /> Додати кнопку</button>
        <span className="muted">до 10 кнопок, кожна окремим рядком</span>
      </div>
    </div>
  );
}

/** Крок «Надсилання»: зараз або за розкладом; головна кнопка називає результат. */
export function SendTimePicker({ initial, count }: { initial: { mode: "now" | "schedule"; date?: string; time?: string }; count: number }) {
  const [mode, setMode] = useState(initial.mode);
  const [date, setDate] = useState(initial.date ?? "");
  const [time, setTime] = useState(initial.time ?? "10:00");
  const when = date ? new Date(`${date}T${time || "10:00"}`).toLocaleString("uk-UA", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "";
  const people = count === 1 ? "1 людині" : `${count} людям`;
  return (
    <div>
      <input type="hidden" name="mode" value={mode} />
      <Segmented defaultValue={mode} onChange={(v) => setMode(v as typeof mode)} options={[{ value: "now", label: "Надіслати зараз", icon: <Send size={14} /> }, { value: "schedule", label: "Запланувати", icon: <CalendarClock size={14} /> }]} />
      {mode === "schedule" && <div className="frow c2" style={{ marginTop: 14 }}>
        <div className="fld"><label className="fld-l">Дата</label><input type="date" name="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
        <div className="fld"><label className="fld-l">Час</label><input type="time" name="time" value={time} onChange={(e) => setTime(e.target.value)} required /><div className="fld-h">Київський час (GMT+3)</div></div>
      </div>}
      <div className="row-actions" style={{ marginTop: 18 }}>
        <ConfirmSubmitButton className="btn pri" disabled={!count || (mode === "schedule" && !date)} title={mode === "now" ? "Надіслати розсилку" : "Запланувати розсилку"} message={mode === "now" ? `Розсилка піде ${people} одразу після підтвердження. Скасувати відправку після старту не можна.` : `Розсилка піде ${people} ${when}. До старту її можна скасувати або змінити.`} confirmLabel={mode === "now" ? "Надіслати" : "Запланувати"}>
          {mode === "now" ? <><Send size={15} /> Надіслати зараз {count ? people : ""}</> : <><CalendarClock size={15} /> Запланувати{when ? ` на ${when}` : ""}</>}
        </ConfirmSubmitButton>
        <Link href="/broadcasts" className="btn ghost">Зберегти чернетку</Link>
      </div>
    </div>
  );
}
