import Link from "next/link";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { ConfirmSubmit, MenuCloser } from "@/components/funnel-ui";
import { navCounts, resourceList, settingsMap } from "@/lib/queries";
import { connectChat, saveResource, refreshChatInfo, toggleResource, deleteResource, runAccessTickNow, runReconcileNow } from "@/lib/actions";
import { botRightsIn, channelStats, type ChannelConfig } from "@/lib/telegram-access";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const KINDS: Record<string, string> = { telegram_channel: "Канал", telegram_group: "Група", bot_feature: "Функція бота", external_url: "Посилання", course: "Курс" };
type Cfg = ChannelConfig & { cover?: string; memberCount?: number; username?: string; syncedAt?: string; url?: string; description?: string; zenedu_grants?: boolean };

export default async function Resources({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; view?: string; err?: string }> }) {
  const sp = await searchParams;
  const [counts, res, st] = await Promise.all([navCounts(), resourceList(), settingsMap()]);
  const tab = sp.tab === "digital" ? "digital" : "channels";
  const known = (st["known_chats"] as { id: number; title: string; type: string; status: string; at: string }[] | undefined) ?? [];
  const hasToken = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const isChat = (k: string) => k === "telegram_channel" || k === "telegram_group";
  const q = (sp.q ?? "").trim().toLowerCase();
  let rows = res.filter((r) => (tab === "channels" ? isChat(r.kind) : !isChat(r.kind)));
  if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q));
  const connectedIds = new Set(res.map((r) => String(((r.config ?? {}) as Cfg).chatId ?? "")));
  const free = known.filter((c) => ["administrator", "creator"].includes(c.status) && !connectedIds.has(String(c.id)));
  const stats = tab === "channels" ? await Promise.all(rows.map(async (r) => { const cfg = (r.config ?? {}) as Cfg; return { key: r.key, s: await channelStats(r.key).catch(() => null), rights: hasToken && cfg.chatId ? await botRightsIn(cfg.chatId) : null }; })) : [];
  const rec = st["reconcile.last"] as { at?: string; checked?: number; fixed?: number } | undefined;
  const view = sp.view === "list" ? "list" : "grid";
  const link = (p: Record<string, string>) => { const u = new URLSearchParams({ ...(tab === "digital" ? { tab } : {}), ...(sp.q ? { q: sp.q } : {}), ...(sp.view ? { view: sp.view } : {}), ...p }); const s = u.toString(); return "/resources" + (s ? "?" + s : ""); };
  return (
    <Shell title={tab === "channels" ? "Канали і групи" : "Цифрові продукти"} counts={counts}>
      <MenuCloser />
      {sp.err && <div className="alert bad">{sp.err}</div>}
      <div className="tabs"><Link href="/resources" className={tab === "channels" ? "on" : ""}>Канали і групи · {res.filter((r) => isChat(r.kind)).length}</Link><Link href="/resources?tab=digital" className={tab === "digital" ? "on" : ""}>Цифрові продукти · {res.filter((r) => !isChat(r.kind)).length}</Link></div>
      <div className="toolbar">
        <form className="search" method="get"><span className="muted">⌕</span><input name="q" defaultValue={sp.q ?? ""} placeholder="Пошук" />{tab === "digital" && <input type="hidden" name="tab" value="digital" />}</form>
        <div className="seg"><Link href={link({ view: "grid" })} className={view === "grid" ? "on" : ""} title="Сітка">▦</Link><Link href={link({ view: "list" })} className={view === "list" ? "on" : ""} title="Список">☰</Link></div>
        <span className="spacer" />
        {tab === "channels" ? (
          <details className="menu"><summary className="btn pri" style={{ width: "auto", height: 36 }}>+ Підключити канал або групу</summary>
            <div className="dd" style={{ minWidth: 380, padding: 12 }}>
              <b style={{ fontSize: 13 }}>Чати, де Hub-бот уже адміністратор</b>
              {free.map((c) => <form key={c.id} action={connectChat} className="row-actions" style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}><input type="hidden" name="chatId" value={c.id} /><span className="steptype">{c.type === "channel" ? "📣" : "👥"}</span><span style={{ flex: 1 }}>{c.title}<br /><small className="muted mono">{c.type} · {c.id}</small></span><button type="submit" className="btn sm pri">Підключити</button></form>)}
              {!free.length && <p className="muted" style={{ margin: "6px 0" }}>Немає нових. Додайте Hub-бот у канал або групу адміністратором із правами «Додавати учасників» і «Блокувати користувачів»: чат з’явиться тут автоматично.</p>}
              <form action={connectChat} className="form" style={{ marginTop: 10 }}><label className="field">Або вкажіть chat_id вручну<div className="row-actions"><input name="chatId" placeholder="-1001234567890" className="btn sm" style={{ flex: 1 }} /><button type="submit" className="btn sm">Підключити</button></div></label></form>
            </div></details>
        ) : (
          <details className="menu"><summary className="btn pri" style={{ width: "auto", height: 36 }}>+ Додати цифровий продукт</summary>
            <div className="dd" style={{ minWidth: 340, padding: 12 }}><form action={saveResource} className="form">
              <label className="field">Назва<input name="name" placeholder="Архів ефірів" required autoFocus /></label>
              <label className="field">Тип<select name="kind" defaultValue="external_url"><option value="external_url">Посилання (сайт, Notion, Drive)</option><option value="course">Курс</option><option value="bot_feature">Функція бота (наприклад «Щиро»)</option></select></label>
              <label className="field">Код<input name="key" placeholder="archive.access" pattern="[a-z0-9_.]+" required /></label>
              <button className="btn sm pri" type="submit">Створити</button>
            </form></div></details>
        )}
      </div>

      {!rows.length && <div className="card" style={{ textAlign: "center", padding: 40 }}><p className="muted">{q ? "Нічого не знайдено." : tab === "channels" ? "Ще немає підключених каналів чи груп. Натисніть «+ Підключити канал або групу»." : "Цифрових продуктів ще немає."}</p></div>}
      <div className={view === "grid" ? "fgrid" : "grid flist"}>
        {rows.map((r) => { const c = (r.config ?? {}) as Cfg; const x = stats.find((z) => z.key === r.key); const chat = isChat(r.kind); const members = c.memberCount ?? x?.s?.joined ?? null; const rightsBad = chat && c.chatId && x?.rights && !x.rights.ok; return (
          <div key={r.id} className="fcard">
            <Link href={`/resources/${r.key}`} className={`cover ${chat ? "" : "zen"}`} style={c.cover ? { backgroundImage: `url(${c.cover})` } : undefined} aria-label={r.name} />
            <div className="body">
              <b><Link href={`/resources/${r.key}`}>{r.name}</Link></b>
              <div className="meta"><span title={chat ? "Учасників у чаті" : "Людей із правом"}>👤 {members ?? "—"}</span>{chat && x?.s ? <span title="Людей із правом доступу">✓ {x.s.withRight} з правом</span> : null}{chat && x?.s?.withoutRight ? <span style={{ color: "var(--crit)" }} title="У чаті без права">⚠ {x.s.withoutRight} без права</span> : null}</div>
              <div className="row-actions"><span className="muted" style={{ fontSize: 12 }}>{r.kind === "telegram_channel" ? "📣" : r.kind === "telegram_group" ? "👥" : r.kind === "bot_feature" ? "🤖" : r.kind === "course" ? "🎓" : "🔗"} {KINDS[r.kind] ?? r.kind}</span><span className="spacer" style={{ flex: 1 }} />
                {!r.isActive ? <Pill tone="mute">Вимкнено</Pill> : !chat ? <Pill tone="good">Active</Pill> : !c.chatId ? <Pill tone="warn">Не підключено</Pill> : rightsBad ? <Pill tone="crit" >Бот без прав</Pill> : <Pill tone="good">Active</Pill>}</div>
            </div>
            <details className="menu"><summary>⋮</summary><div className="dd">
              <Link href={`/resources/${r.key}`}>⚙ Налаштування</Link>
              {chat && c.chatId && <form action={refreshChatInfo}><input type="hidden" name="key" value={r.key} /><button type="submit">⟳ Оновити з Telegram</button></form>}
              {chat && c.username && <a href={`https://t.me/${c.username}`} target="_blank" rel="noreferrer">↗ Відкрити в Telegram</a>}
              <form action={toggleResource}><input type="hidden" name="key" value={r.key} /><button type="submit">{r.isActive ? "⏸ Вимкнути" : "▶ Увімкнути"}</button></form>
              <div className="sep" />
              <form action={deleteResource}><input type="hidden" name="key" value={r.key} /><ConfirmSubmit className="danger" message={`Видалити «${r.name}» з Hub? Людей із чату це не виключить, але право доступу до нього зникне з тарифів.`}>🗑 Видалити</ConfirmSubmit></form>
            </div></details>
          </div>); })}
      </div>

      {tab === "channels" && <div className="card" style={{ marginTop: 20 }}>
        <h3>Автоматика доступів</h3>
        <div className="grid g2" style={{ gap: 12 }}>
          <div><b style={{ fontWeight: 600 }}>Щохвилини: видача й виключення.</b><p className="note" style={{ margin: "4px 0 8px" }}>Hub дивиться, у кого з’явилось право (тариф або ручна видача), і надсилає в боті одноразове посилання в канал. У кого право закінчилось, того виключає з можливістю повернутись.</p><form action={runAccessTickNow}><button className="btn sm" type="submit">Запустити зараз</button></form></div>
          <div><b style={{ fontWeight: 600 }}>Щоночі о 04:00: звірка з Telegram.</b><p className="note" style={{ margin: "4px 0 8px" }}>Перевіряє, хто фактично в каналі, і виправляє розбіжності: наприклад, якщо людину додали вручну або вона вийшла сама.{rec?.at ? ` Остання звірка ${dateTime(rec.at)}: перевірено ${rec.checked}, виправлено ${rec.fixed}.` : ""}</p><form action={runReconcileNow}><button className="btn sm" type="submit">Звірити зараз</button></form></div>
        </div>
      </div>}
    </Shell>
  );
}
