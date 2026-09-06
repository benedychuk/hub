import Link from "next/link";
import Shell from "@/components/shell";
import { Kpi, Pill } from "@/components/ui";
import { navCounts, subscriptionList } from "@/lib/queries";
import { date, fullName, money } from "@/lib/format";

export const dynamic = "force-dynamic";
const CHIPS: [string, string][] = [["active_all", "Активні"], ["active", "Active"], ["trialing", "Trial"], ["past_due", "Past due"], ["paused", "Paused"], ["cancelled", "Cancelled"], ["expired", "Expired"], ["all", "Усі"]];

export default async function Subs({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const sp = await searchParams; const status = sp.status ?? "active_all";
  const [counts, d] = await Promise.all([navCounts(), subscriptionList(status, Number(sp.page ?? 1))]);
  const st = Object.fromEntries(d.byStatus.map((x) => [x.status, x.c]));
  return (
    <Shell title="Підписки" counts={counts}>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi hot title="Active" value={(st.active ?? 0) + (st.past_due ?? 0)} note="за останнім платежем у межах періоду" />
        <Kpi title="Trial" value={st.trialing ?? 0} note="пробні 2 тижні" />
        <Kpi title="Past due" value={st.past_due ?? 0} note="у ZenEdu: 3 спроби через 2 дні" />
        <Kpi title="Expired / cancelled" value={(st.expired ?? 0) + (st.cancelled ?? 0)} note="за весь час" />
      </div>
      <div className="chips">{CHIPS.map(([k, l]) => <Link key={k} className={`chip ${status === k ? "on" : ""}`} href={`?status=${k}`}>{l}</Link>)}<span className="muted" style={{ marginLeft: "auto" }}>{d.total}</span></div>
      <div className="card tbl"><table><thead><tr><th>Людина</th><th>Оффер</th><th className="num">Ціна</th><th>Період</th><th>Статус</th><th>Наступне списання</th><th className="num">Оплат</th><th>Джерело</th></tr></thead><tbody>
        {d.rows.map(({ s, p, offerName }) => <tr key={s.id}><td><Link href={`/people/${p.id}`}>{fullName(p)}</Link></td><td className="muted">{offerName ?? "—"}</td><td className="num">{money(s.price, s.currency)}</td><td className="mono">{s.periodDays} дн</td><td><Pill status={s.status} /></td><td className="mono">{["active", "trialing", "past_due"].includes(s.status) ? date(s.currentPeriodEnd) : "—"}</td><td className="num">{s.paymentsCount}</td><td><Pill tone={s.source === "hub" ? "acc" : ""}>{s.source === "hub" ? "Hub" : "ZenEdu"}</Pill></td></tr>)}
        {!d.rows.length && <tr><td colSpan={8} className="muted">Порожньо.</td></tr>}
      </tbody></table>
        <div className="pager">{d.page > 1 && <Link className="btn sm" href={`?status=${status}&page=${d.page - 1}`}>← Назад</Link>}<span className="muted">сторінка {d.page} з {Math.max(1, Math.ceil(d.total / d.per))}</span>{d.page * d.per < d.total && <Link className="btn sm" href={`?status=${status}&page=${d.page + 1}`}>Далі →</Link>}</div>
      </div>
      <p className="note">Статуси виводяться з платежів ZenEdu: останній платіж плюс період оффера. Скасування приходять вебхуком ZenEdu, якщо його налаштовано.</p>
    </Shell>
  );
}
