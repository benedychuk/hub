import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";

/** Заголовок сторінки об’єкта: назад, назва, статус, дії. */
export function PageHeader({ back, backLabel = "Назад", title, icon, status, actions }: { back?: string; backLabel?: string; title: React.ReactNode; icon?: React.ReactNode; status?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="ph">
      {back && <Link href={back} className="btn sm ghost"><ArrowLeft size={16} /> {backLabel}</Link>}
      {icon && <span className="ph-ico">{icon}</span>}
      <h2 className="ph-title">{title}</h2>
      {status}
      <span className="spacer" />
      {actions && <div className="row-actions">{actions}</div>}
    </div>
  );
}

/** Кроки майстра. current — індекс поточного; пройдені кроки клікабельні. */
export function Stepper({ steps, current, hrefFor }: { steps: string[]; current: number; hrefFor?: (i: number) => string }) {
  return (
    <ol className="stepper">
      {steps.map((s, i) => {
        const cls = i === current ? "on" : i < current ? "done" : "";
        const inner = <><i>{i < current ? <Check size={13} /> : i + 1}</i><span>{s}</span></>;
        return <li key={s} className={cls}>{hrefFor && i !== current ? <Link href={hrefFor(i)}>{inner}</Link> : <span className="s">{inner}</span>}</li>;
      })}
    </ol>
  );
}

/** Картка-секція з заголовком, описом і необов’язковими діями справа. */
export function Section({ title, description, actions, children, className }: { title?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card sec ${className ?? ""}`}>
      {(title || actions) && <header className="sec-h"><div><h3 className="sec-t">{title}</h3>{description && <p className="sec-d">{description}</p>}</div>{actions && <div className="row-actions">{actions}</div>}</header>}
      {children}
    </section>
  );
}

/** Поле форми: підпис зверху, контрол, помічний текст або помилка знизу. */
export function Field({ label, hint, error, children, htmlFor }: { label: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className={`fld ${error ? "err" : ""}`}>
      <label className="fld-l" htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <div className="fld-e">{error}</div> : hint ? <div className="fld-h">{hint}</div> : null}
    </div>
  );
}
/** Рядок із рівними колонками полів. */
export function FormRow({ cols = 2, children }: { cols?: 2 | 3; children: React.ReactNode }) { return <div className={`frow c${cols}`}>{children}</div>; }

/** Велика цифра з підписом. */
export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "good" | "warn" | "crit" }) {
  return <div className={`stat ${tone ?? ""}`}><small>{label}</small><b>{value}</b>{hint && <span className="pct">{hint}</span>}</div>;
}
/** Компактний підсумок «підпис: значення» у рядок. */
export function Summary({ items }: { items: { label: string; value: React.ReactNode; tone?: "warn" | "crit" }[] }) {
  return <dl className="summary">{items.map((it) => <div key={it.label} className={it.tone ?? ""}><dt>{it.label}</dt><dd>{it.value}</dd></div>)}</dl>;
}

export function EmptyState({ icon, title, text, action }: { icon?: React.ReactNode; title: string; text?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="empty">{icon && <div className="empty-i">{icon}</div>}<b>{title}</b>{text && <p>{text}</p>}{action}</div>;
}
export function Alert({ tone = "info", children }: { tone?: "info" | "ok" | "warn" | "bad"; children: React.ReactNode }) {
  return <div className={`alert ${tone === "info" ? "info" : tone}`}>{children}</div>;
}

/** Згортана група фільтрів або налаштувань із лічильником активних умов. */
export function FilterGroup({ title, active = 0, open, children }: { title: string; active?: number; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="fg" open={open || active > 0}>
      <summary><span>{title}</span>{active > 0 && <span className="pill acc">{active}</span>}</summary>
      <div className="fg-b">{children}</div>
    </details>
  );
}
