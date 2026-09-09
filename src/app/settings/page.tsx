import Link from "next/link";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { navCounts, syncRunList, settingsMap } from "@/lib/queries";
import { dateTime } from "@/lib/format";
import { hasDb } from "@/db";
import SyncPanel from "./sync-panel";
import UsersTab from "./users-tab";
import AccountTab from "./account-tab";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
const TABS = [["general", "Загальні"], ["users", "Користувачі та доступ"], ["account", "Мій акаунт"]] as const;

export default async function Settings({ searchParams }: { searchParams: Promise<{ tab?: string; ok?: string; err?: string; link?: string; for?: string; reset?: string }> }) {
  const sp = await searchParams;
  const tab = TABS.some((t) => t[0] === sp.tab) ? sp.tab! : "general";
  const [counts, runs, st, me] = await Promise.all([navCounts(), syncRunList(), settingsMap(), currentUser()]);
  if (tab !== "general") {
    return (
      <Shell title="Налаштування" counts={counts}>
        <div className="tabs">{TABS.map(([k, l]) => <Link key={k} href={`/settings?tab=${k}`} className={tab === k ? "on" : ""}>{l}</Link>)}</div>
        {sp.ok && <div className="alert ok">{sp.ok}</div>}
        {sp.err && <div className="alert bad">{sp.err}</div>}
        {tab === "users" ? <UsersTab me={me} link={sp.link} linkFor={sp.for} reset={Boolean(sp.reset)} /> : <AccountTab me={me} />}
      </Shell>
    );
  }
  const env = [
    ["DATABASE_URL", hasDb(), "база Neon; додається інтеграцією Vercel → Storage"],
    ["ZENEDU_API_TOKEN", Boolean(process.env.ZENEDU_API_TOKEN), "токен воркспейсу ZenEdu"],
    ["TELEGRAM_BOT_TOKEN", Boolean(process.env.TELEGRAM_BOT_TOKEN), "токен Hub-бота з BotFather"],
    ["ADMIN_PASSWORD", Boolean(process.env.ADMIN_PASSWORD), "спільний пароль: потрібен лише для створення акаунта власника; далі вхід за акаунтами"],
    ["ADMIN_TELEGRAM_ID", Boolean(process.env.ADMIN_TELEGRAM_ID), "ваш telegram id для тестових розсилок"],
    ["ZENEDU_WEBHOOK_SECRET", Boolean(process.env.ZENEDU_WEBHOOK_SECRET), "довільний секрет для адреси вебхука ZenEdu"],
    ["CRON_SECRET", Boolean(process.env.CRON_SECRET), "захист щоденного cron; Vercel підставляє сам"],
  ] as const;
  return (
    <Shell title="Налаштування" counts={counts}>
      <div className="tabs">{TABS.map(([k, l]) => <Link key={k} href={`/settings?tab=${k}`} className={tab === k ? "on" : ""}>{l}</Link>)}</div>
      <div className="grid g2">
        <div className="card"><h3>Змінні оточення <span className="sub">Vercel → Settings → Environment Variables</span></h3>
          {env.map(([k, ok, d]) => <div className="ent" key={k}><span className={`dot ${ok ? "" : "off"}`} /><div><b className="mono">{k}</b><small>{d}</small></div><Pill tone={ok ? "good" : "mute"}>{ok ? "є" : "немає"}</Pill></div>)}
          <p className="note">Після зміни змінних потрібен новий деплой: Vercel → Deployments → Redeploy.</p>
        </div>
        <div className="card"><h3>Імпорт із ZenEdu</h3>
          <dl className="kv"><dt>Останній повний імпорт</dt><dd className="mono">{st["sync.last_full_at"] ? dateTime(String(st["sync.last_full_at"])) : "ще не було"}</dd><dt>Фаза</dt><dd className="mono">{String(st["sync.phase"] ?? "start")}</dd><dt>Бот ZenEdu</dt><dd className="mono">{String(st["zenedu_bot_id"] ?? "—")}</dd></dl>
          <SyncPanel ready={hasDb() && Boolean(process.env.ZENEDU_API_TOKEN)} />
          <p className="note">Повний імпорт іде частинами по 20 сторінок через ліміт ZenEdu 60 запитів/хв: близько 5 173 підписників і 3 400 замовлень займають 6–8 хвилин. Сторінку можна не закривати.</p>
        </div>
        <div className="card"><h3>Вебхук ZenEdu</h3>
          <p>У ZenEdu відкрийте Workspace → Settings → API &amp; Webhooks, додайте адресу і оберіть усі події:</p>
          <p className="mono" style={{ wordBreak: "break-all" }}>{(process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL : "https://<домен>"))}/api/webhooks/zenedu{process.env.ZENEDU_WEBHOOK_SECRET ? `?key=${process.env.ZENEDU_WEBHOOK_SECRET}` : ""}</p>
          <p className="note">Тоді оплати, скасування і повідомлення з бота ZenEdu з'являтимуться в історії людини одразу, а не раз на добу.</p>
        </div>
        <div className="card tbl"><h3>Журнал імпорту</h3><table><thead><tr><th>Коли</th><th>Тип</th><th>Стан</th><th>Результат</th></tr></thead><tbody>
          {runs.map((r) => <tr key={r.id}><td className="mono">{dateTime(r.startedAt)}</td><td className="mono">{r.kind}</td><td><Pill tone={r.status === "done" ? "good" : r.status === "error" ? "crit" : "warn"}>{r.status}</Pill></td><td className="mono" style={{ fontSize: 11.5 }}>{r.error ? r.error.slice(0, 120) : Object.entries(r.stats).map(([k, v]) => `${k}=${v}`).join(" ")}</td></tr>)}
          {!runs.length && <tr><td colSpan={4} className="muted">Ще не запускався.</td></tr>}
        </tbody></table></div>
      </div>
    </Shell>
  );
}
