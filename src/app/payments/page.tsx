import Link from "next/link";
import { Receipt } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { Chips, Pager, Stat, EmptyState } from "@/components/ui/layout";
import { navCounts, paymentList } from "@/lib/queries";
import { dateTime, fullName, money } from "@/lib/format";

export const dynamic = "force-dynamic";
const CHIPS: [string, string][] = [["all", "Усі"], ["subscription_start", "Перші оплати"], ["subscription_renew", "Продовження"], ["one_time", "Разові"]];
const TYPE_UA: Record<string, string> = { subscription_start: "перша", subscription_renew: "продовження", one_time: "разова" };

export default async function Payments({ searchParams }: { searchParams: Promise<{ type?: string; page?: string }> }) {
  const sp = await searchParams; const type = sp.type ?? "all";
  const [counts, d] = await Promise.all([navCounts(), paymentList(Number(sp.page ?? 1), type)]);
  const uah = d.sum.find((s) => s.cur === "UAH"), usd = d.sum.find((s) => s.cur === "USD");
  return (
    <Shell title="Платежі" counts={counts}>
      <div className="grid g3" style={{ marginBottom: 16 }}>
        <Stat label="За 30 днів, UAH" value={money(uah?.sum ?? 0, "UAH")} hint={`${uah?.c ?? 0} платежів · WayForPay через ZenEdu`} tone="good" />
        <Stat label="За 30 днів, USD" value={money(usd?.sum ?? 0, "USD")} hint={`${usd?.c ?? 0} платежів`} />
        <Stat label="Усього замовлень" value={d.total} hint="імпортовано з ZenEdu" />
      </div>
      <Chips items={CHIPS.map(([k, l]) => ({ href: `?type=${k}`, label: l, on: type === k }))} />
      <div className="card tbl"><table><thead><tr><th>Дата</th><th>Людина</th><th>Оффер</th><th>Тип</th><th className="num">Сума</th><th>Спосіб</th><th>Статус</th></tr></thead><tbody>
        {d.rows.map(({ o, p }) => <tr key={o.id}><td className="mono">{dateTime(o.createdAt)}</td><td>{p ? <Link href={`/people/${p.id}`} className="lnk-ink">{fullName(p)}</Link> : "—"}</td><td className="muted">{o.offerName}</td><td>{TYPE_UA[o.type ?? ""] ?? o.type}</td><td className="num">{money(o.price, o.currency)}</td><td className="mono">{o.paymentSystem ?? "вручну"}</td><td><Pill tone={o.status === "paid" ? "good" : "warn"}>{o.status === "paid" ? "оплачено" : o.status}</Pill></td></tr>)}
        {!d.rows.length && <tr><td colSpan={7}><EmptyState icon={<Receipt size={20} />} title="Платежів немає" /></td></tr>}
      </tbody></table>
        <Pager page={d.page} total={d.total} per={d.per} href={(p) => `?type=${type}&page=${p}`} />
      </div>
    </Shell>
  );
}
