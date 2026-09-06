import { STATUS } from "@/lib/format";

export function Pill({ status, children, tone }: { status?: string; children?: React.ReactNode; tone?: string }) {
  if (status) { const [label, t] = STATUS[status] ?? [status, ""]; return <span className={`pill ${t}`}>{label}</span>; }
  return <span className={`pill ${tone ?? ""}`}>{children}</span>;
}
export function Kpi({ title, value, note, tone, hot }: { title: string; value: React.ReactNode; note?: React.ReactNode; tone?: "up" | "down"; hot?: boolean }) {
  return (<div className={`card kpi ${hot ? "hot" : ""}`}><h3>{title}</h3><b>{value}</b>{note && <div className={`d ${tone ?? ""}`}>{note}</div>}</div>);
}
export function Empty({ children }: { children: React.ReactNode }) { return <p className="muted" style={{ padding: 12 }}>{children}</p>; }
