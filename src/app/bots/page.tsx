import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { navCounts, botList } from "@/lib/queries";
import { setupWebhook } from "@/lib/actions";
import { appUrl, webhookInfo } from "@/lib/bot";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Bots() {
  const [counts, list] = await Promise.all([navCounts(), botList()]);
  const hasToken = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const info = hasToken ? await webhookInfo() : null;
  const hub = list.find((b) => b.key === "hub");
  const zen = list.filter((b) => b.role === "zenedu");
  const url = (info as { url?: string })?.url;
  return (
    <Shell title="Боти й меню" counts={counts}>
      <div className="grid g2">
        <div className="card"><h3>Hub-бот <Pill tone={hasToken ? (url ? "good" : "warn") : "crit"}>{!hasToken ? "токен не заданий" : url ? "вебхук працює" : "вебхук не встановлено"}</Pill></h3>
          <dl className="kv"><dt>Username</dt><dd className="mono">{hub?.username ? "@" + hub.username : "—"}</dd><dt>Адреса вебхука</dt><dd className="mono">{url || `${appUrl()}/api/telegram/hub`}</dd><dt>Очікують апдейтів</dt><dd className="mono">{(info as { pending_update_count?: number })?.pending_update_count ?? "—"}</dd><dt>Остання помилка</dt><dd className="mono">{(info as { last_error_message?: string })?.last_error_message ?? "немає"}</dd><dt>Встановлено</dt><dd className="mono">{dateTime(hub?.webhookSetAt)}</dd></dl>
          <div className="row-actions" style={{ marginTop: 12 }}>{hasToken ? <form action={setupWebhook}><button className="btn pri" type="submit">{url ? "Переустановити вебхук" : "Увімкнути бота"}</button></form> : <span className="muted">Додайте TELEGRAM_BOT_TOKEN у Vercel і зробіть редеплой.</span>}</div>
          <h3 style={{ marginTop: 18 }}>Команди</h3>
          <div className="ent"><span className="dot" /><div><b>/start</b><small>вітання; впізнає учасницю ZenEdu за telegram id і показує стан підписки</small></div></div>
          <div className="ent"><span className="dot" /><div><b>/subscriptions</b><small>мої підписки: ціна, статус, наступне списання</small></div></div>
          <div className="ent"><span className="dot" /><div><b>/plans</b><small>тарифи з розділу «Тарифи»</small></div></div>
          <div className="ent"><span className="dot warn" /><div><b>будь-яке повідомлення</b><small>потрапляє в «Чати», відповідь з панелі</small></div></div>
        </div>
        <div className="card"><h3>Бот ZenEdu <Pill tone="">лише читання</Pill></h3>
          {zen.map((b) => <dl className="kv" key={b.id}><dt>Назва</dt><dd>{b.name}</dd><dt>Username</dt><dd className="mono">@{b.username}</dd><dt>Стан</dt><dd>{b.isActive ? "активний" : "зупинений"}</dd></dl>)}
          {!zen.length && <p className="muted">З'явиться після імпорту.</p>}
          <p className="note">Бот ZenEdu лишається як є. Hub-бот працює паралельно на своєму токені.</p>
          <h3 style={{ marginTop: 18 }}>«Щиро»</h3>
          <p className="note">Підключення перевірки права перед відповіддю робиться в коді «Щиро» на етапі 1: один HTTP-запит до Hub з telegram id.</p>
        </div>
      </div>
    </Shell>
  );
}
