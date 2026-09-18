import Link from "next/link";
import { Receipt, Undo2, Download } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { Chips, Pager, Stat, EmptyState, Alert, Toolbar } from "@/components/ui/layout";
import { Kebab, MenuAction, AutoSubmitSelect } from "@/components/ui/controls";
import { navCounts, paymentList, paymentAttemptList, trialStats } from "@/lib/queries";
import { offerOptions } from "@/lib/offers";
import { refundPayment } from "@/lib/actions";
import { hasDb } from "@/db";
import { dateTime, fullName, money } from "@/lib/format";

export const dynamic = "force-dynamic";
const CHIPS: [string, string][] = [["all", "Усі"], ["subscription_start", "Перші оплати"], ["subscription_renew", "Продовження"], ["one_time", "Разові"], ["trial_to_paid", "Пробний → повна оплата"], ["trial_churn", "Пробний без продовження"]];
const TYPE_UA: Record<string, string> = { subscription_start: "перша", subscription_renew: "продовження", one_time: "разова" };
const A_STATUS: Record<string, [string, string]> = { pending: ["очікує", "warn"], approved: ["оплачено", "good"], declined: ["відхилено", "crit"], expired: ["прострочено", "mute"], refunded: ["повернено", "moon"], error: ["помилка", "crit"] };
const A_KIND: Record<string, string> = { first: "перша оплата", renewal: "автосписання", manual: "поновлення", card: "зміна картки", migrate: "переїзд" };

