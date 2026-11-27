import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { buildDashboard, USD_UAH } from "./dashboard";

/**
 * «Прорахунок та аналітика» (Маркетинг): скільки грошей і часу потрібно, щоб дійти до бажаної кількості учасниць.
 * Беремо фактичні показники клубу (ті самі формули, що на дашборді) і моделюємо помісячно:
 *   когорта пробних місяця: вік 0 — пробний період (рахується як учасниця), вік 1 — c1 (оплатили 1-й повний місяць),
 *   вік 2 — c1·c2 (оплатили 2-й), далі щомісяця ×r (частка продовжень). Нинішні учасниці щомісяця ×r.
 * Курс — офіційний курс НБУ (кешується на 6 год), якщо НБУ недоступний — 45 грн/$ як на дашборді.
 */
export type Assumptions = { c1: number; c2: number; r: number; trialPrice: number; monthPrice: number };
export type Inputs = { budgetUsd: number; cpaUsd: number; target: number; horizon?: number } & Partial<Assumptions>;

export async function nbuUsd(): Promise<{ rate: number; date: string | null; source: "nbu" | "fallback" }> {
  const d = db(); const key = "fx.usd.nbu";
  const [cached] = await d.select().from(schema.settings).where(eq(schema.settings.key, key));
  const v = cached?.value as { rate?: number; date?: string; at?: string } | undefined;
  if (v?.rate && v.at && Date.now() - new Date(v.at).getTime() < 6 * 3600_000) return { rate: v.rate, date: v.date ?? null, source: "nbu" };
  try {
    const r = await fetch("https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=USD&json", { signal: AbortSignal.timeout(8000), cache: "no-store" });
    const j = (await r.json()) as { rate?: number; exchangedate?: string }[];
    const rate = Number(j?.[0]?.rate);
    if (!rate) throw new Error("НБУ не повернув курс");
    const value = { rate, date: j[0].exchangedate ?? null, at: new Date().toISOString() };
    await d.insert(schema.settings).values({ key, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
    return { rate, date: value.date, source: "nbu" };
  } catch {
    return v?.rate ? { rate: v.rate, date: v.date ?? null, source: "nbu" } : { rate: USD_UAH, date: null, source: "fallback" };
  }
}

/** Фактичні показники клубу як припущення прогнозу (з поясненням, звідки кожен). */
export async function actualAssumptions() {
  const d = await buildDashboard();
  const share = (a: number, b: number, fb: number) => (b > 0 ? a / b : fb);
  const r90 = share(d.rates.renewed90, d.rates.due90, d.pRenew);
  // пробний → 1-й місяць: з пробних через Hub; якщо їх ще замало (< 5), — загальна оцінка з прогнозу дашборда
  const c1 = d.conv.trials >= 5 ? d.conv.trials_paid / d.conv.trials : d.pTrial;
  const c2 = share(d.conv.firsts_paid, d.conv.firsts, r90);
  return {
    members: d.members,
    a: { c1, c2, r: r90, trialPrice: Math.round(d.rates.avg_trial_uah || 0), monthPrice: Math.round(d.rates.avg_month_uah || d.arpu || 0) } as Assumptions,
    basis: {
      trials: d.conv.trials, trialsPaid: d.conv.trials_paid, firsts: d.conv.firsts, firstsPaid: d.conv.firsts_paid,
      due90: d.rates.due90, renewed90: d.rates.renewed90, leftMonth: d.left, arpu: d.arpu,
    },
  };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
/** Помісячна модель: учасниці, дохід і витрати на рекламу. */
export function simulate(m0: number, trialsPerMonth: number, a: Assumptions, adUah: number, horizon: number) {
  const r = clamp(a.r, 0, 0.99), c1 = clamp(a.c1, 0, 1), c2 = clamp(a.c2, 0, 1);
  const alive = (age: number) => (age === 0 ? 1 : age === 1 ? c1 : c1 * c2 * Math.pow(r, age - 2)); // частка когорти, що в клубі на вікі age
  const paying = (age: number) => (age === 0 ? 0 : alive(age));
  const rows: { m: number; trials: number; members: number; existing: number; newPaying: number; revenue: number; ad: number; profit: number; cumProfit: number }[] = [];
  let cum = 0;
  for (let t = 1; t <= horizon; t++) {
    const existing = m0 * Math.pow(r, t);
    let fromAds = 0, payingFromAds = 0;
    for (let age = 0; age < t; age++) { fromAds += trialsPerMonth * alive(age); payingFromAds += trialsPerMonth * paying(age); }
    const revenue = trialsPerMonth * a.trialPrice + payingFromAds * a.monthPrice + existing * a.monthPrice;
    const profit = revenue - adUah; cum += profit;
    rows.push({ m: t, trials: trialsPerMonth, members: existing + fromAds, existing, newPaying: payingFromAds, revenue, ad: adUah, profit, cumProfit: cum });
  }
  return rows;
}
/** Скільки учасниць тримає клуб, якщо щомісяця приходить T пробних (стала рівновага, без нинішньої бази). */
export const steadyState = (T: number, a: Assumptions) => { const r = clamp(a.r, 0, 0.99); return T * (1 + a.c1 + (a.c1 * a.c2) / (1 - r)); };

export function forecast(inp: Inputs, m0: number, base: Assumptions, fx: number) {
  const a: Assumptions = { c1: inp.c1 ?? base.c1, c2: inp.c2 ?? base.c2, r: inp.r ?? base.r, trialPrice: inp.trialPrice ?? base.trialPrice, monthPrice: inp.monthPrice ?? base.monthPrice };
  const horizon = inp.horizon ?? 24;
  const cacUah = inp.cpaUsd * fx;
  const T = inp.cpaUsd > 0 ? inp.budgetUsd / inp.cpaUsd : 0;
  const rows = simulate(m0, T, a, inp.budgetUsd * fx, horizon);
  const reach = rows.find((x) => x.members >= inp.target)?.m ?? null;
  const plateau = steadyState(T, a);
  // бюджет, щоб дійти до мети за N місяців (бінарний пошук за кількістю пробних)
  // «за N місяців» = дійти до мети не пізніше ніж у N-й місяць
  const reaches = (T: number, months: number) => simulate(m0, T, a, 0, months).some((x) => x.members >= inp.target);
  const budgetFor = (months: number) => {
    if (reaches(0, months)) return 0;
    let lo = 0, hi = Math.max(10, inp.target * 2);
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (reaches(mid, months)) hi = mid; else lo = mid; }
    return hi * inp.cpaUsd;
  };
  const r = clamp(a.r, 0, 0.99);
  const paidMonths = a.c1 + (a.c1 * a.c2) / (1 - r);             // очікувана кількість оплачених повних місяців на одного пробного
  const ltv = a.trialPrice + a.monthPrice * paidMonths;           // дохід з одного пробного за весь час
  const breakEvenPrice = paidMonths > 0 ? Math.max(0, (cacUah - a.trialPrice) / paidMonths) : null; // ціна місяця, за якої реклама окупається
  // за скільки місяців окупається один залучений пробний
  let acc = a.trialPrice, payback: number | null = acc >= cacUah ? 0 : null;
  for (let age = 1; age <= 36 && payback === null; age++) { acc += a.monthPrice * (age === 1 ? a.c1 : a.c1 * a.c2 * Math.pow(r, age - 2)); if (acc >= cacUah) payback = age; }
  const steadyTrialsForTarget = inp.target / (1 + a.c1 + (a.c1 * a.c2) / (1 - r));
  return {
    a, rows, reach, plateau, trialsPerMonth: T, cacUah, ltv, ltvToCac: cacUah > 0 ? ltv / cacUah : null, paidMonths, breakEvenPrice, payback,
    budget6: budgetFor(6), budget12: budgetFor(12), budgetHold: steadyTrialsForTarget * inp.cpaUsd,
    revenueAtTarget: inp.target * a.monthPrice,
  };
}
