import Link from "next/link";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { navCounts, people } from "@/lib/queries";
import { date, fullName, money } from "@/lib/format";

export const dynamic = "force-dynamic";
const CHIPS: [string, string][] = [["", "Усі"], ["active", "З активною підпискою"], ["trialing", "Пробний"], ["past_due", "Прострочені"], ["expired", "Пішли"], ["none", "Без підписки"], ["hub", "Запустили Hub-бот"]];

export default async function People({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string; tag?: string }> }) {
  const sp = await searchParams;
  const [counts, data] = await Promise.all([navCounts(), people({ q: sp.q, status: sp.status, page: Number(sp.page ?? 1), tag: sp.tag })]);
  const qs = (o: Record<string, string | undefined>) => "?" + new URLSearchParams(Object.fromEntries(Object.entries({ ...sp, ...o }).filter(([, v]) => v)) as Record<string, string>).toString();
  return (
    <Shell title="Аудиторія" counts={counts}>
      <div className="chips">{CHIPS.map(([k, l]) => <Link key={k} className={`chip ${(sp.status ?? "") === k ? "on" : ""}`} href={qs({ status: k || undefined, page: undefined })}>{l}</Link>)}
        {sp.tag && <Link className="chip on" href={qs({ tag: undefined })}>тег: {sp.tag} ✕</Link>}
        {sp.q && <Link className="chip on" href={qs({ q: undefined })}>пошук: {sp.q} ✕</Link>}
        <span className="muted" style={{ marginLeft: "auto" }}>{data.total.toLocaleString("uk-UA")} людей</span></div>
      <div className="card tbl"><table><thead><tr><th>Людина</th><th>Telegram</th><th>Підписка</th><th className="num">Ціна</th><th>До</th><th>Джерело</th><th>Активність</th></tr></thead><tbody>
        {data.rows.map(({ p, subStatus, subPrice, subCur, subEnd, subSource }) => (
          <tr key={p.id} className="row"><td><Link href={`/people/${p.id}`} style={{ fontWeight: 500, color: "var(--ink)", textDecoration: "none" }}>{fullName(p)}</Link><div className="tags">{(p.tags ?? []).slice(0, 4).map((t) => <Link key={t} className="tag" href={qs({ tag: t })}>{t}</Link>)}</div></td>
            <td className="mono">{p.username ? "@" + p.username : <span className="muted">tg {p.telegramUserId}</span>}</td><td><Pill status={subStatus ?? "none"} /></td><td className="num">{subPrice ? money(subPrice, subCur) : "—"}</td><td className="mono">{subStatus && ["active", "trialing", "past_due"].includes(subStatus) ? date(subEnd) : "—"}</td>
            <td>{subSource ? <Pill tone={subSource === "hub" ? "acc" : ""}>{subSource === "hub" ? "Hub" : "ZenEdu"}</Pill> : ""}</td><td className="mono">{date(p.lastActiveAt)}</td></tr>))}
        {!data.rows.length && <tr><td colSpan={7} className="muted">Нікого не знайдено.</td></tr>}
      </tbody></table>
        <div className="pager">{data.page > 1 && <Link className="btn sm" href={qs({ page: String(data.page - 1) })}>← Назад</Link>}<span className="muted">сторінка {data.page} з {Math.max(1, Math.ceil(data.total / data.per))}</span>{data.page * data.per < data.total && <Link className="btn sm" href={qs({ page: String(data.page + 1) })}>Далі →</Link>}</div>
      </div>
    </Shell>
  );
}