/** Платежі: замовлення ZenEdu і Hub з фільтром за типом і оффером, пробні періоди, експорт; окремо спроби WayForPay через Hub із поверненням. */
export default async function Payments({ searchParams }: { searchParams: Promise<{ type?: string; page?: string; tab?: string; ok?: string; err?: string; offer?: string }> }) {
  const sp = await searchParams; const type = sp.type ?? "all"; const tab = sp.tab === "hub" ? "hub" : "zen";
  const [counts, d, hub, offers, trial] = await Promise.all([navCounts(), paymentList(Number(sp.page ?? 1), type, sp.offer), tab === "hub" ? paymentAttemptList(Number(sp.page ?? 1)) : Promise.resolve(null), hasDb() ? offerOptions().catch(() => []) : [], trialStats(sp.offer)]);
  const qs = (o: Record<string, string | undefined>) => "?" + new URLSearchParams(Object.fromEntries(Object.entries({ type, offer: sp.offer, ...o }).filter(([, v]) => v)) as Record<string, string>).toString();
  if (tab === "hub" && hub) return (
    <Shell title="Платежі" counts={counts}>
      <div className="tabs"><Link href="/payments">Замовлення</Link><Link href="/payments?tab=hub" className="on">Спроби WayForPay через Hub</Link></div>
      {sp.ok && <Alert tone="ok">{sp.ok}</Alert>}{sp.err && <Alert tone="bad">{sp.err}</Alert>}
      <div className="grid g3" style={{ marginBottom: 16 }}>
        <Stat label="Бойових за 30 днів" value={money(hub.live30.s, "UAH")} hint={`${hub.live30.c} спроб`} tone="good" />
        <Stat label="Усього спроб" value={hub.total} hint="разом із тестовими" />
        <Stat label="Режим" value={<Link href="/settings?tab=payments">налаштування</Link>} hint="тестовий або бойовий" />
      </div>
      <p className="fld-h">Повернення можливе лише для платежів, проведених через Hub. Оплати, які приймав ZenEdu, повертаються в кабінеті WayForPay.</p>
      <div className="card tbl"><table><thead><tr><th>Коли</th><th>Людина</th><th>Тип</th><th>Оффер</th><th className="num">Сума</th><th>Картка</th><th>Стан</th><th></th></tr></thead><tbody>
        {hub.rows.map(({ a, p, plan }) => { const [l, t] = A_STATUS[a.status] ?? [a.status, ""]; return <tr key={a.id}><td className="mono">{dateTime(a.createdAt)}</td><td><Link href={`/people/${p.id}`} className="lnk-ink">{fullName(p)}</Link></td><td>{A_KIND[a.kind] ?? a.kind}{a.mode === "test" && <Pill tone="mute">тест</Pill>}</td><td>{plan ?? "—"}</td><td className="num">{money(a.amount, a.currency)}</td><td className="mono">{a.cardPan ?? "—"}</td><td><Pill tone={t}>{l}</Pill>{a.reason && a.status !== "approved" ? <div className="fld-h">{a.reason}</div> : null}</td>
          <td>{a.status === "approved" && ["first", "renewal", "manual"].includes(a.kind) && <Kebab><MenuAction action={refundPayment} fields={{ id: a.id, back: "/payments?tab=hub" }} icon={<Undo2 />} danger confirm={`Повернути ${money(a.amount, a.currency)} на картку ${a.cardPan ?? ""}?`}>Повернути кошти</MenuAction></Kebab>}</td></tr>; })}
        {!hub.rows.length && <tr><td colSpan={8}><EmptyState icon={<Receipt size={20} />} title="Платежів через Hub ще не було" text="Перевірте оплату в Налаштування → Оплати." /></td></tr>}
      </tbody></table><Pager page={hub.page} total={hub.total} per={hub.per} href={(p) => `?tab=hub&page=${p}`} /></div>
    </Shell>
  );
  const uah = d.sum.find((s) => s.cur === "UAH");
  const isTrial = type.startsWith("trial");
  return (
    <Shell title="Платежі" counts={counts}>
      <div className="tabs"><Link href="/payments" className="on">Замовлення</Link><Link href="/payments?tab=hub">Спроби WayForPay через Hub</Link></div>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="За 30 днів, UAH" value={money(uah?.sum ?? 0, "UAH")} hint={`${uah?.c ?? 0} платежів · усі оффери`} tone="good" />
        <Stat label="За фільтром" value={money(d.filteredSum, "UAH")} hint={`${d.total} замовлень`} />
        <Stat label="Пробний → оплата" value={trial.converted} hint={`з ${trial.started} пробних${sp.offer ? " за оффером" : ""}`} tone="good" />
        <Stat label="Пробний без продовження" value={trial.churned} hint="понад 40 днів без другої оплати" tone={trial.churned ? "warn" : undefined} />
      </div>
      <Toolbar actions={<a className="btn" href={"/api/export/payments" + qs({})}><Download size={15} /> Експорт CSV</a>}>
        <form method="get" className="row-actions">{type !== "all" && <input type="hidden" name="type" value={type} />}
          <AutoSubmitSelect name="offer" defaultValue={sp.offer ?? ""} className="btn" ariaLabel="Оффер"><option value="">Оффер: усі</option>{offers.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}</AutoSubmitSelect>
        </form>
      </Toolbar>
      <Chips items={CHIPS.map(([k, l]) => ({ href: qs({ type: k === "all" ? undefined : k, page: undefined }), label: l, on: type === k }))} />
      {isTrial && <p className="fld-h">Пробним вважається перший платіж, дешевший за ціну оффера. «Пробний → повна оплата» — друге замовлення після нього; «без продовження» — пробний понад 40 днів тому і жодної наступної оплати.</p>}
      <div className="card tbl"><table><thead><tr><th>Дата</th><th>Людина</th><th>Оффер</th><th>Тип</th><th className="num">Сума</th><th>Спосіб</th><th>Статус</th></tr></thead><tbody>
        {d.rows.map((o) => <tr key={o.id}><td className="mono">{dateTime(o.created_at)}</td><td>{o.pid ? <Link href={`/people/${o.pid}`} className="lnk-ink">{fullName({ firstName: o.first_name, lastName: o.last_name, username: o.username, telegramUserId: o.telegram_user_id ?? undefined })}</Link> : "—"}</td><td className="muted">{o.offer_name}{o.source === "hub" && <Pill tone="acc">Hub</Pill>}</td><td>{TYPE_UA[o.type ?? ""] ?? o.type}</td><td className="num">{money(o.price, o.currency)}</td><td className="mono">{o.payment_system ?? "—"}</td><td><Pill tone={o.status === "paid" ? "good" : o.status === "refunded" ? "moon" : "mute"}>{o.status}</Pill></td></tr>)}
        {!d.rows.length && <tr><td colSpan={7}><EmptyState icon={<Receipt size={20} />} title="Платежів немає" text="Змініть тип або оффер." /></td></tr>}
      </tbody></table>
        <Pager page={d.page} total={d.total} per={d.per} href={(p) => qs({ page: String(p) })} />
      </div>
    </Shell>
  );
}
