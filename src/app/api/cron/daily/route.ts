import { runIncrementalSync } from "@/lib/sync";
import { reconcile } from "@/lib/telegram-access";
import { dailyPayments } from "@/lib/payments";
import { shchyroFullSync, shchyroSettings } from "@/lib/shchyro";
import { onboardingDaily } from "@/lib/onboarding";
import { hasDb } from "@/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) return Response.json({ ok: false }, { status: 401 });
  if (!hasDb()) return Response.json({ ok: false, reason: "not configured" });
  try {
    const stats = process.env.ZENEDU_API_TOKEN ? await runIncrementalSync().catch((e) => ({ error: String(e) })) : null;
    const rec = process.env.TELEGRAM_BOT_TOKEN ? await reconcile().catch((e) => ({ error: String(e) })) : null;
    const payments = await dailyPayments().catch((e) => ({ error: String(e) }));
    // щоденна звірка списку доступу «Щиро» з Hub; без force: масове відключення зупиниться на боці «Щиро» і буде видно на сторінці ботів
    const shchyro = (await shchyroSettings()).enabled ? await shchyroFullSync({ by: "cron" }).catch((e) => ({ error: String(e) })) : null;
    const onboarding = await onboardingDaily().catch((e) => ({ error: String(e) })); // стани тріалу кабінету: теги «закінчується», «14 днів минули», «доступ завершено»
    return Response.json({ ok: true, stats, reconcile: rec, payments, shchyro, onboarding });
  }
  catch (e) { return Response.json({ ok: false, error: String(e) }, { status: 500 }); }
}
