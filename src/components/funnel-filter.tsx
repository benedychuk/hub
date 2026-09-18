"use client";
import { useState } from "react";
import { Plus, X } from "lucide-react";

export type FunnelRule = { funnelId: number; state: "any" | "active" | "done" | "stopped" | "never" };
export const FUNNEL_STATE_LABEL: Record<FunnelRule["state"], string> = { any: "були у воронці (будь-який стан)", active: "проходять зараз", done: "завершили", stopped: "зупинені (вийшли або зупинено)", never: "ніколи не були у воронці" };

/** Умови за воронками: випадний список воронки + стан проходження; умов може бути кілька, усі мають виконуватись. */
export function FunnelFilter({ funnels, initial }: { funnels: { id: number; name: string; kind?: string }[]; initial: FunnelRule[] }) {
  const [rules, setRules] = useState<FunnelRule[]>(initial);
  const [fid, setFid] = useState<string>(""); const [state, setState] = useState<FunnelRule["state"]>("any");
  const name = (id: number) => funnels.find((f) => f.id === id)?.name ?? `#${id}`;
  return (
    <div className="form">
      <input type="hidden" name="funnelRulesJson" value={JSON.stringify(rules)} />
      {rules.length > 0 && <div className="chips">{rules.map((r, i) => <span key={i} className="chip on">{name(r.funnelId)} · {FUNNEL_STATE_LABEL[r.state]}<button type="button" aria-label="Прибрати" onClick={() => setRules((a) => a.filter((_, j) => j !== i))}><X size={12} /></button></span>)}</div>}
      <div className="row-actions">
        <select value={fid} onChange={(e) => setFid(e.target.value)} className="input" style={{ minWidth: 260 }} aria-label="Воронка або продукт">
          <option value="">Оберіть воронку або продукт…</option>
          {funnels.map((f) => <option key={f.id} value={f.id}>{f.kind === "product" ? "Продукт · " : ""}{f.name}</option>)}
        </select>
        <select value={state} onChange={(e) => setState(e.target.value as FunnelRule["state"])} className="input" style={{ minWidth: 260 }} aria-label="Стан">
          {(Object.keys(FUNNEL_STATE_LABEL) as FunnelRule["state"][]).map((k) => <option key={k} value={k}>{FUNNEL_STATE_LABEL[k]}</option>)}
        </select>
        <button type="button" className="btn sm" disabled={!fid} onClick={() => { setRules((a) => [...a.filter((r) => r.funnelId !== Number(fid)), { funnelId: Number(fid), state }]); setFid(""); }}><Plus size={14} /> Додати умову</button>
      </div>
      <p className="fld-h" style={{ margin: 0 }}>«Проходять зараз» — отримали хоча б один крок і ще не дійшли до кінця; «завершили» — пройшли всі кроки; «зупинені» — вийшли самі або зупинено вручну.</p>
    </div>
  );
}
