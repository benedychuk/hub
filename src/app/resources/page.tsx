import Link from "next/link";
import { Plus, Settings, RefreshCw, ExternalLink, Pause, Play, Trash2, LayoutGrid, List, Users, Check, AlertTriangle, Megaphone, MessagesSquare, Bot, GraduationCap, Link2, Radio } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { Toolbar, Section, Alert, EmptyState } from "@/components/ui/layout";
import { Kebab, MenuAction, MenuLink, MenuSep } from "@/components/ui/controls";
import { ConnectChatDialog, Modal } from "@/components/modal";
import { navCounts, resourceList, settingsMap, botList } from "@/lib/queries";
import { connectChat, saveResource, refreshChatInfo, toggleResource, deleteResource, runAccessTickNow, runReconcileNow } from "@/lib/actions";
import { botRightsIn, channelStats, type ChannelConfig } from "@/lib/telegram-access";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const KINDS: Record<string, string> = { telegram_channel: "Канал", telegram_group: "Група", bot_feature: "Функція бота", external_url: "Посилання", course: "Курс" };
const KIND_ICON: Record<string, React.ReactNode> = { telegram_channel: <Megaphone size={13} />, telegram_group: <MessagesSquare size={13} />, bot_feature: <Bot size={13} />, external_url: <Link2 size={13} />, course: <GraduationCap size={13} /> };
type Cfg = ChannelConfig & { cover?: string; memberCount?: number; username?: string; syncedAt?: string; enforce?: boolean };

