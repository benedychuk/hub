import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Діагностика швидкодії для «Налаштування»: де працюють функції Hub (Vercel) і де база (Neon), і скільки триває запит до бази.
 * Кожна сторінка робить кілька запитів до Neon по мережі; якщо функції й база в різних регіонах (напр., США і Європа),
 * кожен запит додає ~100 мс, і сторінки «підлагують». Лише читає, нічого не змінює.
 */
const VERCEL_TO_AWS: Record<string, string> = {
  fra1: "eu-central-1", cdg1: "eu-west-3", lhr1: "eu-west-2", dub1: "eu-west-1", arn1: "eu-north-1",
  iad1: "us-east-1", cle1: "us-east-2", pdx1: "us-west-2", sfo1: "us-west-1", gru1: "sa-east-1",
  sin1: "ap-southeast-1", syd1: "ap-southeast-2", hnd1: "ap-northeast-1", icn1: "ap-northeast-2", kix1: "ap-northeast-3", bom1: "ap-south-1", hkg1: "ap-east-1", cpt1: "af-south-1",
};
const AWS_TO_VERCEL = Object.fromEntries(Object.entries(VERCEL_TO_AWS).map(([v, a]) => [a, v]));

export function dbRegion(url = process.env.DATABASE_URL ?? "") {
  try { const h = new URL(url).hostname; return h.match(/\.([a-z]{2}-[a-z]+-\d)\.aws\.neon\.tech$/)?.[1] ?? null; } catch { return null; }
}
export async function perfInfo() {
  const fn = process.env.VERCEL_REGION ?? null;
  const dbr = dbRegion();
  const times: number[] = [];
  for (let i = 0; i < 3; i++) { const t = performance.now(); await db().execute(sql`select 1`); times.push(performance.now() - t); }
  times.sort((a, b) => a - b);
  // JIT-компіляція в Postgres на запитах дашборда займала секунди; міграція 0018 вимикає її для бази
  const [j] = (await db().execute(sql`select current_setting('jit', true) as jit`)).rows as { jit: string | null }[];
  const fnAws = fn ? VERCEL_TO_AWS[fn] ?? null : null;
  return {
    fnRegion: fn, dbRegion: dbr, pingMs: Math.round(times[1]), jitOn: j?.jit === "on",
    mismatch: Boolean(fnAws && dbr && fnAws !== dbr),
    suggest: dbr ? AWS_TO_VERCEL[dbr] ?? null : null,
  };
}
