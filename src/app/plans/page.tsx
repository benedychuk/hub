import Link from "next/link";
import { Plus, Pencil, Copy, Trash2, Package, ExternalLink } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { Section, EmptyState, Toolbar } from "@/components/ui/layout";
import { Kebab, MenuAction, MenuLink, MenuSep } from "@/components/ui/controls";
import { navCounts, planList, offerList, resourceList } from "@/lib/queries";
import { money, PERIOD } from "@/lib/format";
import { deletePlan, duplicatePlan } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function Plans({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams; const tab = sp.tab === "offers" ? "offers" : "plans";
  const [counts, plans, offers, res] = await Promise.all([navCounts(), planList(), offerList(), resourceList()]);
  const rname = (k: string) => res.find((r) => r.key === k)?.name ?? k;
  return (
    <Shell title="Тарифи й оффери" counts={counts}>
      <div className="tabs"><Link href="/plans" className={tab === "plans" ? "on" : ""}>Тарифи Hub · {plans.length}</Link><Link href="/plans?tab=offers" className={tab === "offers" ? "on" : ""}>Оффери ZenEdu · {offers.length}</Link></div>
      {tab === "plans" && <>
        <Toolbar actions={<Link className="btn pri" href="/plans/new"><Plus size={15} /> Новий тариф</Link>}><p className="fld-h" style={{ margin: 0 }}>Тариф визначає ціну, період і які продукти отримує людина. Показується в Hub-боті за командою /plans.</p></Toolbar>
        {plans.length ? (
          <div className="grid g3">{plans.map((pl) => (
            <div key={pl.id} className={`card plan-card ${pl.isFeatured ? "plan hi" : ""}`}>
              <div className="row-actions" style={{ flexWrap: "nowrap" }}><b style={{ flex: 1, fontSize: 15 }}>{pl.name}</b>{!pl.isActive ? <Pill tone="mute">вимкнено</Pill> : pl.isFeatured ? <Pill tone="acc">рекомендований</Pill> : null}
                <Kebab><MenuLink href={`/plans/${pl.id}`} icon={<Pencil />}>Редагувати</MenuLink><MenuAction action={duplicatePlan} fields={{ id: pl.id }} icon={<Copy />}>Дублювати</MenuAction><MenuSep /><MenuAction action={deletePlan} fields={{ id: pl.id }} icon={<Trash2 />} danger confirm={`Видалити тариф «${pl.name}»? Чинні підписки не зміняться.`}>Видалити</MenuAction></Kebab></div>
              <div className="price">{money(pl.price, pl.currency)} <small>/ {PERIOD[pl.period] ?? pl.period}</small></div>
              <div className="fld-h">пробний період: {pl.trialDays ? `${pl.trialDays} дн${pl.trialPrice ? " за " + money(pl.trialPrice, pl.currency) : ""}` : "немає"} · код {pl.key}</div>
              <ul>{Object.entries(pl.entitlements).map(([k, v]) => <li key={k}><span>{rname(k)}</span><span className="muted">{v || ""}</span></li>)}{!Object.keys(pl.entitlements).length && <li className="muted">без продуктів</li>}</ul>
            </div>))}</div>
        ) : <div className="card"><EmptyState icon={<Package size={20} />} title="Тарифів ще немає" text={res.length ? "Створіть перший: він з’явиться у Hub-боті за командою /plans." : "Спершу підключіть канали або цифрові продукти, щоб додати їх до тарифу."} action={<Link className="btn pri" href="/plans/new"><Plus size={15} /> Новий тариф</Link>} /></div>}
      </>}
      {tab === "offers" && (
        <Section title="Оффери ZenEdu" description="Імпорт із ZenEdu, лише для читання. Використовуються у фільтрах розсилок і кнопках оплати." className="tbl">
          <table><thead><tr><th>Оффер</th><th className="num">Ціна</th><th>Тип</th><th className="num">Активних підписок</th><th className="num">Продажів</th><th>Стан</th><th>Посилання</th></tr></thead><tbody>
            {offers.map(({ o, active, sales }) => <tr key={o.id}><td>{o.name}</td><td className="num">{money(o.price, o.currency)}</td><td>{o.isSubscription ? "підписка" : "разово"}</td><td className="num">{active}</td><td className="num">{sales}</td><td><Pill tone={o.isActive ? "good" : "mute"}>{o.isActive ? "активний" : "вимкнено"}</Pill></td><td className="row-actions">{o.link && <a className="btn sm ghost" href={o.link} target="_blank" rel="noreferrer"><ExternalLink size={13} /> бот</a>}{o.landingLink && <a className="btn sm ghost" href={o.landingLink} target="_blank" rel="noreferrer"><ExternalLink size={13} /> лендінг</a>}</td></tr>)}
            {!offers.length && <tr><td colSpan={7}><EmptyState title="Ще не імпортовано" text="Запустіть імпорт у Налаштуваннях." /></td></tr>}
          </tbody></table>
        </Section>
      )}
    </Shell>
  );
}
