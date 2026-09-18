"use client";
import { useMemo, useState } from "react";
import { Send } from "lucide-react";

type Row = { person_id: number; status: string; first_name: string | null; last_name: string | null; username: string | null; received: boolean };
const name = (r: Row) => [r.first_name, r.last_name].filter(Boolean).join(" ") || (r.username ? "@" + r.username : `#${r.person_id}`);
const STATUS: Record<string, string> = { active: "проходить", done: "завершила", stopped: "зупинено" };

/** Вибір людей у воронці для надсилання кроку: фільтр за станом і тим, чи отримували крок, «обрати всіх», лічильник. */
export function PeoplePicker({ people }: { people: Row[] }) {
  const [filter, setFilter] = useState("not_received");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const rows = useMemo(() => people.filter((r) => (filter === "all" || (filter === "not_received" ? !r.received : filter === "received" ? r.received : r.status === filter)) && (!q || name(r).toLowerCase().includes(q.toLowerCase()))), [people, filter, q]);
  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.person_id));
  const toggleAll = () => setSel((s) => { const n = new Set(s); if (allSel) rows.forEach((r) => n.delete(r.person_id)); else rows.forEach((r) => n.add(r.person_id)); return n; });
  return (
    <div className="form">
      <div className="row-actions">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="input" style={{ width: 240 }} aria-label="Кого показати">
          <option value="not_received">Не отримували цей крок</option><option value="received">Уже отримували</option><option value="active">Проходять зараз</option><option value="done">Завершили</option><option value="stopped">Зупинені</option><option value="all">Усі у воронці</option>
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Пошук за імʼям" className="input" style={{ width: 220 }} aria-label="Пошук" />
        <label className="chk"><input type="checkbox" checked={allSel} onChange={toggleAll} /> <span>обрати всіх показаних ({rows.length})</span></label>
      </div>
      <div className="chk-list" style={{ maxHeight: 280, overflow: "auto" }}>
        {rows.map((r) => <label key={r.person_id} className="chk"><input type="checkbox" name="personIds" value={r.person_id} checked={sel.has(r.person_id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(r.person_id); else n.delete(r.person_id); return n; })} /><span className="chk-t">{name(r)}<small>{STATUS[r.status] ?? r.status}{r.received ? " · крок отримано" : ""}</small></span></label>)}
        {!rows.length && <p className="fld-h">Нікого за цим фільтром.</p>}
      </div>
      <div className="row-actions"><button className="btn pri" type="submit" disabled={!sel.size}><Send size={15} /> Надіслати {sel.size ? `(${sel.size})` : ""}</button><span className="fld-h">Крок піде одразу, місце людини у воронці не зміниться.</span></div>
    </div>
  );
}
