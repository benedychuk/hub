import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { navCounts, botList, resourceList } from "@/lib/queries";
import { setupWebhook, createExternalBot, rotateBotKey, toggleBot } from "@/lib/actions";
import { appUrl, webhookInfo } from "@/lib/bot";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Bots({ searchParams }: { searchParams: Promise<{ newkey?: string; for?: string }> }) {
  const sp = await searchParams;
  const [counts, list, res] = await Promise.all([navCounts(), botList(), resourceList()]);
  const ext = list.filter((b) => b.mode === "external");
  const base = appUrl();
  const hasToken = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const info = hasToken ? await webhookInfo() : null;
  const hub = list.find((b) => b.key === "hub");
  const zen = list.filter((b) => b.role === "zenedu");
  const url = (info as { url?: string })?.url;
  return (
    <Shell title="Боти й меню" counts={counts}>
      {sp.newkey && <div className="alert ok"><b>API-ключ для бота «{sp.for}»</b> показується один раз, скопіюйте його зараз і передайте інженеру безпечним каналом:<div className="mono" style={{ marginTop: 6, wordBreak: "break-all", userSelect: "all" }}>{sp.newkey}</div></div>}
      <div className="card" style={{ marginBottom: 16 }}><h3>Зовнішні боти <span className="sub">«Щиро» та інші боти на своїх серверах перевіряють доступ через API Hub</span></h3>
        {ext.map((b) => <div key={b.id} className="ent"><span className={`dot ${b.isActive ? (b.lastSeenAt && Date.now() - b.lastSeenAt.getTime() < 3600000 ? "" : "warn") : "off"}`} /><div><b>{b.name} <span className="mono muted">{b.username ? "@" + b.username : ""} · {b.key}</span></b><small>право {b.resourceKey ?? "—"} · ключ {b.apiKeyPrefix ?? "—"}… · останній запит {dateTime(b.lastSeenAt)} · сьогодні {b.requestsToday} запитів</small></div>
          <span className="row-actions"><form action={rotateBotKey}><input type="hidden" name="key" value={b.key} /><button className="btn sm" type="submit">Новий ключ</button></form><form action={toggleBot}><input type="hidden" name="key" value={b.key} /><input type="hidden" name="on" value={b.isActive ? "0" : "1"} /><button className="btn sm ghost" type="submit">{b.isActive ? "Вимкнути" : "Увімкнути"}</button></form></span></div>)}
        {!ext.length && <p className="muted">Ще немає. Створіть запис для «Щиро» нижче.</p>}
        <form action={createExternalBot} className="form" style={{ marginTop: 12 }}>
          <div className="form two"><label className="field">Назва<input name="name" placeholder="Щиро" required /></label><label className="field">Код (латиницею)<input name="key" placeholder="shchyro" required /></label></div>
          <div className="form two"><label className="field">Username бота<input name="username" placeholder="ShchyroBot" /></label><label className="field">Яке право перевіряє<select name="resourceKey">{res.filter((r) => r.kind === "bot_feature" || r.kind === "external_url").map((r) => <option key={r.key} value={r.key}>{r.name} ({r.key})</option>)}</select></label></div>
          <div className="row-actions"><button className="btn pri" type="submit">Створити і видати API-ключ</button><span className="muted">Адреса API: <code className="mono">{base}/api/v1/access</code></span></div>
        </form>
        <p className="note">Перехідний режим для «Щиро»: у розділі «Доступи» у ресурсу «Бот Щиро» увімкніть «давати доступ усім активним підпискам ZenEdu». Тоді Hub відповідатиме так само, як нинішня щоденна вивантажка, а окремі тарифи додадуться зверху.</p>
      </div>
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
