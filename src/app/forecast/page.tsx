import { Calculator } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { Section, Field, FormRow, Stat, Alert, KV, FilterGroup, EmptyState } from "@/components/ui/layout";
import { LineChart } from "@/components/ui/charts";
import { navCounts, safe } from "@/lib/queries";
import { actualAssumptions, forecast, nbuUsd } from "@/lib/forecast";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";
type SP = { b?: string; c?: string; t?: string; c1?: string; c2?: string; r?: string; tp?: string; mp?: string };
const num = (v: string | undefined) => { const n = Number(String(v ?? "").replace(",", ".").replace(/\s/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
const pctIn = (v: string | undefined) => { const n = num(v); return n === null ? undefined : Math.min(100, n) / 100; };
const uah = (n: number) => money(Math.round(n), "UAH");
const usd = (n: number) => money(Math.round(n), "USD");
const pct = (x: number) => `${Math.round(x * 100)}%`;
const dec = (x: number, n = 1) => x.toFixed(n).replace(".", ","); // десяткові — з комою
const MONTHS = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];
const monthAt = (k: number) => { const d = new Date(); d.setMonth(d.getMonth() + k); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

/** Маркетинг → «Прорахунок та аналітика»: прогноз кількості учасниць від рекламного бюджету на фактичних показниках клубу. */
export default async function ForecastPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [counts, act, fx] = await Promise.all([navCounts(), safe(() => actualAssumptions(), null), safe(() => nbuUsd(), { rate: 45, date: null, source: "fallback" as const })]);
  const budget = num(sp.b), cpa = num(sp.c), target = num(sp.t);
  const ready = Boolean(act && budget && cpa && target);
  const f = ready ? forecast({ budgetUsd: budget!, cpaUsd: cpa!, target: Math.round(target!), c1: pctIn(sp.c1), c2: pctIn(sp.c2), r: pctIn(sp.r), trialPrice: num(sp.tp) ?? undefined, monthPrice: num(sp.mp) ?? undefined }, act!.members, act!.a, fx.rate) : null;
  const a = f?.a ?? act?.a;
  return (
    <Shell title="Прорахунок та аналітика" counts={counts}>
      <div className="ph"><span className="ph-ico"><Calculator size={16} /></span><h2 className="ph-title">Скільки потрібно реклами, щоб дійти до мети</h2>
        <Pill tone={fx.source === "nbu" ? "good" : "warn"}>{fx.source === "nbu" ? `курс НБУ ${dec(fx.rate, 2)} грн/$${fx.date ? ` на ${fx.date}` : ""}` : `курс 45 грн/$ (НБУ недоступний)`}</Pill></div>
      {!act && <Alert tone="bad">Не вдалося порахувати показники клубу. Оновіть сторінку; якщо не допоможе, напишіть розробнику.</Alert>}
      <form method="get">
        <Section title="Вхідні дані" description="Прогноз будується на фактичних показниках клубу: скільки зараз учасниць, яка частка пробних оплачує повний місяць, скільки продовжують. Їх можна змінити в «Припущеннях» нижче, щоб порахувати інший сценарій.">
          <FormRow cols={3}>
            <Field label="Рекламний бюджет на місяць, $" hint="перераховується в гривні за курсом НБУ"><input name="b" type="number" min={1} step="any" defaultValue={sp.b ?? ""} placeholder="1000" required /></Field>
            <Field label="Вартість залучення одного пробного, $" hint="скільки зараз коштує реклама на одну людину, що оформила пробний період"><input name="c" type="number" min={0.01} step="any" defaultValue={sp.c ?? ""} placeholder="8" required /></Field>
            <Field label="Бажана кількість учасниць" hint={act ? `зараз у клубі ${act.members}` : undefined}><input name="t" type="number" min={1} step={1} defaultValue={sp.t ?? ""} placeholder="1000" required /></Field>
          </FormRow>
          {a && <div style={{ marginTop: 12 }}><FilterGroup title="Припущення (за замовчуванням — фактичні показники клубу)" active={[sp.c1, sp.c2, sp.r, sp.tp, sp.mp].filter(Boolean).length}>
            <FormRow cols={3}>
              <Field label="Пробний → 1-й повний місяць, %" hint={act ? (act.basis.trials >= 5 ? `факт: ${pct(act.a.c1)} (${act.basis.trialsPaid} з ${act.basis.trials} пробних через Hub за 90 днів)` : `оцінка ${pct(act.a.c1)}: пробних через Hub ще замало (${act.basis.trials}), тому взято загальну частку з прогнозу дашборда`) : undefined}><input name="c1" type="number" min={0} max={100} step="any" defaultValue={sp.c1 ?? ""} placeholder={String(Math.round(act!.a.c1 * 100))} /></Field>
              <Field label="1-й → 2-й місяць, %" hint={act ? `факт: ${pct(act.a.c2)} (${act.basis.firstsPaid} з ${act.basis.firsts} за 180 днів)` : undefined}><input name="c2" type="number" min={0} max={100} step="any" defaultValue={sp.c2 ?? ""} placeholder={String(Math.round(act!.a.c2 * 100))} /></Field>
              <Field label="Продовжують щомісяця, %" hint={act ? `факт: ${pct(act.a.r)} (${act.basis.renewed90} з ${act.basis.due90} періодів за 90 днів)` : undefined}><input name="r" type="number" min={0} max={99} step="any" defaultValue={sp.r ?? ""} placeholder={String(Math.round(act!.a.r * 100))} /></Field>
            </FormRow>
            <FormRow cols={2}>
              <Field label="Ціна пробного періоду, грн" hint={act ? `факт: у середньому ${uah(act.a.trialPrice)} за 90 днів` : undefined}><input name="tp" type="number" min={0} step="any" defaultValue={sp.tp ?? ""} placeholder={String(act!.a.trialPrice)} /></Field>
              <Field label="Ціна місяця, грн" hint={act ? `факт: у середньому ${uah(act.a.monthPrice)} за 90 днів` : undefined}><input name="mp" type="number" min={0} step="any" defaultValue={sp.mp ?? ""} placeholder={String(act!.a.monthPrice)} /></Field>
            </FormRow>
          </FilterGroup></div>}
          <div className="row-actions" style={{ marginTop: 14 }}><button className="btn pri" type="submit"><Calculator size={15} /> Порахувати</button></div>
        </Section>
      </form>

      {!f && <div className="card"><EmptyState icon={<Calculator size={20} />} title="Заповніть бюджет, вартість залучення і мету" text="Після «Порахувати» тут з'явиться: коли клуб дійде до мети, скільки на це потрібно грошей, коли окупається одна учасниця і яку ціну тримати." /></div>}
      {f && act && <>
        {f.reach === null
          ? <Alert tone="warn"><b>З бюджетом {usd(budget!)} на місяць мети {Math.round(target!)} учасниць не досягти.</b> Клуб стабілізується приблизно на {Math.round(f.plateau)} учасницях: стільки ж щомісяця йде, скільки приходить. Щоб дійти до мети за рік, потрібно близько {usd(f.budget12)} на місяць.</Alert>
          : <Alert tone="ok"><b>Мета {Math.round(target!)} учасниць — за {f.reach} {f.reach === 1 ? "місяць" : f.reach < 5 ? "місяці" : "місяців"}, орієнтовно {monthAt(f.reach)}.</b> Щоб утримувати цю кількість, далі достатньо близько {usd(f.budgetHold)} на місяць.</Alert>}
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <Stat label="Нових пробних на місяць" value={Math.round(f.trialsPerMonth)} hint={`${usd(budget!)} / ${usd(cpa!)} · ${uah(budget! * fx.rate)} на рекламу`} />
          <Stat label="Бюджет, щоб дійти до мети" value={f.budget12 === 0 ? "—" : usd(f.budget12)} hint={f.budget12 === 0 ? "мета досягається і без реклами" : `на місяць, щоб за 12 міс.; за 6 міс. — ${usd(f.budget6)}`} />
          <Stat label="Окупність одного пробного" value={f.ltvToCac ? `${dec(f.ltvToCac)}×` : "—"} tone={f.ltvToCac ? (f.ltvToCac >= 1 ? "good" : "crit") : undefined}
            hint={`дохід ${uah(f.ltv)} на вартість ${uah(f.cacUah)}${f.payback !== null ? ` · окупається за ${f.payback} міс.` : " · не окупається"}`} />
          <Stat label="Мінімальна ціна місяця" value={f.breakEvenPrice !== null ? uah(f.breakEvenPrice) : "—"} tone={f.breakEvenPrice !== null ? (f.a.monthPrice >= f.breakEvenPrice ? "good" : "crit") : undefined}
            hint={f.breakEvenPrice !== null ? `за якої реклама окупається; зараз ${uah(f.a.monthPrice)}` : undefined} />
        </div>
        <Section title="Учасниці по місяцях" description={`Нинішні ${act.members} учасниць щомісяця продовжують на ${pct(f.a.r)}; кожен місяць приходить ${Math.round(f.trialsPerMonth)} пробних, з них ${pct(f.a.c1)} оплачують перший повний місяць, ${pct(f.a.c2)} з них — другий, далі ${pct(f.a.r)} щомісяця.`}>
          <LineChart ariaLabel="Прогноз кількості учасниць" name="учасниць" format="int" height={240}
            points={f.rows.map((x) => ({ key: String(x.m), label: monthAt(x.m).slice(0, 3), value: Math.round(x.members), note: x.members >= target! ? "мету досягнуто" : `до мети ${Math.round(target! - x.members)}` }))} />
          <details className="chart-table tbl"><summary>Цифри по місяцях</summary>
            <table><thead><tr><th>Місяць</th><th className="num">Учасниць</th><th className="num">з них нових платять</th><th className="num">Дохід</th><th className="num">Реклама</th><th className="num">Прибуток за місяць</th><th className="num">Накопичено</th></tr></thead><tbody>
              {f.rows.map((x) => <tr key={x.m}><td className="mono">{monthAt(x.m)}{f.reach === x.m && <Pill tone="good">мета</Pill>}</td><td className="num">{Math.round(x.members)}</td><td className="num">{Math.round(x.newPaying)}</td><td className="num">{uah(x.revenue)}</td><td className="num">{uah(x.ad)}</td><td className="num">{uah(x.profit)}</td><td className="num">{uah(x.cumProfit)}</td></tr>)}
            </tbody></table></details>
        </Section>
        <Section title="Як читати прогноз">
          <KV items={[
            { k: "Одна залучена людина приносить", v: `${uah(f.ltv)}: пробний ${uah(f.a.trialPrice)} і в середньому ${dec(f.paidMonths)} оплачених місяців по ${uah(f.a.monthPrice)}` },
            { k: "Залучення коштує", v: `${usd(cpa!)} = ${uah(f.cacUah)} за курсом ${dec(fx.rate, 2)}` },
            { k: "Стеля з цим бюджетом", v: `≈ ${Math.round(f.plateau)} учасниць від реклами (без нинішньої бази), коли прихід і відтік зрівняються` },
            { k: "Дохід на меті", v: `≈ ${uah(f.revenueAtTarget)} на місяць за ${Math.round(target!)} учасниць` },
            { k: "Відток цього місяця (факт)", v: `${act.basis.leftMonth} учасниць пішли з 1-го числа` },
          ]} />
          <p className="fld-h" style={{ marginTop: 10 }}>Це модель за середніми показниками: реальні місяці коливатимуться. Найсильніше на результат впливають частка продовжень і вартість залучення — змініть їх у «Припущеннях», щоб побачити обережний і оптимістичний сценарії.</p>
        </Section>
      </>}
    </Shell>
  );
}
