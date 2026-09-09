"use client";
import { useState } from "react";
export function CopyBox({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return <div className="copybox"><span style={{ flex: 1, userSelect: "all" }}>{text}</span><button type="button" className="btn sm" onClick={async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 2000); } catch { /* вручну */ } }}>{ok ? "Скопійовано" : "Копіювати"}</button></div>;
}
