import Link from "next/link";
import { Receipt } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { Chips, Pager, Stat, EmptyState } from "@/components/ui/layout";
import { navCounts, paymentList, paymentAttemptList } from "@/lib/queries";
import { Kebab, MenuAction } from "@/components/ui/controls";
import { refundPayment } from "@/lib/actions";
import { Alert } from "@/components/ui/layout";
import { Undo2 } from "lucide-react";
import { dateTime, fullName, money } from "@/lib/format";

export const dynamic = "force-dynamic";
const CHIPS: [string, string][] = [["all", "Усі"], ["subscription_start", "Перші оплати"], ["subscription_renew", "Продовження"], ["one_time", "Разові"]];
const TYPE_UA: Record<string, string> = { subscription_start: "перша", subscription_renew: "продовження", one_time: "разова" };

const A_STATUS: Record<string, [string, string]> = { pending: ["очікує", "warn"], approved: ["оплачено", "good"], declined: ["відхилено", "crit"], expired: ["прострочено", "mute"], refunded: ["повернено", "moon"], error: ["помилка", "crit"] };
const A_KIND: Record<string, string> = { first: "перша оплата", renewal: "автосписання", manual: "поновлення", card: "зміна картки", migrate: "переїзд" };

export default async function Payments({ searchParams }: { searchParams: Promise<{ type?: string; page?: string; tab?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams; const type = sp.type ?? "all"; const tab = sp.tab === "hub" ? "hub" : "zen";
  const [counts, d, hub] = await Promise.all([navCounts(), paymentList(Number(sp.page ?? 1), type), tab === "hub" ? paymentAttemptList(Number(sp.page ?? 1)) : Promise.resolve(null)]);
  if (tab === "hub" && hub) return (
    <Shell title="Платежі" counts={counts}>
      <div className="tabs"><Link href="/payments">ZenEdu</Link><Link href="/payments?tab=hub" className="on">Hub · WayForPay</Link></div>
      {sp.ok && <Alert tone="ok">{sp.ok}</Alert>}{sp.err && <Alert tone="bad">{sp.err}</Alert>}
      <div className="grid g3" style={{ marginBottom: 16 }}>
        <Stat label="Бойових за 30 днів" value={money(hub.live30.s, "UAH")} hint={`${hub.live30.c} спроб`} tone="good" />
        <Stat label="Усього спроб" value={hub.total} hint="разом із тестовими" />
        <Stat label="Режим" value={<Link href="/settings?tab=payments">налаштування</Link>} hint="тестовий або бойовий" />
      </div>
      <div className="card tbl"><table><thead><tr><th>Коли</th><th>Людина</th><th>Тип</th><th>Тариф</th><th className="num">Сума</th><th>Картка</th><th>Стан</th><th></th></tr></thead><tbody>
        {hub.rows.map(({ a, p, plan }) => { const [l, t] = A_STATUS[a.status] ?? [a.status, ""]; return <tr key={a.id}><td className="mono">{dateTime(a.createdAt)}</td><td><Link href={`/people/${p.id}`} className="lnk-ink">{fullName(p)}</Link></td><td>{A_KIND[a.kind] ?? a.kind}{a.mode === "test" && <Pill tone="moon">тест</Pill>}</td><td className="muted">{plan ?? "—"}</td><td className="num">{money(a.amount, a.currency)}</td><td className="mono">{a.cardPan ?? "—"}</td><td><Pill tone={t}>{l}</Pill>{a.reason && a.status !== "approved" && <div className="fld-h">{a.reason}</div>}</td>
          <td>{a.status === "approved" && ["first", "renewal", "manual"].includes(a.kind) && <Kebab><MenuAction action={refundPayment} fields={{ id: a.id, back: "/payments?tab=hub" }} icon={<Undo2 />} danger confirm={`Повернути ${money(a.amount, a.currency)} на картку ${a.cardPan ?? ""}? Доступ за цей період варто закрити вручну.`}>Повернути кошти</MenuAction></Kebab>}</td></tr>; })}
        {!hub.rows.length && <tr><td colSpan={8}><EmptyState icon={<Receipt size={20} />} title="Платежів через Hub ще не було" text="Перевірте оплату в Налаштування → Оплати." /></td></tr>}
      </tbody></table><Pager page={hub.page} total={hub.total} per={hub.per} href={(p) => `?tab=hub&page=${p}`} /></div>
    </Shell>
  );
  const uah = d.sum.find((s) => s.cur === "UAH"), usd = d.sum.find((s) => s.cur === "USD");
  return (
    <Shell title="Платежі" counts={counts}>
      <div className="tabs"><Link href="/payments" className="on">ZenEdu</Link><Link href="/payments?tab=hub">Hub · WayForPay</Link></div>
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
