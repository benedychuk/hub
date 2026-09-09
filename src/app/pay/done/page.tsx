import { eq } from "drizzle-orm";
import { db, hasDb, schema } from "@/db";
import { creds, checkStatus, verifyResponse } from "@/lib/wayforpay";
import { applyResult } from "@/lib/payments";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Сторінка повернення після WayForPay: показує результат; якщо зворотний виклик ще не дійшов, питає статус у WayForPay. */
export default async function PayDone({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const sp = await searchParams;
  let a = hasDb() && sp.ref ? (await db().select().from(schema.paymentAttempts).where(eq(schema.paymentAttempts.orderReference, sp.ref)))[0] : undefined;
  if (a && a.status === "pending") {
    const c = creds(a.mode as "test" | "live");
    const r = await checkStatus(c, a.orderReference).catch(() => null);
    if (r && r.transactionStatus && r.merchantSignature && verifyResponse(c, r)) { await applyResult(a, r, c); a = (await db().select().from(schema.paymentAttempts).where(eq(schema.paymentAttempts.id, a.id)))[0]; }
  }
  const ok = a?.status === "approved";
  const [bot] = hasDb() ? await db().select({ username: schema.bots.username }).from(schema.bots).where(eq(schema.bots.key, "hub")) : [];
  return (
    <div className="landing">
      <div className="card"><div className="in">
        <div className="brand" style={{ color: "var(--ink)", padding: 0 }}><i /><span>Hub</span> <small>клуб Марії</small></div>
        {!a ? <><h1>Платіж не знайдено</h1><p className="desc">Поверніться в бот і спробуйте ще раз.</p></>
          : ok ? <><h1>{a.kind === "first" || a.kind === "manual" ? "Оплату отримано" : "Картку прив’язано"}</h1><p className="desc">{a.kind === "first" || a.kind === "manual" ? `${money(a.amount, a.currency)} отримано. Посилання на закритий канал і подробиці вже в боті.` : "Перевірочна сума повернеться на картку впродовж кількох днів. Подробиці в боті."}</p></>
          : a.status === "pending" ? <><h1>Обробляємо платіж</h1><p className="desc">Банк ще підтверджує операцію. Результат прийде в бот за хвилину-дві.</p></>
          : <><h1>Оплата не пройшла</h1><p className="desc">{a.reason ? `Банк відповів: ${a.reason}.` : "Банк відхилив операцію."} Спробуйте іншу картку або зверніться в підтримку в боті.</p></>}
        <a className="btn pri" href={bot?.username ? `https://t.me/${bot.username}` : "#"} style={{ justifyContent: "center", padding: "12px 18px" }}>Повернутись у бот</a>
      </div></div>
    </div>
  );
}
