import { and, eq } from "drizzle-orm";
import { db, hasDb, schema } from "@/db";
import { parsePayToken, paymentSettings } from "@/lib/payments";
import { money, PERIOD } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Публічна сторінка оплати тарифу: відкривається з бота за підписаним посиланням. */
export default async function PayPage({ params, searchParams }: { params: Promise<{ plan: string }>; searchParams: Promise<{ u?: string; k?: string; err?: string }> }) {
  const { plan } = await params; const sp = await searchParams;
  const kind = (["first", "card", "migrate"].includes(sp.k ?? "") ? sp.k : "first") as "first" | "card" | "migrate";
  const personId = hasDb() ? parsePayToken(sp.u, plan, kind) : null;
  const [pl] = hasDb() ? await db().select().from(schema.plans).where(eq(schema.plans.key, plan)) : [];
  const [p] = personId ? await db().select().from(schema.persons).where(eq(schema.persons.id, personId)) : [];
  const [zen] = personId && kind === "migrate" ? await db().select().from(schema.subscriptions).where(and(eq(schema.subscriptions.personId, personId), eq(schema.subscriptions.source, "zenedu"))) : [];
  const st = hasDb() ? await paymentSettings() : { mode: "test" as const, verifyAmount: 1 };
  const ok = pl && pl.isActive && p;
  const trial = kind === "first" && pl && pl.trialDays > 0;
  const amount = kind === "first" ? (trial ? Number(pl!.trialPrice ?? 0) : Number(pl?.price ?? 0)) : st.verifyAmount;
  return (
    <div className="landing">
      <div className="card">
        <div className="in">
          <div className="brand" style={{ color: "var(--ink)", padding: 0 }}><i /><span>Hub</span> <small>клуб Марії</small></div>
          {!ok ? <><h1>Посилання недійсне</h1><p className="desc">Відкрийте оплату ще раз із Hub-бота: команда /plans.</p></> : <>
            <h1>{kind === "first" ? pl.name : kind === "migrate" ? "Переїзд у Hub" : "Оновити картку"}</h1>
            <div className="summary">
              {kind === "first" && <><div><dt>Тариф</dt><dd>{pl.name}</dd></div><div><dt>Ціна</dt><dd>{money(pl.price, pl.currency)} / {PERIOD[pl.period] ?? pl.period}</dd></div>{trial && <div><dt>Пробний період</dt><dd>{pl.trialDays} дн за {money(amount, pl.currency)}</dd></div>}</>}
              {kind === "migrate" && <><div><dt>Ваша підписка</dt><dd>{zen ? `${money(zen.price, zen.currency)} / ${zen.periodDays} дн` : money(pl.price, pl.currency)}</dd></div><div><dt>Наступне списання</dt><dd>{zen?.currentPeriodEnd ? zen.currentPeriodEnd.toLocaleDateString("uk-UA") : "за графіком"}</dd></div><div><dt>Зараз спишемо</dt><dd>{money(amount, pl.currency)} з поверненням</dd></div></>}
              {kind === "card" && <><div><dt>Перевірочна сума</dt><dd>{money(amount, pl.currency)} з поверненням</dd></div></>}
              <div><dt>Платник</dt><dd>{[p.firstName, p.lastName].filter(Boolean).join(" ") || "@" + p.username}</dd></div>
            </div>
            {sp.err && <div className="alert bad">{sp.err}</div>}
            {st.mode === "test" && <div className="alert">Тестовий режим: гроші не списуються. Для перевірки підійде тестова картка WayForPay.</div>}
            <a className="btn pri" href={`/pay/${encodeURIComponent(plan)}/go?u=${encodeURIComponent(sp.u ?? "")}&k=${kind}`} style={{ justifyContent: "center", fontSize: 15, padding: "12px 18px" }}>{kind === "first" ? `Оплатити ${money(amount, pl.currency)}` : "Прив’язати картку"}</a>
            <p className="note" style={{ textAlign: "center", margin: 0 }}>Оплата на захищеній сторінці WayForPay. Hub не бачить номер картки, лише токен для наступних списань. Скасувати підписку можна будь-коли в боті: /subscriptions.</p>
          </>}
        </div>
      </div>
    </div>
  );
}
