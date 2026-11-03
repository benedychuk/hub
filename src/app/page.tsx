import Link from "next/link";
import { Activity } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { Section, Stat, Alert, Timeline, EmptyState, Toolbar } from "@/components/ui/layout";
import { AutoSubmitSelect } from "@/components/ui/controls";
import { offerOptions } from "@/lib/offers";
import { navCounts, recentEvents } from "@/lib/queries";
import { buildDashboard, kyivMonth } from "@/lib/dashboard";
import { dateTime, fullName, money } from "@/lib/format";
import { describeEvent } from "@/lib/event-labels";
import { hasDb } from "@/db";

export const dynamic = "force-dynamic";

const MONTHS = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const periodLabel = (d: number) => d >= 360 ? "рік" : d >= 89 ? "3 місяці" : d <= 15 ? "2 тижні" : d >= 28 && d <= 31 ? "місяць" : `${d} дн.`;
const uah = (n: number) => money(Math.round(n), "UAH");
const delta = (now: number, prev: number) => prev ? `${now >= prev ? "+" : ""}${Math.round(((now - prev) / prev) * 100)}% до попередніх 30 днів` : "попередні 30 днів: 0";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ offer?: string }> }) {
  const sp = await searchParams;
  const [counts, d, offers, recent] = await Promise.all([navCounts(), hasDb() ? buildDashboard(sp.offer).catch((e) => { console.error("dashboard", e); return null; }) : null, hasDb() ? offerOptions().catch(() => []) : [], recentEvents()]);
  const offerName = offers.find((o) => o.key === sp.offer)?.name;
  const thisMonth = kyivMonth(Date.now());
  const fc = new Map((d?.forecast ?? []).map((f) => [f.m, f]));
  // таблиця по місяцях: факт за 8 місяців + прогноз на поточний (залишок) і два наступні
  const months = [...new Set([...(d?.monthly ?? []).map((m) => m.m), ...(d?.forecast ?? []).map((f) => f.m)])].sort();
  const max = Math.max(1, ...(d?.monthly ?? []).map((m) => Math.max(m.starts, m.renews)));
  const staleHours = d?.syncOkAt ? (Date.now() - d.syncOkAt.getTime()) / 3600_000 : null;
  const maxDay = Math.max(1, ...(d?.days14 ?? []).map((x) => x.c));
  return (
    <Shell title="Дашборд" counts={counts}>
      {!hasDb() && <Alert tone="warn">База даних ще не підключена. Додайте Neon у Vercel → Storage; після деплою тут з’являться дані. <Link href="/settings">Налаштування</Link></Alert>}
      {hasDb() && !d && <Alert tone="bad">Не вдалося порахувати показники. Оновіть сторінку; якщо не допоможе, напишіть розробнику.</Alert>}
      {d && d.syncLast?.status === "error" && <Alert tone="bad">Остання синхронізація з ZenEdu ({dateTime(d.syncLast.started_at)}) завершилась помилкою: дані ZenEdu можуть бути неповні. Запустіть імпорт у <Link href="/settings">Налаштуваннях</Link>.</Alert>}
      {d && d.syncLast?.status !== "error" && (staleHours === null || staleHours > 30) && <Alert tone="warn">Дані ZenEdu {d.syncOkAt ? `оновлені ${dateTime(d.syncOkAt)}` : "ще не імпортовані"}: показники ZenEdu можуть відставати. Синхронізація йде щоранку; вручну — у <Link href="/settings">Налаштуваннях</Link>.</Alert>}
      <Toolbar><form method="get" className="row-actions"><AutoSubmitSelect name="offer" defaultValue={sp.offer ?? ""} className="btn" ariaLabel="Оффер"><option value="">Клуб: усі оффери</option>{offers.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}</AutoSubmitSelect>
        <span className="fld-h">{offerName ? `Показано лише «${offerName}»: підписки й платежі цього оффера (Hub і прив'язані оффери ZenEdu).` : `ZenEdu і Hub разом, без тестових оплат.${d?.syncOkAt ? ` Дані ZenEdu на ${dateTime(d.syncOkAt)}.` : ""}`}</span></form></Toolbar>

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Активні учасниці клубу" value={d?.members ?? "—"} hint={d ? `ZenEdu ${d.zenOnly} · Hub ${d.hubOnly}${d.both ? ` · в обох ${d.both}` : ""}${d.trialing ? ` · пробний ${d.trialing}` : ""}` : ""} />
        <Stat label="Нових підписок за 30 днів" value={d?.starts30 ?? "—"} hint={d ? `ZenEdu ${d.startsZen} · Hub ${d.startsHub} · ${delta(d.starts30, d.startsPrev)}` : ""} tone={d ? (d.starts30 < d.startsPrev ? "crit" : "good") : undefined} />
        <Stat label="Зібрано за 30 днів" value={d ? uah(d.revUah) : "—"} hint={d ? `ZenEdu ${uah(d.revZen)} · Hub ${uah(d.revHub)}${d.revUsd ? ` · ще ${money(d.revUsd, "USD")}` : ""} · ${d.revCount} оплат` : ""} />
        <Stat label="Запустили Hub-бот за 30 днів" value={d?.bot.d30 ?? "—"} hint={d ? `усього ${d.bot.total} · ${delta(d.bot.d30, d.bot.prev)}` : ""} />
      </div>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Щомісячний дохід (MRR)" value={d ? uah(d.mrrUah) : "—"} hint={d ? `з автопродовженням, у перерахунку на місяць${d.mrrUsd ? ` · ще ${money(d.mrrUsd, "USD")}` : ""}` : ""} />
        <Stat label="Продовжили за 30 днів" value={d?.renews30 ?? "—"} hint="оплати продовження в ZenEdu і Hub" />
        <Stat label="Пішли за 30 днів" value={d?.left ?? "—"} hint={d ? `доступ закінчився і не поновлений${d.members ? ` · ${Math.round((d.left / Math.max(1, d.members + d.left)) * 100)}% від учасниць` : ""}` : ""} tone={d && d.left > d.starts30 ? "crit" : undefined} />
        <Stat label="Без автопродовження" value={d?.noRenew ?? "—"} hint={d ? `скасували продовження або разовий доступ; у доступі до кінця періоду${d.pastDue ? ` · списання не пройшло ${d.pastDue}` : ""}` : ""} tone={d && d.pastDue ? "warn" : undefined} />
      </div>

      <div className="grid g21" style={{ marginBottom: 16 }}>
        <Section title="Нові підписки, продовження й оборот по місяцях" description="Факт — оплачені замовлення ZenEdu і Hub. Прогноз — списання за чинними підписками з автопродовженням, якщо всі продовжать." className="tbl">
          {months.length ? (
            <table><thead><tr><th>Місяць</th><th className="num">Нові</th><th className="num">Продовження</th><th className="num">Оборот, факт</th><th className="num">Прогноз</th><th style={{ width: "26%" }}></th></tr></thead><tbody>
              {months.map((m) => { const a = d?.monthly.find((x) => x.m === m); const f = fc.get(m); const future = m > thisMonth;
                return (<tr key={m}><td className="mono">{monthLabel(m)}{m === thisMonth && <Pill tone="acc">зараз</Pill>}</td>
                  <td className="num">{future ? "—" : a?.starts ?? 0}</td><td className="num">{future ? "—" : a?.renews ?? 0}</td>
                  <td className="num">{future ? "—" : uah(Number(a?.uah ?? 0))}</td>
                  <td className="num">{f ? <>{m === thisMonth ? "+" : ""}{uah(f.uah)}<div className="fld-h">{f.c} списань{m === thisMonth ? " до кінця місяця" : ""}</div></> : "—"}</td>
                  <td>{a && <div className="bars"><div className="bar" title="нові"><i style={{ width: `${(a.starts / max) * 100}%`, background: "var(--moon-2)" }} /></div><div className="bar" title="продовження"><i style={{ width: `${(a.renews / max) * 100}%` }} /></div></div>}</td></tr>); })}
            </tbody></table>
          ) : <EmptyState title="Немає даних" text="Запустіть імпорт із ZenEdu в Налаштуваннях." action={<Link href="/settings" className="btn sm">Налаштування</Link>} />}
        </Section>
        <Section title="Списання на 14 днів" description="Автопродовження ZenEdu і Hub за днями; сума — якщо всі пройдуть">
          {d?.days14.some((x) => x.c || x.ends) ? <Timeline items={d.days14.filter((x) => x.c || x.ends).map((x) => ({ id: x.day, when: `${x.day.slice(8, 10)}.${x.day.slice(5, 7)}`, what: <div><b>{x.c}</b> {x.c ? `· ${uah(x.uah)}` : ""}<span className="muted">{x.c ? ` (ZenEdu ${x.zen}, Hub ${x.hub})` : ""}{x.ends ? ` · закінчується без продовження ${x.ends}` : ""}</span><div className="bar" title="списань"><i style={{ width: `${(x.c / maxDay) * 100}%` }} /></div></div> }))} />
            : <EmptyState title="Списань у найближчі 14 днів немає" text={d?.syncOkAt ? undefined : "Дані ZenEdu ще не імпортовані."} />}
        </Section>
      </div>

      <Section title="Тарифи: хто на якому" description={`Учасниці з чинним доступом за тарифами. MRR — щомісячний дохід з автопродовженням.${d?.zenRenewPrice ? ` Пробний ZenEdu після 2 тижнів рахується за ${uah(d.zenRenewPrice)}/міс.` : ""}`} className="tbl">
        {d?.tariffs.length ? (
          <table><thead><tr><th>Тариф</th><th>Джерело</th><th>Період</th><th className="num">Підписок</th><th className="num">З автопродовженням</th><th className="num">Ціна</th><th className="num">MRR</th><th style={{ width: "18%" }}></th></tr></thead><tbody>
            {d.tariffs.map((t) => (<tr key={`${t.source}${t.name}${t.period}${t.currency}`}><td className="ellipsis">{t.name}</td><td><Pill tone={t.source === "hub" ? "acc" : "moon"}>{t.source === "hub" ? "Hub" : "ZenEdu"}</Pill></td><td>{periodLabel(t.period)}</td>
              <td className="num">{t.members}</td><td className="num">{t.renewing}</td><td className="num">{money(t.price, t.currency)}</td><td className="num">{money(t.mrr, t.currency)}</td>
              <td><div className="bar"><i style={{ width: `${(t.members / Math.max(1, d.tariffs[0].members)) * 100}%` }} /></div></td></tr>))}
            <tr><td><b>Разом підписок</b><div className="fld-h">людина з двома тарифами рахується в кожному</div></td><td /><td /><td className="num"><b>{d.tariffs.reduce((a, t) => a + t.members, 0)}</b></td><td className="num"><b>{d.tariffs.reduce((a, t) => a + t.renewing, 0)}</b></td><td /><td className="num"><b>{uah(d.mrrUah)}</b></td><td /></tr>
          </tbody></table>
        ) : <EmptyState title="Немає учасниць із чинним доступом" />}
      </Section>

      <Section title="Останні події">
        {recent.length ? <Timeline items={recent.map((e) => ({ id: e.id, when: dateTime(e.createdAt), what: <><span className="muted">{describeEvent({ id: e.id, type: e.type, source: "hub", createdAt: e.createdAt, payload: (e.payload ?? {}) as Record<string, unknown> }, { funnels: {}, plans: {}, broadcasts: {}, steps: {} }).title}</span> {e.personId ? <Link href={`/people/${e.personId}`}>{fullName({ firstName: e.first, lastName: e.last, username: e.username })}</Link> : ""} {e.type === "bot.message" ? <span className="muted">— {String((e.payload as { text?: string })?.text ?? "").slice(0, 80)}</span> : null}</> }))} />
          : <EmptyState icon={<Activity size={20} />} title="Подій ще немає" text="Вони з’являться після запуску бота і вебхуків ZenEdu." />}
      </Section>
    </Shell>
  );
}
