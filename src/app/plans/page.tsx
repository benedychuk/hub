import Link from "next/link";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { navCounts, planList, offerList, resourceList } from "@/lib/queries";
import { money, PERIOD } from "@/lib/format";
import { deletePlan, duplicatePlan } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function Plans() {
  const [counts, plans, offers, res] = await Promise.all([navCounts(), planList(), offerList(), resourceList()]);
  const rname = (k: string) => res.find((r) => r.key === k)?.name ?? k;
  return (
    <Shell title="Тарифи й оффери" counts={counts}>
      <div className="hdr"><h2>Тарифи Hub</h2><Link className="btn pri" href="/plans/new">+ Новий тариф</Link></div>
      {plans.length ? (
        <div className="grid g3" style={{ marginBottom: 24 }}>{plans.map((pl) => (
          <div key={pl.id} className={`plan ${pl.isFeatured ? "hi" : ""}`}>
            <div className="hdr" style={{ marginBottom: 6 }}><h2>{pl.name}</h2>{!pl.isActive ? <Pill tone="mute">вимкнено</Pill> : pl.isFeatured ? <Pill tone="acc">рекомендований</Pill> : null}</div>
            <div className="price">{money(pl.price, pl.currency)} <small>/ {PERIOD[pl.period] ?? pl.period}</small></div>
            <div className="mono muted" style={{ marginTop: 4 }}>пробний: {pl.trialDays ? `${pl.trialDays} дн${pl.trialPrice ? " за " + money(pl.trialPrice, pl.currency) : ""}` : "—"} · код {pl.key}</div>
            <ul>{Object.entries(pl.entitlements).map(([k, v]) => <li key={k}><span>{rname(k)}{v ? " · " + v : ""}</span><code>{k}</code></li>)}{!Object.keys(pl.entitlements).length && <li className="muted">без прав</li>}</ul>
            <div className="row-actions"><Link className="btn sm" href={`/plans/${pl.id}`}>Редагувати</Link>
              <form action={duplicatePlan}><input type="hidden" name="id" value={pl.id} /><button className="btn sm ghost" type="submit">Копія</button></form>
              <form action={deletePlan}><input type="hidden" name="id" value={pl.id} /><button className="btn sm danger" type="submit">Видалити</button></form></div>
          </div>))}</div>
      ) : <div className="alert">Тарифів ще немає. Створіть перший: він з'явиться у Hub-боті за командою /plans. {!res.length && <>Спершу створіть ресурси у розділі <Link href="/resources">Доступи</Link>, щоб додати права до тарифу.</>}</div>}
      <div className="hdr"><h2>Оффери ZenEdu</h2><span className="muted">лише читання · імпорт із ZenEdu</span></div>
      <div className="card tbl"><table><thead><tr><th>Оффер</th><th className="num">Ціна</th><th>Тип</th><th className="num">Активних підписок</th><th className="num">Продажів</th><th>Стан</th><th>Посилання</th></tr></thead><tbody>
        {offers.map(({ o, active, sales }) => <tr key={o.id}><td>{o.name}</td><td className="num">{money(o.price, o.currency)}</td><td className="mono">{o.isSubscription ? "підписка" : "разово"}</td><td className="num">{active}</td><td className="num">{sales}</td><td><Pill tone={o.isActive ? "good" : "mute"}>{o.isActive ? "активний" : "вимкнено"}</Pill></td><td className="mono">{o.link ? <a href={o.link} target="_blank" rel="noreferrer">бот</a> : ""}{o.landingLink ? <> · <a href={o.landingLink} target="_blank" rel="noreferrer">лендінг</a></> : ""}</td></tr>)}
        {!offers.length && <tr><td colSpan={7} className="muted">Ще не імпортовано.</td></tr>}
      </tbody></table></div>
    </Shell>
  );
}