export default async function Resources({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; view?: string; err?: string }> }) {
  const sp = await searchParams;
  const [counts, res, st, bl] = await Promise.all([navCounts(), resourceList(), settingsMap(), botList()]);
  const botUser = bl.find((b) => b.key === "hub")?.username ?? null;
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
      {sp.err && <Alert tone="bad">{sp.err}</Alert>}
      <div className="tabs"><Link href="/resources" className={tab === "channels" ? "on" : ""}>Канали і групи · {res.filter((r) => isChat(r.kind)).length}</Link><Link href="/resources?tab=digital" className={tab === "digital" ? "on" : ""}>Цифрові продукти · {res.filter((r) => !isChat(r.kind)).length}</Link></div>
      <Toolbar actions={tab === "channels" ? <ConnectChatDialog chats={free.map((c) => ({ id: c.id, title: c.title, type: c.type }))} botUsername={botUser} action={connectChat} /> : (
        <Modal title="Новий цифровий продукт" width={480} trigger={<button type="button" className="btn pri"><Plus size={15} /> Цифровий продукт</button>}>
          <form action={saveResource} className="form">
            <div className="fld"><label className="fld-l">Назва</label><input name="name" placeholder="Архів ефірів" required /></div>
            <div className="fld"><label className="fld-l">Тип</label><select name="kind" defaultValue="external_url"><option value="external_url">Посилання (сайт, Notion, Drive)</option><option value="course">Курс</option><option value="bot_feature">Функція бота (наприклад «Щиро»)</option></select></div>
            <div className="fld"><label className="fld-l">Код</label><input name="key" placeholder="archive.access" pattern="[a-z0-9_.]+" required /><div className="fld-h">латиниця, цифри, крапки; використовується в API</div></div>
            <div className="modal-f"><button className="btn pri" type="submit">Створити</button></div>
          </form>
        </Modal>)}>
        <form className="search" method="get"><input name="q" defaultValue={sp.q ?? ""} placeholder="Пошук" />{tab === "digital" && <input type="hidden" name="tab" value="digital" />}</form>
        <div className="seg"><Link href={link({ view: "grid" })} className={view === "grid" ? "on" : ""} title="Сітка"><LayoutGrid size={15} /></Link><Link href={link({ view: "list" })} className={view === "list" ? "on" : ""} title="Список"><List size={15} /></Link></div>
      </Toolbar>
      {tab === "channels" && free.length > 0 && <Alert tone="info">Hub-бот уже адміністратор у {free.length === 1 ? "чаті" : "чатах"} {free.map((c) => `«${c.title}»`).join(", ")}, але {free.length === 1 ? "він ще не підключений" : "вони ще не підключені"}. Натисніть «Підключити канал або групу».</Alert>}
      {!rows.length && <div className="card"><EmptyState icon={<Radio size={20} />} title={q ? "Нічого не знайдено" : tab === "channels" ? "Ще немає підключених каналів чи груп" : "Цифрових продуктів ще немає"} text={tab === "channels" ? "Додайте Hub-бот адміністратором у канал або групу й підключіть чат кнопкою вгорі." : "Посилання, курс або функція бота, до яких дає доступ тариф."} /></div>}
      <div className={view === "grid" ? "fgrid" : "grid flist"}>
        {rows.map((r) => { const c = (r.config ?? {}) as Cfg; const x = stats.find((z) => z.key === r.key); const chat = isChat(r.kind); const members = c.memberCount ?? x?.s?.joined ?? null; const rightsBad = chat && c.chatId && x?.rights && !x.rights.ok; return (
          <div key={r.id} className="fcard">
            <Link href={`/resources/${r.key}`} className={`cover ${chat ? "" : "zen"}`} style={c.cover ? { backgroundImage: `url(${c.cover})` } : undefined} aria-label={r.name} />
            <div className="body">
              <b><Link href={`/resources/${r.key}`}>{r.name}</Link></b>
              <div className="meta"><span title={chat ? "Учасників у чаті" : "Людей із правом"}><Users size={12} /> {members ?? "—"}</span>{chat && x?.s ? <span title="Людей із правом доступу"><Check size={12} /> {x.s.withRight} з правом</span> : null}{chat && x?.s?.withoutRight ? <span style={{ color: "var(--crit)" }} title="У чаті без права"><AlertTriangle size={12} /> {x.s.withoutRight} без права</span> : null}</div>
              <div className="row-actions"><span className="fld-h" style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>{KIND_ICON[r.kind]} {KINDS[r.kind] ?? r.kind}</span><span className="spacer" />
                {!r.isActive ? <Pill tone="mute">Вимкнено</Pill> : !chat ? <Pill tone="good">Active</Pill> : !c.chatId ? <Pill tone="warn">Не підключено</Pill> : rightsBad ? <Pill tone="crit">Бот без прав</Pill> : c.enforce === true ? <Pill tone="good">Автоматика</Pill> : <Pill tone="moon">Спостереження</Pill>}</div>
            </div>
            <Kebab>
              <MenuLink href={`/resources/${r.key}`} icon={<Settings />}>Налаштування</MenuLink>
              {chat && c.chatId && <MenuAction action={refreshChatInfo} fields={{ key: r.key }} icon={<RefreshCw />}>Оновити з Telegram</MenuAction>}
              {chat && c.username && <MenuLink href={`https://t.me/${c.username}`} icon={<ExternalLink />} external>Відкрити в Telegram</MenuLink>}
              <MenuAction action={toggleResource} fields={{ key: r.key }} icon={r.isActive ? <Pause /> : <Play />}>{r.isActive ? "Вимкнути" : "Увімкнути"}</MenuAction>
              <MenuSep />
              <MenuAction action={deleteResource} fields={{ key: r.key }} icon={<Trash2 />} danger confirm={`Видалити «${r.name}» з Hub? Людей із чату це не виключить, але право доступу зникне з тарифів.`}>Видалити</MenuAction>
            </Kebab>
          </div>); })}
      </div>
      {tab === "channels" && <Section title="Автоматика доступів" className="sec" description="Працює сама; кнопки лише запускають перевірку негайно.">
        <div className="grid g2">
          <div><b style={{ fontWeight: 600 }}>Щохвилини: видача й виключення</b><p className="fld-h" style={{ margin: "4px 0 8px" }}>Hub дивиться, у кого з’явилось право (тариф або ручна видача), і надсилає в боті одноразове посилання в канал. У кого право закінчилось, того виключає з можливістю повернутись.</p><form action={runAccessTickNow}><button className="btn sm" type="submit"><RefreshCw size={14} /> Запустити зараз</button></form></div>
          <div><b style={{ fontWeight: 600 }}>Щоночі о 04:00: звірка з Telegram</b><p className="fld-h" style={{ margin: "4px 0 8px" }}>Перевіряє, хто фактично в каналі, і виправляє розбіжності.{rec?.at ? ` Остання звірка ${dateTime(rec.at)}: перевірено ${rec.checked}, виправлено ${rec.fixed}.` : ""}</p><form action={runReconcileNow}><button className="btn sm" type="submit"><RefreshCw size={14} /> Звірити зараз</button></form></div>
        </div>
      </Section>}
    </Shell>
  );
}
