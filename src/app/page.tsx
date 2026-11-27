import Link from "next/link";
import { Activity } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { Section, Stat, Alert, Timeline, EmptyState, Toolbar } from "@/components/ui/layout";
import { AutoSubmitSelect } from "@/components/ui/controls";
import { ColumnChart, LineChart, ShareBar, HBars, type Cat } from "@/components/ui/charts";
import { offerOptions } from "@/lib/offers";
import { navCounts, recentEvents, safe } from "@/lib/queries";
import { hubBuyerGaps } from "@/lib/shchyro";
import { onboardingConfigured } from "@/lib/onboarding";
import { buildDashboard, kyivMonth, USD_UAH } from "@/lib/dashboard";
import { dateTime, fullName, money } from "@/lib/format";
import { describeEvent } from "@/lib/event-labels";
import { hasDb, db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

const MONTHS = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];
const monthLabel = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1];
const periodLabel = (d: number) => d >= 360 ? "рік" : d >= 89 ? "3 місяці" : d <= 15 ? "2 тижні" : d >= 28 && d <= 31 ? "місяць" : `${d} дн.`;
const uah = (n: number) => money(Math.round(n), "UAH");
const pct = (a: number, b: number) => b ? Math.round((a / b) * 100) : 0;
const addMonth = (m: string, k: number) => { const [y, mm] = m.split("-").map(Number); const t = new Date(Date.UTC(y, mm - 1 + k, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`; };

const MONTH_GEN = ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"];
const MONTH_LOC = ["у січні", "у лютому", "у березні", "у квітні", "у травні", "у червні", "у липні", "у серпні", "у вересні", "у жовтні", "у листопаді", "у грудні"];
/** Підписи звітного періоду (київський час): «у листопаді», «1–27 жовтня», «27 жовтня». */
function monthPeriod(now: Date) {
  const [y, m, day] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(now).split("-").map(Number);
  const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
  const pLast = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const pDay = Math.min(day, pLast);
  return { label: MONTH_LOC[m - 1], prevRange: pDay === 1 ? `1 ${MONTH_GEN[pm - 1]}` : `1–${pDay} ${MONTH_GEN[pm - 1]}`, prevDay: `${pDay} ${MONTH_GEN[pm - 1]}` };
}

// пояснення до плиток: що це і як рахується (спливає при наведенні на «i»)
const INFO = {
  month: "Скільки грошей надійшло з 1-го числа поточного місяця (київський час) до зараз.\n\nУсі оплачені замовлення ZenEdu і Hub (клуб і продукти), без тестових; долари за курсом. Порівняння — з минулим місяцем за ту саму кількість днів.",
  members: "Скільки людей зараз мають доступ до клубу.\n\nУнікальні люди з чинною підпискою клубу в ZenEdu або в Hub: людина, що є в обох, рахується один раз. Доступ ZenEdu — до кінця оплаченого періоду + 3 дні на автосписання; Hub — до кінця періоду + грейс із налаштувань оплат. Тестові оплати не рахуються.\n\nПлашка зміни — до того самого числа минулого місяця, за оплатами (кожна оплата покриває свій період + 3 дні).",
  starts: "Скільки підписок клубу розпочато з 1-го числа поточного місяця (київський час).\n\nZenEdu — замовлення «початок підписки» (зокрема пробні). Hub — перша оплата оффера з доступом до каналу. Дата — момент оплати. Порівняння — з минулим місяцем з 1-го до того самого числа й часу (якщо такого числа немає — увесь минулий місяць).",
  bot: "Скільки людей уперше натиснули /start у Hub-боті з 1-го числа поточного місяця.\n\n«Усього» — усі, хто колись запускав Hub-бот. Порівняння — з минулим місяцем з 1-го до того самого числа й часу (якщо такого числа немає — увесь минулий місяць).",
  renews: "Скільки оплат продовження підписки клубу надійшло з 1-го числа поточного місяця.\n\nZenEdu — замовлення «продовження підписки», Hub — автосписання й повторні оплати клубу. Порівняння — з минулим місяцем з 1-го до того самого числа й часу (якщо такого числа немає — увесь минулий місяць).",
  mrr: `Щомісячний дохід, який дадуть чинні підписки з автопродовженням.\n\nСума цін у перерахунку на місяць: місячна = ціна, 3 місяці = ціна / 3, рік = ціна / 12. Пробні рахуються за ціною повного місяця. Без скасованих і разових. Доларові підписки — за курсом ${USD_UAH} грн. Це «потенціал», а не прогноз: прогноз з урахуванням тих, хто не продовжує, — у графіку по місяцях.`,
  arpu: `Скільки в середньому принесла одна учасниця за останні 90 днів.\n\nУвесь дохід клубу в гривнях за 90 днів (оплати ZenEdu і Hub, без тестових і повернених), поділений на кількість людей, які мали доступ до клубу хоча б один день за ці 90 днів — і тих, хто вже пішов, і нових. «На місяць» — те саме, поділене на 3. Долари — за курсом ${USD_UAH} грн.`,
  left: "Скільки людей утратили доступ з 1-го числа поточного місяця і не поновили його.\n\nПідписка закінчилась (для ZenEdu — +3 дні на автосписання), а іншої чинної підписки клубу в людини немає. Сюди ж потрапляють пробні, які не перейшли в оплату. Відсоток — від суми нинішніх учасниць і тих, хто пішов. Порівняння — з минулим місяцем з 1-го до того самого числа й часу (якщо такого числа немає — увесь минулий місяць).",
  norenew: "Учасниці, які ще мають доступ, але наступного списання не буде.\n\nВимкнули продовження (ZenEdu повідомляє вебхуком, Hub — кнопкою в боті) або купили разовий доступ. Вони підуть наприкінці оплаченого періоду, якщо не оплатять знову. «Списання не пройшло» — автосписання Hub, які банк відхилив.",
} as const;

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ offer?: string }> }) {
  const sp = await searchParams;
  const [counts, d, offers, recent] = await Promise.all([navCounts(), hasDb() ? buildDashboard(sp.offer).catch((e) => { console.error("dashboard", e); return null; }) : null, hasDb() ? offerOptions().catch(() => []) : [], recentEvents()]);
  const offerName = offers.find((o) => o.key === sp.offer)?.name;
  // хто оплатив через Hub, але не має «Щиро» або кабінету — видно одразу на головній
  const gaps = hasDb() ? await safe(() => hubBuyerGaps(onboardingConfigured()), []) : [];
  // термінові звернення асистентки (криза) — одразу на головній
  const urgent = hasDb() ? await safe(async () => Number(((await db().execute(sql`select count(*)::int as c from assistant_tickets where status = 'open' and priority = 'urgent'`)).rows[0] as { c: number })?.c ?? 0), 0) : 0;
  const gapShchyro = gaps.filter((g) => g.problems.some((p) => p !== "no_cabinet")).length, gapCabinet = gaps.filter((g) => g.problems.includes("no_cabinet")).length;
  const thisMonth = kyivMonth(Date.now());
  const staleHours = d?.syncOkAt ? (Date.now() - d.syncOkAt.getTime()) / 3600_000 : null;

  // динаміка по місяцях: 12 місяців факту + 2 місяці прогнозу; поточний місяць — факт + прогноз до кінця
  const fc = new Map((d?.forecast ?? []).map((f) => [f.m, f]));
  const flow = d?.flow ?? [];
  // звітний період плиток — поточний календарний місяць; порівняння — минулий місяць з 1-го до того самого числа
  const per = monthPeriod(new Date());
  const months = [...flow.map((f) => f.m), addMonth(thisMonth, 1), addMonth(thisMonth, 2)];
  const mCats: Cat[] = months.map((m) => ({ key: m, label: monthLabel(m), sub: m.slice(5, 7) === "01" || m === months[0] ? m.slice(0, 4) : undefined, dim: m > thisMonth }));
  const revVals: Record<string, Record<string, number>> = {};
  const revExtra: Record<string, { name: string; value: string }[]> = {};
  for (const m of months) {
    const f = flow.find((x) => x.m === m); const p = fc.get(m);
    revVals[m] = { new: Number(f?.uah_new ?? 0), returned: Number(f?.uah_returned ?? 0), renew: Number(f?.uah_renew ?? 0), forecast: m >= thisMonth ? p?.uah ?? 0 : 0 };
    revExtra[m] = [
      ...(f ? [{ name: "оплат: нових / повернулись / продовжень", value: `${f.new} / ${f.returned} / ${f.renew}` }] : []),
      ...(p && m >= thisMonth ? [{ name: "якщо продовжать усі", value: uah(p.maxUah) }, { name: "очікуваних списань", value: `${Math.round(p.expC)} з ${p.c}` }] : []),
      ...(f && Number(f.usd) ? [{ name: `з них у доларах (×${d?.usdRate})`, value: money(Number(f.usd), "USD") }] : []),
    ];
  }
  const flowCats = mCats.filter((c) => c.key <= thisMonth);
  const flowVals: Record<string, Record<string, number>> = Object.fromEntries(flow.map((f) => [f.m, { new: f.new, returned: f.returned, churned: f.churned }]));
  // поточний місяць — те саме число, що на плитці «Активні учасниці» (за чинними підписками); минулі — за оплатами на кінець місяця
  const memberPoints = flow.map((f) => ({ key: f.m, label: monthLabel(f.m), value: f.m === thisMonth && d ? d.members : f.members, note: f.m === thisMonth ? "станом на зараз" : "на кінець місяця" }));

  const dayCats: Cat[] = [...(d?.last14 ?? [])].reverse().map((x) => ({ key: x.day, label: `${x.day.slice(8, 10)}.${x.day.slice(5, 7)}` }));
  const dayVals = Object.fromEntries((d?.last14 ?? []).map((x) => [x.day, { new: x.starts, renew: x.renews }]));
  const dayExtra = Object.fromEntries((d?.last14 ?? []).map((x) => [x.day, [{ name: "сума", value: uah(Number(x.uah)) }, ...(x.starts ? [{ name: "нові: ZenEdu / Hub", value: `${x.starts_zen} / ${x.starts_hub}` }] : []), ...(x.trials ? [{ name: "з них пробних", value: String(x.trials) }] : [])]]));
  const upCats: Cat[] = (d?.days14 ?? []).map((x) => ({ key: x.day, label: `${x.day.slice(8, 10)}.${x.day.slice(5, 7)}` }));
  const upVals = Object.fromEntries((d?.days14 ?? []).map((x) => [x.day, { zen: x.zen, hub: x.hub }]));
  const upExtra = Object.fromEntries((d?.days14 ?? []).map((x) => [x.day, [{ name: "сума, якщо всі пройдуть", value: uah(x.uah) }, ...(x.ends ? [{ name: "закінчуються без продовження", value: String(x.ends) }] : [])]]));
  const paidRenewing = d ? Math.max(0, d.members - d.noRenew - d.trialing) : 0;

  return (
    <Shell title="Дашборд" counts={counts}>
      {!hasDb() && <Alert tone="warn">База даних ще не підключена. Додайте Neon у Vercel → Storage; після деплою тут з’являться дані. <Link href="/settings">Налаштування</Link></Alert>}
      {hasDb() && !d && <Alert tone="bad">Не вдалося порахувати показники. Оновіть сторінку; якщо не допоможе, напишіть розробнику.</Alert>}
      {d?.syncProblem && <Alert tone="bad"><b>{d.syncProblem.title}.</b> Показники ZenEdu можуть бути неповні. {d.syncProblem.what} <Link href="/settings">Налаштування</Link>{d.syncProblem.detail && <div className="mono fld-h">{d.syncProblem.detail}</div>}</Alert>}
      {d && !d.syncProblem && staleHours !== null && staleHours > 3 && <Alert tone="warn">Дані ZenEdu оновлені {dateTime(d.syncOkAt!)}: показники ZenEdu можуть відставати. Синхронізація йде щогодини; вручну — у <Link href="/settings">Налаштуваннях</Link>.</Alert>}
      {urgent > 0 && <Alert tone="bad"><b>Термінові звернення асистентки: {urgent}.</b> Людина може бути в кризі — відкрийте <Link href="/assistant">Асистент</Link>.</Alert>}
      {(gapShchyro > 0 || gapCabinet > 0) && <Alert tone="bad"><b>Оплатили через Hub, але не отримали доступ:</b>{gapShchyro ? ` без «Щиро» — ${gapShchyro}` : ""}{gapShchyro && gapCabinet ? ";" : ""}{gapCabinet ? ` без кабінету платформи — ${gapCabinet}` : ""}. Причина й що зробити — на сторінці <Link href="/shchyro?tab=access">Бот «Щиро» → Доступ</Link>.</Alert>}
      <Toolbar><form method="get" className="row-actions"><AutoSubmitSelect name="offer" defaultValue={sp.offer ?? ""} className="btn" ariaLabel="Оффер"><option value="">Клуб: усі оффери</option>{offers.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}</AutoSubmitSelect>
        <span className="fld-h">{offerName ? `Показано лише «${offerName}»: підписки й платежі цього оффера (Hub і прив'язані оффери ZenEdu).` : `ZenEdu і Hub разом, без тестових оплат. Суми в гривнях, долари за курсом ${USD_UAH} грн.${d?.syncOkAt ? ` Дані ZenEdu на ${dateTime(d.syncOkAt)}.` : ""}`}</span></form></Toolbar>

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Активні учасниці клубу" info={INFO.members} value={d?.members ?? "—"} hint={d ? `ZenEdu ${d.zenOnly} · Hub ${d.hubOnly}${d.both ? ` · в обох ${d.both}` : ""} · з них пробних ${d.trialing}` : ""}
          change={d ? { now: d.membersPay.now, prev: d.membersPay.prev, title: `До ${per.prevDay} (за оплатами: зараз ${d.membersPay.now}, тоді ${d.membersPay.prev})` } : undefined} />
        <Stat label={`Нових підписок ${per.label}`} info={INFO.starts} value={d?.startsMonth ?? "—"} hint={d ? `ZenEdu ${d.startsZen} · Hub ${d.startsHub} · ${per.prevRange}: ${d.startsPrev}` : ""}
          change={d ? { now: d.startsMonth, prev: d.startsPrev, title: `До ${per.prevRange} (${d.startsPrev})` } : undefined} />
        <Stat label={`Отримано ${per.label}`} info={INFO.month} value={d ? uah(d.month.uah) : "—"} hint={d ? `ZenEdu ${uah(d.month.zen)} · Hub ${uah(d.month.hub)} · оплат: ${d.month.count}${d.revUsd ? ` · з них ${money(d.revUsd, "USD")}` : ""} · ${per.prevRange}: ${uah(d.month.prev)}` : ""}
          change={d ? { now: d.month.uah, prev: d.month.prev, title: `До ${per.prevRange} (${uah(d.month.prev)})` } : undefined} />
        <Stat label={`Продовжень ${per.label}`} info={INFO.renews} value={d?.renewsMonth ?? "—"} hint={d ? `оплат продовження підписки · ${per.prevRange}: ${d.renewsPrev}` : ""}
          change={d ? { now: d.renewsMonth, prev: d.renewsPrev, title: `До ${per.prevRange} (${d.renewsPrev})` } : undefined} />
      </div>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Щомісячний дохід (MRR)" info={INFO.mrr} value={d ? uah(d.mrrUah) : "—"} hint={d ? `потенціал автопродовжень${d.mrrUsd ? ` · з них ${money(d.mrrUsd, "USD")} за курсом ${d.usdRate}` : ""}` : ""} />
        <Stat label="ARPU за 90 днів" info={INFO.arpu} value={d ? uah(d.arpu90) : "—"} hint={d ? `≈ ${uah(d.arpu90 / 3)} на місяць · ${uah(d.arpu90Uah)} / ${d.arpu90People} учасниць` : ""}
          change={d ? { now: d.arpu90, prev: d.arpu90Prev, title: `До попередніх 90 днів (${uah(d.arpu90Prev)})` } : undefined} />
        <Stat label={`Пішли ${per.label}`} info={INFO.left} value={d?.left ?? "—"} hint={d ? `${pct(d.left, d.members + d.left)}% від учасниць · нових за той час ${d.startsMonth} · ${per.prevRange}: ${d.leftPrev}` : ""}
          change={d ? { now: d.left, prev: d.leftPrev, lowerIsBetter: true, title: `До ${per.prevRange} (${d.leftPrev}); зростання — погано` } : undefined} />
        <Stat label={`Запустили Hub-бот ${per.label}`} info={INFO.bot} value={d?.bot.month ?? "—"} hint={d ? `усього ${d.bot.total} · ${per.prevRange}: ${d.bot.prev}` : ""}
          change={d ? { now: d.bot.month, prev: d.bot.prev, title: `До ${per.prevRange} (${d.bot.prev})` } : undefined} />
      </div>

      <Section title="Динаміка клубу по місяцях" description={d ? `Оборот за оплатами ZenEdu і Hub (київський час). Нова — перша оплата людини; повернулась — оплата після перерви; продовження — без перерви. Прогноз — очікувані списання чинних підписок з урахуванням того, скільки зазвичай продовжують: ${pct(d.rates.renewed, d.rates.due)}% оплачених і ${pct(d.rates.trial_paid, d.rates.trial_due)}% пробних за останні 150 днів.` : ""}>
        {flow.length ? <>
          <ColumnChart ariaLabel="Оборот клубу по місяцях" format="uah" height={260} cats={mCats} values={revVals} extra={revExtra} totalLabel="разом"
            series={[{ key: "new", name: "Нові", color: "var(--c1)" }, { key: "returned", name: "Повернулись", color: "var(--c3)" }, { key: "renew", name: "Продовження", color: "var(--c2)" }, { key: "forecast", name: "Прогноз", color: "var(--c2)", hatch: true }]} />
          <div className="chart-pair">
            <div><h4>Учасниці на кінець місяця</h4><LineChart ariaLabel="Учасниці на кінець місяця" name="учасниць" format="int" points={memberPoints} /></div>
            <div><h4>Прийшли і пішли</h4><ColumnChart ariaLabel="Прийшли і пішли по місяцях" format="int" cats={flowCats} values={flowVals} showTotals={false}
              series={[{ key: "new", name: "Нові", color: "var(--c1)" }, { key: "returned", name: "Повернулись", color: "var(--c3)" }, { key: "churned", name: "Пішли", color: "var(--c-muted)", negative: true }]} /></div>
          </div>
          <details className="chart-table tbl"><summary>Цифри по місяцях</summary>
            <table><thead><tr><th>Місяць</th><th className="num">Нові</th><th className="num">з них пробні</th><th className="num">Повернулись</th><th className="num">Продовження</th><th className="num">Пішли</th><th className="num">Учасниць</th><th className="num">Оборот</th><th className="num">Прогноз</th></tr></thead><tbody>
              {months.map((m) => { const f = flow.find((x) => x.m === m); const p = fc.get(m);
                return <tr key={m}><td className="mono">{monthLabel(m)} {m.slice(0, 4)}{m === thisMonth && <Pill tone="acc">зараз</Pill>}</td>
                  <td className="num">{f?.new ?? "—"}</td><td className="num">{f?.new_trial ?? "—"}</td><td className="num">{f?.returned ?? "—"}</td><td className="num">{f?.renew ?? "—"}</td><td className="num">{f?.churned ?? "—"}</td><td className="num">{f?.members ?? "—"}</td>
                  <td className="num">{f ? uah(Number(f.uah_new) + Number(f.uah_returned) + Number(f.uah_renew)) : "—"}</td><td className="num">{p && m >= thisMonth ? `${m === thisMonth ? "+" : ""}${uah(p.uah)}` : "—"}</td></tr>; })}
            </tbody></table></details>
        </> : <EmptyState title="Немає оплат" text="Запустіть імпорт із ZenEdu в Налаштуваннях." action={<Link href="/settings" className="btn sm">Налаштування</Link>} />}
      </Section>

      <div className="grid g2" style={{ marginBottom: 16 }}>
        <Section title="Склад клубу" description="Хто зараз має доступ: звідки і чи платить далі">
          {d && d.members ? <>
            <div className="sharebar-cap">За джерелом</div>
            <ShareBar ariaLabel="Учасниці за джерелом" parts={[{ name: "ZenEdu", value: d.zenOnly, color: "var(--c1)" }, { name: "Hub", value: d.hubOnly, color: "var(--c2)" }, { name: "в обох", value: d.both, color: "var(--c3)" }]} />
            <div className="sharebar-cap">За станом оплати</div>
            <ShareBar ariaLabel="Учасниці за станом оплати" parts={[{ name: "платять з автопродовженням", value: paidRenewing, color: "var(--c2)" }, { name: "пробний період", value: d.trialing, color: "var(--c2)", hatch: true }, { name: "без автопродовження", value: d.noRenew, color: "var(--c-muted)" }]} />
          </> : <EmptyState title="Немає учасниць із чинним доступом" />}
        </Section>
        <Section title="Конверсії" description="Лише ті, у кого вже була спроба списання. Пробні — оформлені через Hub за 90 днів, пробний період закінчився (точно, з даних Hub); перші повні місяці — оплачені за 180 днів, настала дата другого списання. Продовження зараховується, якщо оплата прийшла протягом 14 днів після дати списання.">
          {d ? <HBars format="pct" max={100} rows={[
            { name: "Пробний → 1-й повний місяць (Hub)", value: d.conv.trials ? pct(d.conv.trials_paid, d.conv.trials) : 0, note: d.conv.trials
              ? `${d.conv.trials_paid} з ${d.conv.trials} пробних, оформлених у Hub, оплатили повний місяць${d.conv.trials_waiting ? ` · ще ${d.conv.trials_waiting} у пробному` : ""}${d.conv.trials_zen ? ` · ZenEdu для порівняння: ${pct(d.conv.trials_paid_zen, d.conv.trials_zen)}% (${d.conv.trials_paid_zen} з ${d.conv.trials_zen})` : ""}`
              : `пробних через Hub, у яких уже минув пробний період, ще не було${d.conv.trials_waiting ? ` · ${d.conv.trials_waiting} зараз у пробному` : ""}`, color: "var(--c1)" },
            { name: "1-й → 2-й місяць", value: pct(d.conv.firsts_paid, d.conv.firsts), note: `${d.conv.firsts_paid} з ${d.conv.firsts} оплатили другий місяць`, color: "var(--c1)" },
          ]} /> : null}
          {d && d.conv.trials > d.conv.trials_paid && (() => { const l = d.conv.lost; const notPaid = d.conv.trials - d.conv.trials_paid;
            return <>
              <p className="fld-h" style={{ marginTop: 10 }}>Пробні Hub, що не перейшли ({notPaid}): {[
                l.declined ? `списання відхилено — ${l.declined}${l.topReason ? ` (найчастіше: ${l.topReason})` : ""}` : "",
                l.cancelled ? `скасували або поставили на паузу — ${l.cancelled}` : "",
                l.noCard ? `картка не збереглась — ${l.noCard}` : "",
                l.notCharged ? `списання не відбулося — ${l.notCharged}` : "",
              ].filter(Boolean).join(" · ") || "причин не знайдено"}</p>
              {(l.noCard + l.notCharged) > 0 && <Alert tone="warn">У {l.noCard + l.notCharged} людей після пробного Hub не спробував списати оплату{l.noCard ? `: у ${l.noCard} з них картка не збереглась після пробної оплати` : ""}. Це втрачені продовження — подивіться підписки «пробний період» у «Продажі → Підписки» або напишіть розробнику.</Alert>}
            </>; })()}
        </Section>
      </div>

      <div className="grid g2" style={{ marginBottom: 16 }}>
        <Section title="Останні 14 днів" description="Оплати по днях: нові підписки й продовження, ZenEdu і Hub разом. Наведіть на стовпчик, щоб побачити суму й джерела.">
          <ColumnChart ariaLabel="Оплати за останні 14 днів" format="int" height={200} cats={dayCats} values={dayVals} extra={dayExtra}
            series={[{ key: "new", name: "Нові", color: "var(--c1)" }, { key: "renew", name: "Продовження", color: "var(--c2)" }]} />
        </Section>
        <Section title="Списання на 14 днів вперед" description="Скільки автопродовжень заплановано по днях. Наведіть, щоб побачити суму й тих, хто закінчується без продовження.">
          <ColumnChart ariaLabel="Заплановані списання на 14 днів" format="int" height={200} cats={upCats} values={upVals} extra={upExtra}
            series={[{ key: "zen", name: "ZenEdu", color: "var(--c1)" }, { key: "hub", name: "Hub", color: "var(--c2)" }]} />
        </Section>
      </div>

      <Section title="Тарифи: хто на якому" description={`Учасниці з чинним доступом за тарифами. MRR — щомісячний дохід з автопродовженням (у валюті тарифу; «Разом» — у гривнях, долари за курсом).${d?.zenRenewPrice ? ` Пробний ZenEdu після 2 тижнів рахується за ${uah(d.zenRenewPrice)}/міс.` : ""}`} className="tbl">
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
