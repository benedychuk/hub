import { eq } from "drizzle-orm";
import { db, hasDb, schema } from "@/db";
import { creds, checkStatus, verifyResponse } from "@/lib/wayforpay";
import { applyResult } from "@/lib/payments";
import { money } from "@/lib/format";
import { MetaPixel, RefreshWhilePending } from "@/components/meta-pixel";

/** Meta Pixel для всіх офферів (ID не секретний; можна змінити змінною META_PIXEL_ID у Vercel). */
const PIXEL_ID = process.env.META_PIXEL_ID || "724340840721168";

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
  // Purchase лише для справжньої (бойової) оплати оффера; тестові оплати й прив'язка картки в рекламу не йдуть
  const paid = Boolean(a && ok && (a.kind === "first" || a.kind === "manual"));
  const [pl] = a && paid && a.planId ? await db().select({ id: schema.plans.id, key: schema.plans.key, name: schema.plans.name }).from(schema.plans).where(eq(schema.plans.id, a.planId)) : [];
  const purchase = a && paid && a.mode === "live" ? { value: Number(a.amount), currency: a.currency, orderId: a.orderReference, contentName: pl?.name ?? "Оплата Hub", contentId: pl?.key ?? String(a.planId ?? "hub") } : undefined;
  const [bot] = hasDb() ? await db().select({ username: schema.bots.username }).from(schema.bots).where(eq(schema.bots.key, "hub")) : [];
  return (
    <div className="landing">
      <MetaPixel pixelId={PIXEL_ID} purchase={purchase} />
      {a?.status === "pending" && <RefreshWhilePending />}
      <div className="card"><div className="in">
        <div className="brand" style={{ color: "var(--ink)", padding: 0 }}><i /><span>Hub</span> <small>клуб Марії</small></div>
        {!a ? <><h1>Платіж не знайдено</h1><p className="desc">Поверніться в бот і спробуйте ще раз.</p></>
          : ok ? <><h1>{a.kind === "first" || a.kind === "manual" ? "Оплату отримано" : "Картку прив’язано"}</h1><p className="desc">{a.kind === "first" || a.kind === "manual" ? `${money(a.amount, a.currency)} отримано. Посилання на закритий канал і подробиці вже в боті.` : "Перевірочна сума повернеться на картку впродовж кількох днів. Подробиці в боті."}</p></>
          : a.status === "pending" ? <><h1>Обробляємо платіж</h1><p className="desc">Банк ще підтверджує операцію. Сторінка оновиться сама, результат також прийде в бот за хвилину-дві.</p></>
          : <><h1>Оплата не пройшла</h1><p className="desc">{a.reason ? `Банк відповів: ${a.reason}.` : "Банк відхилив операцію."} Спробуйте іншу картку або зверніться в підтримку в боті.</p></>}
        <a className="btn pri" href={bot?.username ? `https://t.me/${bot.username}` : "#"} style={{ justifyContent: "center", padding: "12px 18px" }}>Повернутись у бот</a>
      </div></div>
    </div>
  );
}
