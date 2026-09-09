"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Меню ⋮, яке рендериться поверх сторінки (портал), тому його не обрізають картки з прокруткою. */
export function Kebab({ children, label = "⋮" }: { children: React.ReactNode; label?: string }) {
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const open = () => {
    const r = btn.current?.getBoundingClientRect(); if (!r) return;
    const up = window.innerHeight - r.bottom < 280 && r.top > 280;
    setPos({ top: up ? r.top - 6 : r.bottom + 6, left: Math.min(r.right, window.innerWidth - 12), up });
  };
  useEffect(() => {
    if (!pos) return;
    const onDown = (e: MouseEvent) => { if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setPos(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPos(null); };
    const onScroll = () => setPos(null);
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey); window.addEventListener("scroll", onScroll, true); window.addEventListener("resize", onScroll);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", onScroll); };
  }, [pos]);
  return (
    <>
      <button ref={btn} type="button" className="kebab" aria-haspopup="menu" aria-expanded={Boolean(pos)} onClick={() => (pos ? setPos(null) : open())}>{label}</button>
      {pos && typeof document !== "undefined" && createPortal(
        <div ref={panel} className="dd fixed" role="menu" style={{ top: pos.up ? undefined : pos.top, bottom: pos.up ? window.innerHeight - pos.top : undefined, left: pos.left, transform: "translateX(-100%)" }} onClick={(e) => { const t = e.target as HTMLElement; if (t.closest("a, button[type=submit]")) setTimeout(() => setPos(null), 50); }}>
          {children}
        </div>, document.body)}
    </>
  );
}
