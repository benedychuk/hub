import Link from "next/link";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { Section, Row, EmptyState, KV, Alert } from "@/components/ui/layout";
import { navCounts, syncRunList, settingsMap } from "@/lib/queries";
import { dateTime } from "@/lib/format";
import { hasDb } from "@/db";
import SyncPanel from "./sync-panel";
import UsersTab from "./users-tab";
import AccountTab from "./account-tab";
import PaymentsTab from "./payments-tab";
import { currentUser } from "@/lib/auth";
import { perfInfo } from "@/lib/perf";

export const dynamic = "force-dynamic";
const TABS = [["general", "Загальні"], ["payments", "Оплати"], ["users", "Користувачі та доступ"], ["account", "Мій акаунт"]] as const;

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
        {tab === "users" ? <UsersTab me={me} link={sp.link} linkFor={sp.for} reset={Boolean(sp.reset)} /> : tab === "payments" ? <PaymentsTab link={sp.link} /> : <AccountTab me={me} />}
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
    ["SHCHYRO_API_URL", Boolean(process.env.SHCHYRO_API_URL), "адреса панелі «Щиро» разом із її префіксом, напр. https://panel…/panel-x7k2"],
    ["SHCHYRO_API_SECRET", Boolean(process.env.SHCHYRO_API_SECRET), "спільний секрет API «Щиро» (HUB_API_SECRET у боті)"],
    ["ONBOARDING_URL", Boolean(process.env.ONBOARDING_URL), "адреса платформи онбордингу для посилань у кабінет, напр. https://mariia-kravchuk.com.ua/app"],
    ["ONBOARDING_TOKEN_SECRET", Boolean(process.env.ONBOARDING_TOKEN_SECRET), "секрет підпису токенів кабінету; якщо порожній, береться SESSION_SECRET"],
  ] as const;
  const perf = hasDb() ? await perfInfo().catch(() => null) : null;
  return (
    <Shell title="Налаштування" counts={counts}>
      <div className="tabs">{TABS.map(([k, l]) => <Link key={k} href={`/settings?tab=${k}`} className={tab === k ? "on" : ""}>{l}</Link>)}</div>
      {perf?.mismatch && <Alert tone="warn">Функції Hub працюють у регіоні {perf.fnRegion}, а база Neon — у {perf.dbRegion}. Кожен запит до бази йде між регіонами, тому сторінки відкриваються повільніше. Виправлення: Vercel → Settings → Functions → Function Region → {perf.suggest ?? "регіон бази"}, потім новий деплой. Дані й логіка не змінюються.</Alert>}
      {perf && <Section title="Швидкодія" description="Де працює Hub і як швидко відповідає база. Якщо регіони різні, кожна сторінка чекає на базу довше.">
        <KV items={[
          { k: "Регіон функцій (Vercel)", v: perf.fnRegion ?? "невідомо (не Vercel)", mono: true },
          { k: "Регіон бази (Neon)", v: perf.dbRegion ?? "невідомо", mono: true },
          { k: "Запит до бази", v: `${perf.pingMs} мс`, mono: true },
          { k: "Компіляція запитів (JIT)", v: perf.jitOn ? "увімкнена: важкі сторінки чекають на неї секундами" : "вимкнена", mono: true },
        ]} />
        <div style={{ marginTop: 8 }}>{perf.mismatch ? <Pill tone="warn">різні регіони</Pill> : perf.jitOn ? <Pill tone="warn">JIT увімкнено</Pill> : perf.pingMs > 40 ? <Pill tone="warn">база відповідає повільно</Pill> : <Pill tone="good">в нормі</Pill>}</div>
      </Section>}
      <div className="grid g2">
        <Section title="Змінні оточення" description="Vercel → Settings → Environment Variables. Після зміни потрібен новий деплой.">
          {env.map(([k, ok, d]) => <Row key={k} tone={ok ? "on" : "off"} title={<span className="mono">{k}</span>} sub={d} right={<Pill tone={ok ? "good" : "mute"}>{ok ? "задано" : "немає"}</Pill>} />)}
        </Section>
        <Section title="Імпорт із ZenEdu" description="Повний імпорт іде частинами по 20 сторінок через ліміт ZenEdu 60 запитів/хв: близько 6–8 хвилин. Сторінку можна не закривати.">
          <KV items={[{ k: "Останній повний імпорт", v: st["sync.last_full_at"] ? dateTime(String(st["sync.last_full_at"])) : "ще не було", mono: true }, { k: "Фаза", v: String(st["sync.phase"] ?? "start"), mono: true }, { k: "Бот ZenEdu", v: String(st["zenedu_bot_id"] ?? "—"), mono: true }]} />
          <div style={{ marginTop: 12 }}><SyncPanel ready={hasDb() && Boolean(process.env.ZENEDU_API_TOKEN)} /></div>
        </Section>
        <Section title="Вебхук ZenEdu" description="У ZenEdu відкрийте Workspace → Settings → API & Webhooks, додайте адресу і оберіть усі події. Тоді оплати й скасування з’являтимуться одразу.">
          <div className="copybox"><span style={{ userSelect: "all" }}>{(process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL : "https://<домен>"))}/api/webhooks/zenedu{process.env.ZENEDU_WEBHOOK_SECRET ? `?key=${process.env.ZENEDU_WEBHOOK_SECRET}` : ""}</span></div>
        </Section>
        <Section title="Журнал імпорту" className="tbl">
          <table><thead><tr><th>Коли</th><th>Тип</th><th>Стан</th><th>Результат</th></tr></thead><tbody>
            {runs.map((r) => <tr key={r.id}><td className="mono">{dateTime(r.startedAt)}</td><td className="mono">{r.kind}</td><td><Pill tone={r.status === "done" ? "good" : r.status === "error" ? "crit" : "warn"}>{r.status}</Pill></td><td className="mono" style={{ fontSize: 11.5 }}>{r.error ? r.error.slice(0, 120) : Object.entries(r.stats).map(([k, v]) => `${k}=${v}`).join(" ")}</td></tr>)}
            {!runs.length && <tr><td colSpan={4}><EmptyState title="Ще не запускався" /></td></tr>}
          </tbody></table>
        </Section>
      </div>
    </Shell>
  );
}
