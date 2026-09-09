"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

type Ask = { title?: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void };
const Ctx = createContext<(a: Ask) => void>(() => {});

/** Провайдер діалогу підтвердження в стилі Hub замість браузерного window.confirm. Один на застосунок, у Shell. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (ask) ref.current?.showModal(); else ref.current?.close(); }, [ask]);
  const open = useCallback((a: Ask) => setAsk(a), []);
  const done = (ok: boolean) => { const a = ask; setAsk(null); if (ok) a?.onConfirm(); };
  return (
    <Ctx.Provider value={open}>
      {children}
      <dialog ref={ref} className="modal" style={{ width: "min(440px, 94vw)" }} onClose={() => setAsk(null)} onClick={(e) => { if (e.target === ref.current) done(false); }}>
        {ask && <div className="modal-in">
          <div className="modal-h"><h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>{ask.danger && <span className="ph-ico" style={{ background: "var(--crit-soft)", color: "var(--crit)" }}><AlertTriangle size={16} /></span>}{ask.title ?? (ask.danger ? "Підтвердіть дію" : "Підтвердження")}</h3><button type="button" className="btn sm ghost" onClick={() => done(false)} aria-label="Закрити"><X size={15} /></button></div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--ink-2)" }}>{ask.message}</p>
          <div className="modal-f"><button type="button" className="btn" onClick={() => done(false)}>Скасувати</button><button type="button" className={`btn ${ask.danger ? "danger-solid" : "pri"}`} autoFocus onClick={() => done(true)}>{ask.confirmLabel ?? (ask.danger ? "Так, зробити" : "Підтвердити")}</button></div>
        </div>}
      </dialog>
    </Ctx.Provider>
  );
}
export function useConfirm() { return useContext(Ctx); }

/** Кнопка сабміту, що спершу питає підтвердження у діалозі Hub. Форма має лишатися в DOM після кліку. */
export function ConfirmSubmitButton({ message, title, confirmLabel, danger, className, children, formAction, name, value, disabled }: { message: string; title?: string; confirmLabel?: string; danger?: boolean; className?: string; children: React.ReactNode; formAction?: (fd: FormData) => void | Promise<void>; name?: string; value?: string; disabled?: boolean }) {
  const confirm = useConfirm();
  const ref = useRef<HTMLButtonElement>(null);
  const [armed, setArmed] = useState(false);
  return <button ref={ref} type="submit" className={className} formAction={formAction} name={name} value={value} disabled={disabled} onClick={(e) => {
    if (armed) { setArmed(false); return; }
    e.preventDefault();
    confirm({ message, title, confirmLabel, danger, onConfirm: () => { setArmed(true); setTimeout(() => { ref.current?.form?.requestSubmit(ref.current ?? undefined); setArmed(false); }, 0); } });
  }}>{children}</button>;
}
