import { and, eq } from "drizzle-orm";
import { db, hasDb, schema } from "@/db";
import { parsePayToken, paymentSettings } from "@/lib/payments";
import { offerAvailability, priceLabel, accessLabel, intervalLabel, telegramHtmlToSafe } from "@/lib/offers";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Публічна сторінка оплати оффера: відкривається з бота за підписаним посиланням. ?preview=1 — перегляд оформлення без оплати. */
export default async function PayPage({ params, searchParams }: { params: Promise<{ plan: string }>; searchParams: Promise<{ u?: string; k?: string; err?: string; preview?: string }> }) {
  const { plan } = await params; const sp = await searchParams;
  const kind = (["first", "card", "migrate"].includes(sp.k ?? "") ? sp.k : "first") as "first" | "card" | "migrate";
  const preview = sp.preview === "1";
  const personId = hasDb() && !preview ? parsePayToken(sp.u, plan, kind) : null;
  const [pl] = hasDb() ? await db().select().from(schema.plans).where(eq(schema.plans.key, plan)) : [];
  const [p] = personId ? await db().select().from(schema.persons).where(eq(schema.persons.id, personId)) : [];
  const [zen] = personId && kind === "migrate" ? await db().select().from(schema.subscriptions).where(and(eq(schema.subscriptions.personId, personId), eq(schema.subscriptions.source, "zenedu"))) : [];
  const st = hasDb() ? await paymentSettings() : { mode: "test" as const, verifyAmount: 1 };
  const av = pl ? await offerAvailability(pl) : { ok: false as const, reason: "Оффер не знайдено" };
  const ok = pl && (preview || p);
  const oneTime = pl?.paymentType === "one_time";
  const trial = kind === "first" && pl && !oneTime && pl.trialDays > 0;
  const amount = kind === "first" ? (trial ? Number(pl!.trialPrice ?? 0) : Number(pl?.price ?? 0)) : st.verifyAmount;
  const d = pl?.design ?? {}; const os = pl?.settings ?? {};
  const title = d.titleMode === "custom" && d.title ? d.title : pl?.name ?? "";
  const btn = d.buttonText || "Оплатити";
  const needEmail = Boolean(os.collectEmail && p && !p.email);
  return (
    <div className="landing">
      <div className="card">
        {ok && d.image && kind === "first" && <div className="cover-prev" style={{ backgroundImage: `url(${d.image})`, height: 200, borderRadius: "12px 12px 0 0" }} aria-hidden />}
        <div className="in">
          <div className="brand" style={{ color: "var(--ink)", padding: 0 }}><i /><span>Hub</span> <small>клуб Марії</small></div>
          {!ok ? <><h1>Посилання недійсне</h1><p className="desc">Відкрийте оплату ще раз із Hub-бота: команда /plans.</p></> : <>
            <h1>{kind === "first" ? title : kind === "migrate" ? "Переїзд у Hub" : "Оновити картку"}</h1>
            {kind === "first" && d.description && <div className="desc" dangerouslySetInnerHTML={{ __html: telegramHtmlToSafe(d.description) }} />}
            <div className="summary">
              {kind === "first" && <>
                <div><dt>{oneTime ? "Разова оплата" : "Підписка"}</dt><dd>{priceLabel(pl!)}</dd></div>
                {oneTime ? <div><dt>Доступ</dt><dd>{accessLabel(pl!)}</dd></div> : <div><dt>Списання</dt><dd>кожні {intervalLabel(pl!)}, скасувати можна будь-коли</dd></div>}
                {trial && <div><dt>Пробний період</dt><dd>{pl!.trialDays} дн за {money(pl!.trialPrice ?? 0, pl!.currency)}, далі {money(pl!.price, pl!.currency)}</dd></div>}
                {pl!.salesEndAt && <div><dt>Продажі до</dt><dd>{pl!.salesEndAt.toLocaleDateString("uk-UA")}</dd></div>}
              </>}
              {kind === "migrate" && <><div><dt>Ваша підписка</dt><dd>{zen ? `${money(zen.price, zen.currency)} / ${zen.periodDays} дн` : priceLabel(pl!)}</dd></div><div><dt>Наступне списання</dt><dd>{zen?.currentPeriodEnd ? zen.currentPeriodEnd.toLocaleDateString("uk-UA") : "за графіком"}</dd></div><div><dt>Перевірочна сума</dt><dd>{money(amount, pl!.currency)} з поверненням</dd></div></>}
              {kind === "card" && <div><dt>Перевірочна сума</dt><dd>{money(amount, pl!.currency)} з поверненням</dd></div>}
              {p && <div><dt>Платник</dt><dd>{[p.firstName, p.lastName].filter(Boolean).join(" ") || "@" + p.username}</dd></div>}
            </div>
            {sp.err && <div className="alert bad">{sp.err}</div>}
            {preview && <div className="alert">Попередній перегляд: так сторінку бачить людина, яка відкрила оплату з бота. Кнопка тут не працює.</div>}
            {!preview && !av.ok && kind === "first" && <div className="alert bad">{av.reason}.</div>}
            {st.mode === "test" && !preview && <div className="alert">Тестовий режим: гроші не списуються. Для перевірки підійде тестова картка WayForPay.</div>}
            <form action={`/pay/${encodeURIComponent(plan)}/go`} method="get" className="form">
              <input type="hidden" name="u" value={sp.u ?? ""} /><input type="hidden" name="k" value={kind} />
              {needEmail && kind === "first" && <label className="fld"><span className="fld-l">Email для чеків і доступу</span><input name="email" type="email" required placeholder="name@example.com" /></label>}
              <button className="btn pri" type="submit" disabled={preview || (kind === "first" && !av.ok)} style={{ justifyContent: "center", fontSize: 15, padding: "12px 18px" }}>{kind === "first" ? `${btn} ${money(amount, pl!.currency)}` : kind === "migrate" ? "Прив'язати картку" : "Оновити картку"}</button>
            </form>
            <p className="note" style={{ textAlign: "center", margin: 0 }}>Оплата на захищеній сторінці WayForPay. Hub не бачить номер картки, лише токен для наступних списань.{!oneTime ? " Скасувати підписку можна будь-коли командою /subscriptions у боті." : ""}</p>
          </>}
        </div>
      </div>
    </div>
  );
}
