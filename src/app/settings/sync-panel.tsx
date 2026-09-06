"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SyncPanel({ ready }: { ready: boolean }) {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const call = async (mode: string) => {
    const r = await fetch("/api/sync/step", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? r.statusText);
    return j as { done?: boolean; phase?: string; stats?: Record<string, number> };
  };
  const full = async () => {
    setBusy(true); setLog(["Старт повного імпорту…"]);
    try {
      for (let i = 0; i < 60; i++) {
        const j = await call("full");
        setLog((l) => [...l, `крок ${i + 1}: ${Object.entries(j.stats ?? {}).map(([k, v]) => `${k}=${v}`).join(" ")} → далі: ${j.phase}`]);
        if (j.done) { setLog((l) => [...l, "Готово."]); break; }
      }
    } catch (e) { setLog((l) => [...l, "Помилка: " + String(e)]); }
    setBusy(false); router.refresh();
  };
  const inc = async () => {
    setBusy(true); setLog(["Швидкий імпорт…"]);
    try { const j = await call("incremental"); setLog((l) => [...l, Object.entries(j.stats ?? {}).map(([k, v]) => `${k}=${v}`).join(" "), "Готово."]); }
    catch (e) { setLog((l) => [...l, "Помилка: " + String(e)]); }
    setBusy(false); router.refresh();
  };
  const reset = async () => { await call("reset"); setLog(["Курсор скинуто: наступний повний імпорт почнеться спочатку."]); router.refresh(); };
  return (
    <div style={{ marginTop: 12 }}>
      <div className="row-actions">
        <button className="btn pri" disabled={!ready || busy} onClick={full}>{busy ? "Іде…" : "Повний імпорт"}</button>
        <button className="btn" disabled={!ready || busy} onClick={inc}>Швидкий імпорт (нове)</button>
        <button className="btn ghost sm" disabled={!ready || busy} onClick={reset}>Скинути курсор</button>
      </div>
      {log.length > 0 && <pre className="mono" style={{ marginTop: 10, background: "var(--surface-2)", padding: 10, borderRadius: 8, maxHeight: 220, overflow: "auto", fontSize: 11.5, whiteSpace: "pre-wrap" }}>{log.join("\n")}</pre>}
    </div>
  );
}
