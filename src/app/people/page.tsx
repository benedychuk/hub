import Link from "next/link";
import { X, Users, Download, GitBranch, Gift, Tag } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { Chips, Pager, EmptyState, Alert, Toolbar } from "@/components/ui/layout";
import { AutoSubmitSelect } from "@/components/ui/controls";
import { SelectAll } from "@/components/select-all";
import { navCounts, people, hubFunnels, productPicker } from "@/lib/queries";
import { offerOptions } from "@/lib/offers";
import { bulkPeople } from "@/lib/actions";
import { hasDb } from "@/db";
import { date, fullName, money } from "@/lib/format";

export const dynamic = "force-dynamic";
const CHIPS: [string, string][] = [["", "Усі"], ["active", "З активною підпискою"], ["trialing", "Пробний"], ["past_due", "Прострочені"], ["expired", "Пішли"], ["none", "Без підписки"], ["hub", "Запустили Hub-бот"]];
const SORTS: [string, string][] = [["activity", "За активністю"], ["joined", "За датою запуску бота"], ["payments", "За кількістю оплат"], ["name", "За імʼям"]];
type SP = { q?: string; status?: string; page?: string; tag?: string; offer?: string; product?: string; sort?: string; ok?: string };

/** Люди: фільтри за підпискою, оффером, продуктом і тегом; сортування; масові дії з обраними; експорт у CSV. */
export default async function People({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const f = { q: sp.q, status: sp.status, page: Number(sp.page ?? 1), tag: sp.tag, offer: sp.offer, product: Number(sp.product ?? 0) || undefined, sort: sp.sort };
  const [counts, data, offers, funnels, products] = await Promise.all([navCounts(), people(f), hasDb() ? offerOptions().catch(() => []) : [], hubFunnels(), productPicker()]);
  const qs = (o: Record<string, string | undefined>) => "?" + new URLSearchParams(Object.fromEntries(Object.entries({ ...sp, ...o, ok: undefined }).filter(([, v]) => v)) as Record<string, string>).toString();
  const exportHref = "/api/export/people" + qs({ page: undefined });
  const activeFilters = [sp.offer && `оффер`, sp.product && `продукт`, sp.tag && `тег`].filter(Boolean).length;
  return (
    <Shell title="Люди" counts={counts}>
      {sp.ok && <Alert tone="ok">{sp.ok}</Alert>}
      <Chips items={[
        ...CHIPS.map(([k, l]) => ({ href: qs({ status: k || undefined, page: undefined }), label: l, on: (sp.status ?? "") === k })),
        ...(sp.tag ? [{ href: qs({ tag: undefined }), label: <>тег: {sp.tag} <X size={12} /></>, on: true }] : []),
        ...(sp.q ? [{ href: qs({ q: undefined }), label: <>пошук: {sp.q} <X size={12} /></>, on: true }] : []),
      ]} right={`${data.total.toLocaleString("uk-UA")} людей`} />
      <Toolbar actions={<a className="btn" href={exportHref}><Download size={15} /> Експорт CSV</a>}>
        <form method="get" className="row-actions">
          {sp.q && <input type="hidden" name="q" value={sp.q} />}{sp.status && <input type="hidden" name="status" value={sp.status} />}{sp.tag && <input type="hidden" name="tag" value={sp.tag} />}
          <AutoSubmitSelect name="offer" defaultValue={sp.offer ?? ""} className="btn" ariaLabel="Оффер"><option value="">Оффер: будь-який</option>{offers.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}</AutoSubmitSelect>
          <AutoSubmitSelect name="product" defaultValue={sp.product ?? ""} className="btn" ariaLabel="Продукт"><option value="">Продукт: будь-який</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</AutoSubmitSelect>
          <AutoSubmitSelect name="sort" defaultValue={sp.sort ?? "activity"} className="btn" ariaLabel="Сортування">{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</AutoSubmitSelect>
          {activeFilters > 0 && <Link href={qs({ offer: undefined, product: undefined, tag: undefined, page: undefined })} className="btn ghost sm"><X size={14} /> Скинути</Link>}
        </form>
      </Toolbar>
      <form action={bulkPeople} id="bulk"><input type="hidden" name="back" value={"/people" + qs({ page: sp.page })} /></form>
      <div className="card tbl"><table><thead><tr><th style={{ width: 28 }}><SelectAll /></th><th>Людина</th><th>Telegram</th><th>Підписка</th><th className="num">Ціна</th><th>До</th><th>Джерело</th><th className="num">Оплат</th><th>Hub-бот</th><th>Активність</th></tr></thead><tbody>
        {data.rows.map(({ p, subStatus, subPrice, subCur, subEnd, subSource, hubStarted, paid }) => (
          <tr key={p.id} className="row"><td><input type="checkbox" name="ids" value={p.id} form="bulk" aria-label={`Обрати ${fullName(p)}`} /></td><td><Link href={`/people/${p.id}`} className="lnk-ink">{fullName(p)}</Link><div className="tags">{(p.tags ?? []).slice(0, 4).map((t) => <Link key={t} className="tag" href={qs({ tag: t })}>{t}</Link>)}</div></td>
            <td className="mono">{p.username ? "@" + p.username : <span className="muted">tg {p.telegramUserId}</span>}</td><td><Pill status={subStatus ?? "none"} /></td><td className="num">{subPrice ? money(subPrice, subCur) : "—"}</td><td className="mono">{subStatus && ["active", "trialing", "past_due"].includes(subStatus) ? date(subEnd) : "—"}</td>
            <td>{subSource ? <Pill tone={subSource === "hub" ? "acc" : ""}>{subSource === "hub" ? "Hub" : "ZenEdu"}</Pill> : ""}</td><td className="num">{paid}</td><td className="mono">{hubStarted ? date(hubStarted) : "—"}</td><td className="mono">{date(p.lastActiveAt)}</td></tr>))}
        {!data.rows.length && <tr><td colSpan={10}><EmptyState icon={<Users size={20} />} title="Нікого не знайдено" text="Змініть фільтр або пошуковий запит." /></td></tr>}
      </tbody></table>
        <Pager page={data.page} total={data.total} per={data.per} href={(p) => qs({ page: String(p) })} />
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="row-actions" style={{ flexWrap: "wrap", gap: 10 }}>
          <b>З обраними на сторінці:</b>
          <button className="btn sm" type="submit" form="bulk" name="act" value="funnel" title="Додати обраних у воронку"><GitBranch size={14} /> У воронку</button>
          <select name="funnelId" form="bulk" className="input" style={{ width: 220 }} aria-label="Воронка">{funnels.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <span className="rte-sep" />
          <button className="btn sm" type="submit" form="bulk" name="act" value="offer" title="Відкрити доступ за оффером без оплати"><Gift size={14} /> Дати доступ</button>
          <select name="planId" form="bulk" className="input" style={{ width: 220 }} aria-label="Оффер Hub">{offers.filter((o) => o.group === "hub").map((o) => <option key={o.key} value={o.key.slice(2)}>{o.name}</option>)}</select>
          <span className="rte-sep" />
          <button className="btn sm" type="submit" form="bulk" name="act" value="tag" title="Поставити тег обраним"><Tag size={14} /> Тег</button>
          <input name="tag" form="bulk" className="input" style={{ width: 180 }} placeholder="назва тега" aria-label="Тег" />
        </div>
        <p className="fld-h" style={{ margin: "8px 0 0" }}>Дії стосуються лише позначених людей на цій сторінці (до 50). Воронка отримає їх як «додано вручну»; доступ за оффером не списує гроші й діє за правилами оффера.</p>
      </div>
    </Shell>
  );
}
