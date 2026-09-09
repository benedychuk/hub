"use client";
import { useMemo, useState } from "react";
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
            <button type="button" className="btn sm ghost" onClick={() => setOpen(open === i ? null : i)}>{open === i ? "Згорнути" : "Змінити"}</button>
            <button type="button" className="btn sm ghost" disabled={i === 0} onClick={() => setRows((r) => { const a = [...r]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; return a; })}>↑</button>
            <button type="button" className="btn sm ghost" disabled={i === rows.length - 1} onClick={() => setRows((r) => { const a = [...r]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; return a; })}>↓</button>
            <button type="button" className="btn sm danger ghost" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>✕</button>
          </div>
          {open === i && <div className="form" style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
            <div className="form two">
              <label className="field">Назва<div className="row-actions" style={{ flexWrap: "nowrap" }}>
                <select value={b.color ?? "default"} onChange={(e) => upd(i, { color: e.target.value as BroadcastButton["color"] })} className="btn sm" style={{ width: 120 }}>{COLORS.map((c) => <option key={c.k} value={c.k}>{c.label}</option>)}</select>
                <input value={b.text} onChange={(e) => upd(i, { text: e.target.value })} maxLength={64} className="btn sm" style={{ flex: 1 }} placeholder="Текст кнопки" /></div></label>
              <label className="field">Тип<select value={b.type} onChange={(e) => upd(i, { type: e.target.value as BroadcastButton["type"] })} className="btn sm">{TYPES.map((t) => <option key={t.k} value={t.k}>{t.label}</option>)}</select></label>
            </div>
            {(b.type === "link" || b.type === "miniapp") && <label className="field">{b.type === "miniapp" ? "URL Mini App (https)" : "Посилання"}<input value={b.url ?? ""} onChange={(e) => upd(i, { url: e.target.value })} placeholder="https://…" className="btn sm" /></label>}
            {b.type === "payment" && <label className="field">Оффер (посилання на оплату)<select value={b.url ?? ""} onChange={(e) => upd(i, { url: e.target.value })} className="btn sm"><option value="">Оберіть оффер</option>{offers.filter((o) => o.link).map((o) => <option key={o.id} value={o.link!}>{o.name}</option>)}</select></label>}
            {b.type === "link" && <div className="row-actions" style={{ gap: 16 }}>
              <label className="ck" title="Посилання йде через редирект Hub: адресу не видно, клік рахується"><input type="checkbox" checked={!b.directLink} onChange={(e) => upd(i, { directLink: !e.target.checked })} /> Захист від копіювання й облік кліків</label>
              <label className="ck" title="Пряме посилання без редиректу: клік не рахується"><input type="checkbox" checked={Boolean(b.directLink)} onChange={(e) => upd(i, { directLink: e.target.checked })} /> Пряме посилання</label>
            </div>}
            {b.type === "action" && <div className="form">
              {(b.actions ?? []).map((a, ai) => <div key={ai} className="row-actions" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                <select value={a.type} onChange={(e) => updAction(i, ai, { type: e.target.value as Action["type"] })} className="btn sm" style={{ width: 200 }}>{ACTIONS.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}</select>
                {a.type === "send_text" && <textarea value={a.text ?? ""} onChange={(e) => updAction(i, ai, { text: e.target.value })} rows={2} className="btn sm" style={{ flex: 1 }} placeholder="Текст відповіді (HTML-теги Telegram)" />}
                {a.type === "call_command" && <input value={a.command ?? ""} onChange={(e) => updAction(i, ai, { command: e.target.value })} className="btn sm" style={{ flex: 1 }} placeholder="lesson1 (команда меню воронки)" />}
                {(a.type === "add_funnel" || a.type === "remove_funnel") && <select value={a.funnelId ?? ""} onChange={(e) => updAction(i, ai, { funnelId: Number(e.target.value) || undefined })} className="btn sm" style={{ flex: 1 }}><option value="">Оберіть воронку</option>{funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>}
                {a.type === "add_offer" && <select value={a.offerId ?? ""} onChange={(e) => updAction(i, ai, { offerId: Number(e.target.value) || undefined })} className="btn sm" style={{ flex: 1 }}><option value="">Оберіть оффер</option>{offers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
                {(a.type === "add_tags" || a.type === "remove_tags") && <input value={(a.tags ?? []).join(", ")} onChange={(e) => updAction(i, ai, { tags: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} className="btn sm" style={{ flex: 1 }} placeholder="теги через кому" />}
                {a.type === "delete_message" && <span className="muted" style={{ flex: 1, paddingTop: 6 }}>видалить це повідомлення розсилки в людини</span>}
                <button type="button" className="btn sm danger ghost" onClick={() => upd(i, { actions: (b.actions ?? []).filter((_, k) => k !== ai) })}>✕</button>
              </div>)}
              <div><button type="button" className="btn sm" onClick={() => upd(i, { actions: [...(b.actions ?? []), { type: "send_text", text: "" }] })}>+ Дія</button></div>
            </div>}
            <label className="field">Теги за клік (через кому)<input value={(b.tags ?? []).join(", ")} onChange={(e) => upd(i, { tags: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} className="btn sm" placeholder="click:efir, interested" /></label>
          </div>}
        </div>
      ))}
      <div className="row-actions" style={{ marginTop: 6 }}>
        <button type="button" className="btn sm" disabled={rows.length >= 10} onClick={() => { setRows((r) => [...r, { text: "", color: "default", type: "link", url: "", tags: [], actions: [] }]); setOpen(rows.length); }}>+ Додати кнопку</button>
        <span className="muted">до 10 кнопок, кожна окремим рядком</span>
      </div>
    </div>
  );
}

/** Крок «Надсилання»: зараз або за розкладом (дата й час за Києвом). */
export function SendTimePicker({ initial }: { initial: { mode: "now" | "schedule"; date?: string; time?: string } }) {
  const [mode, setMode] = useState(initial.mode);
  return (
    <div className="form">
      <input type="hidden" name="mode" value={mode} />
      <div className="row-actions"><span style={{ flex: 1, fontWeight: 600 }}>Час надсилання</span>
        <div className="seg"><button type="button" className={mode === "now" ? "on" : ""} onClick={() => setMode("now")}>➤ Надіслати зараз</button><button type="button" className={mode === "schedule" ? "on" : ""} onClick={() => setMode("schedule")}>📅 Запланувати</button></div></div>
      {mode === "schedule" && <div className="form two">
        <label className="field">Дата<input type="date" name="date" defaultValue={initial.date} required /></label>
        <label className="field">Час <span className="muted">(GMT+03:00) Київ</span><input type="time" name="time" defaultValue={initial.time ?? "10:00"} required /></label>
      </div>}
    </div>
  );
}
