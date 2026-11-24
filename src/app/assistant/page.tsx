import Link from "next/link";
import { Bot, MessageSquare, Check, X, Send, Save, Inbox } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { Section, Stat, Alert, EmptyState, KV, Field } from "@/components/ui/layout";
import { Kebab, MenuAction, Switch, Checkbox } from "@/components/ui/controls";
import { navCounts, safe } from "@/lib/queries";
import { assistantSettings, assistantStats, ticketList, actionLog, assistantLastError, DEFAULT_MODEL } from "@/lib/assistant";
import { llmConfigured } from "@/lib/assistant/llm";
import { assistantSaveSettings, assistantTicketAction } from "@/lib/actions";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
const TABS = [["tickets", "Звернення"], ["log", "Журнал"], ["settings", "Налаштування"]] as const;
const KIND: Record<string, string> = { crisis: "криза", personal: "особисте", refund: "повернення", cancel: "скасування", zenedu: "ZenEdu", access: "доступ", payment: "оплата", tech: "технічне", sales: "продаж", other: "інше" };

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ tab?: string; closed?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const tab = TABS.some((t) => t[0] === sp.tab) ? sp.tab! : "tickets";
  const [counts, st, stats] = await Promise.all([navCounts(), safe(() => assistantSettings(), { enabled: false, model: DEFAULT_MODEL, notes: "" }), safe(() => assistantStats(), null)]);
  const key = llmConfigured();
  return (
    <Shell title="Асистент" counts={counts}>
      <div className="ph" style={{ marginBottom: 6 }}><span className="ph-ico"><Bot size={16} /></span><h2 className="ph-title">Олеся — асистентка підтримки</h2>
        {!key ? <Pill tone="crit">немає ключа OpenRouter</Pill> : st.enabled ? <Pill tone="good">відповідає в боті</Pill> : <Pill tone="mute">вимкнена</Pill>}</div>
      <div className="tabs">{TABS.map(([k, l]) => <Link key={k} href={`/assistant?tab=${k}`} className={tab === k ? "on" : ""}>{l}</Link>)}</div>
      {sp.ok && <Alert tone="ok">{sp.ok}</Alert>}
      {sp.err && <Alert tone="bad">{sp.err}</Alert>}
      {stats && <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Відкриті звернення" value={stats.open} hint={stats.urgent ? `з них термінових ${stats.urgent}` : "чекають на команду"} tone={stats.urgent ? "crit" : stats.open ? "warn" : undefined} />
        <Stat label="Відповідей за добу" value={stats.replies24} hint="повідомлень людям у боті" />
        <Stat label="Дій за добу" value={stats.actions24} hint="посилання, оффери" />
        <Stat label="Запитів до ШІ за місяць" value={stats.month.calls} hint={`токенів ${Math.round((stats.month.input + stats.month.output) / 1000)} тис.`} />
      </div>}
      {tab === "tickets" ? <Tickets closed={Boolean(sp.closed)} /> : tab === "log" ? <Log /> : <Settings st={st} hasKey={key} lastError={await safe(() => assistantLastError(), null)} />}
    </Shell>
  );
}

async function Tickets({ closed }: { closed: boolean }) {
  const list = await safe(() => ticketList(closed ? "closed" : "open"), []);
  return <>
    <div className="row-actions" style={{ marginBottom: 12 }}>
      <Link href="/assistant" className={`btn sm ${closed ? "ghost" : ""}`}>Відкриті</Link>
      <Link href="/assistant?closed=1" className={`btn sm ${closed ? "" : "ghost"}`}>Вирішені й відхилені</Link>
    </div>
    {!list.length && <div className="card"><EmptyState icon={<Inbox size={20} />} title={closed ? "Вирішених звернень ще немає" : "Відкритих звернень немає"} text="Сюди асистентка передає те, що вимагає рішення команди: повернення в ZenEdu, нестандартні випадки, особисті історії без доступу до «Щиро», кризові повідомлення." /></div>}
    {list.map((t) => <Section key={t.id}
      title={<><Link href={`/people/${t.person_id}`}>{t.name}</Link>{t.username ? <span className="muted"> · @{t.username}</span> : null}</>}
      description={`#${t.id} · ${dateTime(t.created_at)}${t.resolved_at ? ` · ${t.status === "done" ? "закрито" : "відхилено"} ${dateTime(t.resolved_at)}${t.resolved_by ? ` (${t.resolved_by})` : ""}` : ""}`}
      actions={<>{t.priority === "urgent" && <Pill tone="crit">терміново</Pill>}<Pill tone="moon">{KIND[t.kind] ?? t.kind}</Pill>{t.silent && <Pill tone="warn">людині не відповідали</Pill>}
        <Link href={`/chats?p=${t.person_id}`} className="btn sm ghost"><MessageSquare size={14} /> Діалог</Link>
        {t.status === "open" && <Kebab><MenuAction action={assistantTicketAction} fields={{ id: t.id, op: "done" }} icon={<Check />}>Закрити звернення</MenuAction><MenuAction action={assistantTicketAction} fields={{ id: t.id, op: "reject" }} icon={<X />} confirm="Відхилити звернення? Асистентка нічого не робитиме.">Відхилити</MenuAction></Kebab>}</>}>
      <p className="pre-wrap" style={{ margin: 0 }}>{t.summary}</p>
      {t.team_note && <div style={{ marginTop: 10 }}><KV items={[{ k: "Вказівка команди", v: t.team_note }]} /></div>}
      {t.status === "open" && <form action={assistantTicketAction} style={{ marginTop: 12 }}>
        <input type="hidden" name="id" value={t.id} /><input type="hidden" name="op" value="note" />
        <Field label="Вказівка асистентці" hint="Наприклад: «Повернення в ZenEdu оформлено» або «Доступ видано вручну». Асистентка врахує це, коли людина напише наступного разу.">
          <textarea name="note" rows={2} defaultValue="" />
        </Field>
        <div style={{ margin: "8px 0 10px" }}><Checkbox name="sendNow" label="Написати людині зараз" hint="асистентка одразу повідомить людині лише результат за вказівкою, без «питання в роботі»" /></div>
        <button className="btn sm" type="submit"><Send size={14} /> Передати вказівку</button>
      </form>}
    </Section>)}
  </>;
}

