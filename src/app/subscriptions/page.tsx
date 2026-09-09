import Link from "next/link";
import { CreditCard } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { Chips, Pager, Stat, EmptyState } from "@/components/ui/layout";
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
        <Stat label="Active" value={(st.active ?? 0) + (st.past_due ?? 0)} hint="останній платіж у межах періоду" tone="good" />
        <Stat label="Trial" value={st.trialing ?? 0} hint="пробні 2 тижні" />
        <Stat label="Past due" value={st.past_due ?? 0} hint="ZenEdu робить 3 спроби через 2 дні" tone={st.past_due ? "warn" : undefined} />
        <Stat label="Expired / cancelled" value={(st.expired ?? 0) + (st.cancelled ?? 0)} hint="за весь час" />
      </div>
      <Chips items={CHIPS.map(([k, l]) => ({ href: `?status=${k}`, label: l, on: status === k }))} right={`${d.total} підписок`} />
      <div className="card tbl"><table><thead><tr><th>Людина</th><th>Оффер</th><th className="num">Ціна</th><th>Період</th><th>Статус</th><th>Наступне списання</th><th className="num">Оплат</th><th>Джерело</th></tr></thead><tbody>
        {d.rows.map(({ s, p, offerName }) => <tr key={s.id}><td><Link href={`/people/${p.id}`} className="lnk-ink">{fullName(p)}</Link></td><td className="muted">{offerName ?? "—"}</td><td className="num">{money(s.price, s.currency)}</td><td className="mono">{s.periodDays} дн</td><td><Pill status={s.status} /></td><td className="mono">{["active", "trialing", "past_due"].includes(s.status) ? date(s.currentPeriodEnd) : "—"}</td><td className="num">{s.paymentsCount}</td><td><Pill tone={s.source === "hub" ? "acc" : ""}>{s.source === "hub" ? "Hub" : "ZenEdu"}</Pill></td></tr>)}
        {!d.rows.length && <tr><td colSpan={8}><EmptyState icon={<CreditCard size={20} />} title="Підписок із таким статусом немає" /></td></tr>}
      </tbody></table>
        <Pager page={d.page} total={d.total} per={d.per} href={(p) => `?status=${status}&page=${p}`} />
      </div>
      <p className="fld-h" style={{ marginTop: 12 }}>Статуси виводяться з платежів ZenEdu: останній платіж плюс період оффера. Скасування приходять вебхуком ZenEdu, якщо його налаштовано.</p>
    </Shell>
  );
}
