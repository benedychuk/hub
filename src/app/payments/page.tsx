import Link from "next/link";
import Shell from "@/components/shell";
import { Kpi, Pill } from "@/components/ui";
import { navCounts, paymentList } from "@/lib/queries";
import { dateTime, fullName, money } from "@/lib/format";

export const dynamic = "force-dynamic";
const CHIPS: [string, string][] = [["all", "Усі"], ["subscription_start", "Перші"], ["subscription_renew", "Продовження"], ["one_time", "Разові"]];

export default async function Payments({ searchParams }: { searchParams: Promise<{ type?: string; page?: string }> }) {
  const sp = await searchParams; const type = sp.type ?? "all";
  const [counts, d] = await Promise.all([navCounts(), paymentList(Number(sp.page ?? 1), type)]);
  const uah = d.sum.find((s) => s.cur === "UAH"), usd = d.sum.find((s) => s.cur === "USD");
  return (
    <Shell title="Платежі" counts={counts}>
      <div className="grid g3" style={{ marginBottom: 16 }}>
        <Kpi hot title="За 30 днів, UAH" value={money(uah?.sum ?? 0, "UAH")} note={`${uah?.c ?? 0} платежів · WayForPay через ZenEdu`} />
        <Kpi title="За 30 днів, USD" value={money(usd?.sum ?? 0, "USD")} note={`${usd?.c ?? 0} платежів`} />
        <Kpi title="Усього замовлень" value={d.total} note="імпортовано з ZenEdu" />
      </div>
      <div className="chips">{CHIPS.map(([k, l]) => <Link key={k} className={`chip ${type === k ? "on" : ""}`} href={`?type=${k}`}>{l}</Link>)}</div>
      <div className="card tbl"><table><thead><tr><th>Дата</th><th>Людина</th><th>Оффер</th><th>Тип</th><th className="num">Сума</th><th>Спосіб</th><th>Статус</th></tr></thead><tbody>
        {d.rows.map(({ o, p }) => <tr key={o.id}><td className="mono">{dateTime(o.createdAt)}</td><td>{p ? <Link href={`/people/${p.id}`}>{fullName(p)}</Link> : "—"}</td><td className="muted">{o.offerName}</td><td className="mono">{o.type}</td><td className="num">{money(o.price, o.currency)}</td><td className="mono">{o.paymentSystem ?? "вручну"}</td><td><Pill tone={o.status === "paid" ? "good" : "warn"}>{o.status}</Pill></td></tr>)}
        {!d.rows.length && <tr><td colSpan={7} className="muted">Порожньо.</td></tr>}
      </tbody></table>
        <div className="pager">{d.page > 1 && <Link className="btn sm" href={`?type=${type}&page=${d.page - 1}`}>← Назад</Link>}<span className="muted">сторінка {d.page} з {Math.max(1, Math.ceil(d.total / d.per))}</span>{d.page * d.per < d.total && <Link className="btn sm" href={`?type=${type}&page=${d.page + 1}`}>Далі →</Link>}</div>
      </div>
    </Shell>
  );
}
