import Link from "next/link";
import { Plus, Pencil, Copy, Trash2, Tag, Link2, Eye, Play, Pause, DollarSign, Repeat } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { Toolbar, EmptyState, Chips } from "@/components/ui/layout";
import { Kebab, MenuAction, MenuLink, MenuSep } from "@/components/ui/controls";
import { navCounts, hubOfferList, offerList } from "@/lib/queries";
import { setOfferStatus, duplicateOffer, deleteOffer } from "@/lib/actions";
import { money } from "@/lib/format";
import { priceLabel, accessLabel } from "@/lib/offers";

export const dynamic = "force-dynamic";
type SP = { src?: string; q?: string; status?: string };

/** Оффери (ZenEdu Sales → Offers): що продається, за яку ціну і що дає. Hub-оффери редагуються; ZenEdu — імпорт для довідки й фільтрів. */
export default async function Offers({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [counts, hub, zen] = await Promise.all([navCounts(), hubOfferList(), offerList()]);
  const src = sp.src === "zen" ? "zen" : "hub"; const q = (sp.q ?? "").trim().toLowerCase(); const status = sp.status ?? "";
  const link = (p: Partial<SP>) => { const u = new URLSearchParams(); const all = { ...sp, ...p }; for (const [k, v] of Object.entries(all)) if (v) u.set(k, String(v)); const s = u.toString(); return "/offers" + (s ? "?" + s : ""); };
  const hubRows = hub.filter((r) => (!q || r.pl.name.toLowerCase().includes(q)) && (!status || (status === "active" ? r.pl.isActive : !r.pl.isActive)));
  const zenRows = zen.filter((r) => (!q || r.o.name.toLowerCase().includes(q)) && (!status || (status === "active" ? r.o.isActive : !r.o.isActive)));
  return (
    <Shell title="Оффери" counts={counts}>
      <div className="tabs"><Link href={link({ src: "" })} className={src === "hub" ? "on" : ""}>Hub · {hub.length}</Link><Link href={link({ src: "zen" })} className={src === "zen" ? "on" : ""}>ZenEdu · {zen.length}</Link></div>
      <Toolbar actions={src === "hub" ? <Link className="btn pri" href="/offers/new"><Plus size={15} /> Оффер</Link> : undefined}>
        <form className="search" method="get"><input name="q" defaultValue={sp.q ?? ""} placeholder="Пошук оффера" />{sp.src && <input type="hidden" name="src" value={sp.src} />}{sp.status && <input type="hidden" name="status" value={sp.status} />}</form>
        <Chips items={[{ href: link({ status: "" }), label: "Усі", on: !status }, { href: link({ status: "active" }), label: "Активні", on: status === "active" }, { href: link({ status: "stopped" }), label: "Зупинені", on: status === "stopped" }]} />
      </Toolbar>
      {src === "hub" && <div className="card tbl">
        <table><thead><tr><th>Оффер</th><th className="num">Ціна</th><th className="num">Оплати й доступи</th><th className="num">Дохід</th><th>Продукти</th><th>Статус</th><th></th></tr></thead><tbody>
          {hubRows.map((r) => { const pl = r.pl; return <tr key={pl.id}>
            <td><div className="row-actions" style={{ flexWrap: "nowrap" }}>{pl.paymentType === "one_time" ? <DollarSign size={14} className="muted" /> : <Repeat size={14} className="muted" />}<div><Link href={`/offers/${pl.id}`} className="lnk-ink">{pl.name}</Link><div className="fld-h">{pl.paymentType === "one_time" ? `разово · доступ ${accessLabel(pl)}` : `підписка${pl.trialDays ? ` · пробний ${pl.trialDays} дн` : ""}`}{pl.isFeatured ? " · рекомендований" : ""}{!pl.showInBot ? " · не показується в /plans" : ""}{pl.spotsLimit ? ` · місць ${r.spots}/${pl.spotsLimit}` : ""}</div></div></div></td>
            <td className="num">{priceLabel(pl)}</td>
            <td className="num">{r.payments}{r.grants ? ` + ${r.grants}` : ""}{r.active ? <div className="fld-h">активних {r.active}</div> : null}</td>
            <td className="num">{money(r.revenue, pl.currency)}</td>
            <td>{[...r.productNames, ...r.resourceNames].length ? [...r.productNames, ...r.resourceNames].map((n, i) => <div key={i} className={i ? "fld-h" : undefined}>{n}</div>) : <span className="muted">нічого не дає</span>}</td>
            <td><Pill tone={pl.isActive ? "good" : "mute"}>{pl.isActive ? "активний" : "зупинений"}</Pill></td>
            <td><Kebab>
              <MenuLink href={`/offers/${pl.id}?tab=links`} icon={<Link2 />}>Посилання</MenuLink>
              <MenuLink href={`/pay/${encodeURIComponent(pl.key)}?preview=1`} icon={<Eye />} external>Перегляд сторінки оплати</MenuLink>
              <MenuAction action={setOfferStatus} fields={{ id: pl.id, status: pl.isActive ? "stopped" : "active" }} icon={pl.isActive ? <Pause /> : <Play />}>{pl.isActive ? "Зупинити" : "Активувати"}</MenuAction>
              <MenuLink href={`/offers/${pl.id}`} icon={<Pencil />}>Редагувати</MenuLink>
              <MenuAction action={duplicateOffer} fields={{ id: pl.id }} icon={<Copy />}>Дублювати</MenuAction>
              <MenuSep />
              <MenuAction action={deleteOffer} fields={{ id: pl.id }} icon={<Trash2 />} danger confirm={`Видалити оффер «${pl.name}»? Чинні підписки залишаться, але втратять зв’язок з оффером.`}>Видалити</MenuAction>
            </Kebab></td>
          </tr>; })}
          {!hubRows.length && <tr><td colSpan={7}><EmptyState icon={<Tag size={20} />} title={q || status ? "Нічого не знайдено" : "Офферів Hub ще немає"} text={q || status ? "Змініть пошук або фільтр." : "Оффер задає ціну, тип оплати й що отримує людина: цифрові продукти, канали, групи. Він показується в боті за /plans і в кнопках воронок та розсилок."} action={!q && !status ? <Link className="btn pri" href="/offers/new"><Plus size={15} /> Створити оффер</Link> : undefined} /></td></tr>}
        </tbody></table>
      </div>}
      {src === "zen" && <div className="card tbl">
        <table><thead><tr><th>Оффер</th><th className="num">Ціна</th><th className="num">Активних підписок</th><th className="num">Продажів</th><th>Стан</th><th>Посилання</th></tr></thead><tbody>
          {zenRows.map(({ o, active, sales }) => <tr key={o.id}><td><div className="row-actions" style={{ flexWrap: "nowrap" }}>{o.isSubscription ? <Repeat size={14} className="muted" /> : <DollarSign size={14} className="muted" />}<div>{o.name}<div className="fld-h">{o.isSubscription ? "підписка" : "разово"} · ZenEdu</div></div></div></td><td className="num">{money(o.price, o.currency)}</td><td className="num">{active}</td><td className="num">{sales}</td><td><Pill tone={o.isActive ? "good" : "mute"}>{o.isActive ? "активний" : "зупинений"}</Pill></td><td>{o.link ? <a href={o.link} target="_blank" rel="noreferrer" className="lnk">оплата</a> : "—"}{o.landingLink ? <> · <a href={o.landingLink} target="_blank" rel="noreferrer" className="lnk">лендінг</a></> : null}</td></tr>)}
          {!zenRows.length && <tr><td colSpan={6}><EmptyState title="Ще не імпортовано" text="Запустіть імпорт у Налаштуваннях. Оффери ZenEdu лише для читання: вони використовуються у фільтрах розсилок і кнопках." /></td></tr>}
        </tbody></table>
      </div>}
    </Shell>
  );
}