async function Log() {
  const rows = await safe(() => actionLog(), []);
  const what = (r: (typeof rows)[number]) => r.type === "bot.reply" ? `Відповіла: ${String(r.payload?.text ?? "").slice(0, 220)}` : r.type === "bot.reply_failed" ? "Відповідь не доставлено (людина заблокувала бот?)" : String(r.payload?.label ?? r.type);
  return <Section title="Журнал дій асистентки" description="Відповіді людям, видані посилання й оффери, передані звернення. Останні 200 записів." className="tbl">
    {rows.length ? <table><thead><tr><th>Коли</th><th>Людина</th><th>Що</th><th></th></tr></thead><tbody>
      {rows.map((r) => <tr key={r.id}><td className="mono">{dateTime(r.created_at)}</td><td><Link href={`/people/${r.person_id}`}>{r.name}</Link></td><td>{what(r)}</td>
        <td>{r.type === "assistant.handoff" ? <Pill tone="warn">команді</Pill> : r.type === "assistant.action" ? <Pill tone="acc">дія</Pill> : <Pill tone="mute">відповідь</Pill>}</td></tr>)}
    </tbody></table> : <EmptyState icon={<Bot size={20} />} title="Дій ще не було" text="Увімкніть асистентку в налаштуваннях: тут з'являтимуться її відповіді й дії." />}
  </Section>;
}

function Settings({ st, hasKey, lastError }: { st: { enabled: boolean; model: string; notes: string }; hasKey: boolean; lastError: { at: string; personId: number; error: string } | null }) {
  return <div className="grid g21">
    <div>
      {lastError && <Alert tone={Date.now() - new Date(lastError.at).getTime() < 86400_000 ? "bad" : "info"}><b>Остання помилка ШІ: {dateTime(lastError.at)}</b> (<Link href={`/chats?p=${lastError.personId}`}>діалог</Link>)<div className="mono pre-wrap" style={{ marginTop: 6 }}>{lastError.error}</div></Alert>}
      <Section title="Робота в боті" description="Коли вимкнено, люди отримують стару відповідь «Повідомлення отримано…». Коли увімкнено, Олеся відповідає на повідомлення, які не забрали команди бота, кнопки й воронки, протягом 20–80 секунд.">
        {!hasKey && <Alert tone="warn">Додайте OPENROUTER_API_KEY у Vercel → Settings → Environment Variables і зробіть новий деплой. Без ключа асистентку не можна увімкнути.</Alert>}
        <form action={assistantSaveSettings}><input type="hidden" name="form" value="switch" />
          <Switch name="enabled" defaultChecked={st.enabled} autoSubmit disabled={!hasKey} label="Олеся відповідає людям у Hub-боті" hint="перший етап: відповіді, посилання в канал, кабінет, «Щиро», оффери й звернення команді" />
        </form>
      </Section>
      <form action={assistantSaveSettings}><input type="hidden" name="form" value="params" />
        <Section title="Додаткові вказівки" description="Доповнення до затвердженої інструкції (docs/assistant/INSTRUCTION.md): тимчасові правила, анонси, що казати про збій. Асистентка виконує їх як вказівки команди.">
          <Field label="Вказівки"><textarea name="notes" rows={6} defaultValue={st.notes} placeholder="Наприклад: до 25.11 етери переносяться на середу" /></Field>
          <Field label="Модель OpenRouter" hint={`за замовчуванням ${DEFAULT_MODEL}, як у бота коментарів`}><input name="model" defaultValue={st.model === DEFAULT_MODEL ? "" : st.model} placeholder={DEFAULT_MODEL} /></Field>
          <button className="btn pri" type="submit"><Save size={15} /> Зберегти</button>
        </Section>
      </form>
    </div>
    <div className="form aside-sticky">
      <Section title="Що вміє зараз">
        <KV items={[
          { k: "Перевіряє", v: "підписки Hub і ZenEdu, оплати, доступ до каналу, «Щиро», кабінет, етери" },
          { k: "Надсилає", v: "нове посилання в канал (знімає старе блокування), кабінет, «Щиро», оффер з оплатою" },
          { k: "Передає команді", v: "повернення й скасування, ZenEdu, нестандартне, особисте без «Щиро», кризу (терміново)" },
          { k: "Далі", v: "скасування, пауза, компенсація й повернення в Hub — другий етап, окремий вимикач" },
        ]} />
      </Section>
    </div>
  </div>;
}
