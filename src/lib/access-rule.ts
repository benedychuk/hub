import { inArray, eq } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Єдине правило доступу за підпискою для каналів, «Щиро» та кабінету онбордингу.
 *
 * Доступ є, поки підписка активна, і ще ACCESS_GRACE_HOURS (типово 24) після кінця
 * оплаченого періоду, якщо підписку скасовано або списання не пройшло: за цей час
 * людина може поновити оплату, і все повернеться само. Пауза закриває доступ одразу.
 * Після грейсу канал виключає, «Щиро» закривається, кабінет переходить у стан
 * «доступ завершено».
 */
export const DEFAULT_GRACE_HOURS = 24;
const CLOSED = new Set(["paused"]);

export async function accessGraceHours(): Promise<number> {
  try {
    const [r] = await db().select().from(schema.settings).where(eq(schema.settings.key, "access.graceHours"));
    const v = Number(r?.value); return Number.isFinite(v) && v >= 0 ? v : DEFAULT_GRACE_HOURS;
  } catch { return DEFAULT_GRACE_HOURS; }
}

export type SubLike = { status: string; currentPeriodEnd: Date | null; kind?: string };
/** Коли закінчується доступ за цією підпискою з урахуванням грейсу; null = безстроково. */
export function accessEnd(s: SubLike, graceHours: number): Date | null {
  return s.currentPeriodEnd ? new Date(s.currentPeriodEnd.getTime() + graceHours * 3600_000) : null;
}
/** Чи дає підписка доступ зараз. */
export function subscriptionAllows(s: SubLike, graceHours: number, now = new Date()): boolean {
  if (CLOSED.has(s.status)) return false;
  const end = accessEnd(s, graceHours);
  if (end) return end > now;
  return ["active", "trialing"].includes(s.status);
}
/** SQL-умова тієї самої логіки для таблиці підписок з псевдонімом alias. */
export function subscriptionAllowsSql(alias: string, graceHours: number) {
  return `(${alias}.status <> 'paused' and (case when ${alias}.current_period_end is null then ${alias}.status in ('active','trialing') else ${alias}.current_period_end + (${Math.max(0, Math.round(graceHours))} * interval '1 hour') > now() end))`;
}
export { inArray };
