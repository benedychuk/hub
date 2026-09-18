import Link from "next/link";
import { Activity } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { Section, Stat, Alert, Timeline, EmptyState, Toolbar } from "@/components/ui/layout";
import { AutoSubmitSelect } from "@/components/ui/controls";
import { offerOptions } from "@/lib/offers";
import { dashboard, navCounts } from "@/lib/queries";
import { dateTime, fullName, money } from "@/lib/format";
import { describeEvent } from "@/lib/event-labels";
import { hasDb } from "@/db";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ offer?: string }> }) {
  const sp = await searchParams;
  const [counts, d, offers] = await Promise.all([navCounts(), dashboard(sp.offer), hasDb() ? offerOptions().catch(() => []) : []]);
  const offerName = offers.find((o) => o.key === sp.offer)?.name;
  const st = Object.fromEntries((d?.byStatus ?? []).map((x) => [x.status, x.c]));
  const active = (st.active ?? 0) + (st.past_due ?? 0);
  const uah = d?.rev.find((r) => r.cur === "UAH"), usd = d?.rev.find((r) => r.cur === "USD");
  const mon = d?.monthly ?? [];
  const max = Math.max(1, ...mon.map((m) => Math.max(m.starts, m.renews)));
  return (
    <Shell title="Дашборд" counts={counts}>
      {!hasDb() && <Alert tone="warn">База даних ще не підключена. Додайте Neon у Vercel → Storage; після деплою тут з’являться дані. <Link href="/settings">Налаштування</Link></Alert>}
      {hasDb() && !d?.monthly.length && <Alert tone="info">Даних поки немає. Запустіть імпорт із ZenEdu на сторінці <Link href="/settings">Налаштування</Link>.</Alert>}
      <Toolbar><form method="get" className="row-actions"><AutoSubmitSelect name="offer" defaultValue={sp.offer ?? ""} className="btn" ariaLabel="Оффер"><option value="">Усі оффери разом</option>{offers.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}</AutoSubmitSelect>{offerName && <span className="fld-h">Показано лише «{offerName}»: підписки й платежі цього оффера (Hub і привʼязані ZenEdu). Привʼязка ZenEdu-офферів до офферів Hub — у редакторі оффера.</span>}</form></Toolbar>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Активні підписки" value={active} hint={`trial ${st.trialing ?? 0} · past due ${st.past_due ?? 0} · пауза ${st.paused ?? 0}`} />
        <Stat label="Зібрано за 30 днів" value={uah ? money(uah.sum, "UAH") : "—"} hint={usd ? `+ ${money(usd.sum, "USD")} · ${(uah?.c ?? 0) + (usd?.c ?? 0)} платежів` : `${uah?.c ?? 0} платежів`} />
        <Stat label="Нових підписок за 30 днів" value={d?.starts30 ?? "—"} hint={d ? `попередні 30 днів: ${d.startsPrev}` : ""} tone={d && d.starts30 < d.startsPrev ? "crit" : d ? "good" : undefined} />
        <Stat label="Запустили Hub-бот" value={d?.hubStarts ?? 0} hint="натиснули /start у новому боті" />
      </div>
      <div className="grid g21" style={{ marginBottom: 16 }}>
        <Section title="Нові підписки і продовження по місяцях" description="За замовленнями ZenEdu і Hub" className="tbl">
          {mon.length ? (
            <table><thead><tr><th>Місяць</th><th className="num">Нові</th><th className="num">Продовження</th><th className="num">UAH</th><th style={{ width: "40%" }}></th></tr></thead><tbody>
              {mon.map((m) => (<tr key={m.m}><td className="mono">{m.m}</td><td className="num">{m.starts}</td><td className="num">{m.renews}</td><td className="num">{Number(m.uah).toLocaleString("uk-UA")}</td>
                <td><div className="bars"><div className="bar" title="нові"><i style={{ width: `${(m.starts / max) * 100}%`, background: "var(--moon-2)" }} /></div><div className="bar" title="продовження"><i style={{ width: `${(m.renews / max) * 100}%` }} /></div></div></td></tr>))}
            </tbody></table>
          ) : <EmptyState title="Немає даних" />}
        </Section>
        <Section title="Списання на 14 днів" description="За кінцем періоду; поки списує ZenEdu">
          {d?.expiring.length ? <Timeline items={d.expiring.map((e) => ({ id: e.day, when: e.day.slice(5), what: <><b>{e.c}</b> підписок</> }))} /> : <EmptyState title="Немає даних" />}
        </Section>
      </div>
      <Section title="Останні події">
        {d?.recent.length ? <Timeline items={d.recent.map((e) => ({ id: e.id, when: dateTime(e.createdAt), what: <><span className="muted">{describeEvent({ id: e.id, type: e.type, source: "hub", createdAt: e.createdAt, payload: (e.payload ?? {}) as Record<string, unknown> }, { funnels: {}, plans: {}, broadcasts: {}, steps: {} }).title}</span> {e.personId ? <Link href={`/people/${e.personId}`}>{fullName({ firstName: e.first, lastName: e.last, username: e.username })}</Link> : ""} {e.type === "bot.message" ? <span className="muted">— {String((e.payload as { text?: string })?.text ?? "").slice(0, 80)}</span> : null}</> }))} />
          : <EmptyState icon={<Activity size={20} />} title="Подій ще немає" text="Вони з’являться після запуску бота і вебхуків ZenEdu." />}
      </Section>
    </Shell>
  );
}
