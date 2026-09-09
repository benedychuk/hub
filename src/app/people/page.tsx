import Link from "next/link";
import { X, Users } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { Chips, Pager, EmptyState } from "@/components/ui/layout";
import { navCounts, people } from "@/lib/queries";
import { date, fullName, money } from "@/lib/format";

export const dynamic = "force-dynamic";
const CHIPS: [string, string][] = [["", "Усі"], ["active", "З активною підпискою"], ["trialing", "Пробний"], ["past_due", "Прострочені"], ["expired", "Пішли"], ["none", "Без підписки"], ["hub", "Запустили Hub-бот"]];

export default async function People({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string; tag?: string }> }) {
  const sp = await searchParams;
  const [counts, data] = await Promise.all([navCounts(), people({ q: sp.q, status: sp.status, page: Number(sp.page ?? 1), tag: sp.tag })]);
  const qs = (o: Record<string, string | undefined>) => "?" + new URLSearchParams(Object.fromEntries(Object.entries({ ...sp, ...o }).filter(([, v]) => v)) as Record<string, string>).toString();
  return (
    <Shell title="Люди" counts={counts}>
      <Chips items={[
        ...CHIPS.map(([k, l]) => ({ href: qs({ status: k || undefined, page: undefined }), label: l, on: (sp.status ?? "") === k })),
        ...(sp.tag ? [{ href: qs({ tag: undefined }), label: <>тег: {sp.tag} <X size={12} /></>, on: true }] : []),
        ...(sp.q ? [{ href: qs({ q: undefined }), label: <>пошук: {sp.q} <X size={12} /></>, on: true }] : []),
      ]} right={`${data.total.toLocaleString("uk-UA")} людей`} />
      <div className="card tbl"><table><thead><tr><th>Людина</th><th>Telegram</th><th>Підписка</th><th className="num">Ціна</th><th>До</th><th>Джерело</th><th>Активність</th></tr></thead><tbody>
        {data.rows.map(({ p, subStatus, subPrice, subCur, subEnd, subSource }) => (
          <tr key={p.id} className="row"><td><Link href={`/people/${p.id}`} className="lnk-ink">{fullName(p)}</Link><div className="tags">{(p.tags ?? []).slice(0, 4).map((t) => <Link key={t} className="tag" href={qs({ tag: t })}>{t}</Link>)}</div></td>
            <td className="mono">{p.username ? "@" + p.username : <span className="muted">tg {p.telegramUserId}</span>}</td><td><Pill status={subStatus ?? "none"} /></td><td className="num">{subPrice ? money(subPrice, subCur) : "—"}</td><td className="mono">{subStatus && ["active", "trialing", "past_due"].includes(subStatus) ? date(subEnd) : "—"}</td>
            <td>{subSource ? <Pill tone={subSource === "hub" ? "acc" : ""}>{subSource === "hub" ? "Hub" : "ZenEdu"}</Pill> : ""}</td><td className="mono">{date(p.lastActiveAt)}</td></tr>))}
        {!data.rows.length && <tr><td colSpan={7}><EmptyState icon={<Users size={20} />} title="Нікого не знайдено" text="Змініть фільтр або пошуковий запит." /></td></tr>}
      </tbody></table>
        <Pager page={data.page} total={data.total} per={data.per} href={(p) => qs({ page: String(p) })} />
      </div>
    </Shell>
  );
}
