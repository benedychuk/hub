"use client";
import { useRef, useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";

/**
 * Поле з посиланням або кодом: повне значення моноширинним шрифтом, копіювання кліком по полю або іконкою,
 * необов'язкова кнопка «Відкрити». Довгі адреси прокручуються в полі, а не обрізаються.
 */
export function CopyField({ value, open, compact, ariaLabel }: { value: string; open?: boolean; compact?: boolean; ariaLabel?: string }) {
  const [ok, setOk] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const copy = async () => {
    ref.current?.select();
    try { await navigator.clipboard.writeText(value); }
    catch { try { document.execCommand("copy"); } catch { /* лишається виділеним для Ctrl+C */ } }
    setOk(true); setTimeout(() => setOk(false), 1800);
  };
  return (
    <div className={`copyfield${compact ? " sm" : ""}${ok ? " ok" : ""}`}>
      <input ref={ref} readOnly value={value} onClick={copy} onFocus={(e) => e.currentTarget.select()} aria-label={ariaLabel ?? "Посилання"} spellCheck={false} title="Натисніть, щоб скопіювати" />
      {ok && <span className="copyfield-ok" role="status">Скопійовано</span>}
      <button type="button" className="copyfield-b" onClick={copy} aria-label="Копіювати" title="Копіювати">{ok ? <Check size={15} /> : <Copy size={15} />}</button>
      {open && <a className="copyfield-b" href={value} target="_blank" rel="noreferrer" aria-label="Відкрити" title="Відкрити в новій вкладці"><ExternalLink size={15} /></a>}
    </div>
  );
}
