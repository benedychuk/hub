import Link from "next/link";
import { Bot, Download, ExternalLink, RefreshCw, Sparkles } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { Section, Stat, Row, KV, Alert, EmptyState, Toolbar, Pager } from "@/components/ui/layout";
import { navCounts, resourceList, planList } from "@/lib/queries";
import { safe } from "@/lib/queries";
import { db, hasDb, schema } from "@/db";
import { inArray } from "drizzle-orm";
import { shchyroConfigured, shchyroBaseUrl, shchyroSettings, shchyroEntitled, shchyroStats, shchyroClients, shchyroAnalytics, shchyroAnalyticsRun, shchyroPanelClientUrl, type Entitled, type ShchyroStats, type ShchyroClientRow, type ShchyroAnalytics, type ShchyroRun } from "@/lib/shchyro";
import { shchyroStartAnalytics } from "@/lib/actions";
import { markdownToHtml } from "@/lib/markdown";
import { date, dateTime, fullName } from "@/lib/format";
import { priceLabel } from "@/lib/offers";
import AccessTab from "./access-tab";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const TABS = [["overview", "Огляд"], ["people", "Люди"], ["access", "Доступ"], ["analytics", "Аналітика"]] as const;
type SP = { tab?: string; ok?: string; err?: string; q?: string; f?: string; p?: string; run?: string };
const n = (v: number | null | undefined) => (v ?? 0).toLocaleString("uk-UA");

/** Люди Hub за telegram id: для посилань з даних «Щиро» на картки. */
async function peopleByTelegram(ids: number[]) {
  if (!hasDb() || !ids.length) return {} as Record<number, { id: number; name: string }>;
  const rows = await db().select({ id: schema.persons.id, tg: schema.persons.telegramUserId, firstName: schema.persons.firstName, lastName: schema.persons.lastName, username: schema.persons.username }).from(schema.persons).where(inArray(schema.persons.telegramUserId, ids)).catch(() => []);
  return Object.fromEntries(rows.map((r) => [r.tg, { id: r.id, name: fullName(r) }])) as Record<number, { id: number; name: string }>;
}
async function peopleById(ids: number[]) {
  if (!hasDb() || !ids.length) return {} as Record<number, { id: number; name: string }>;
  const rows = await db().select({ id: schema.persons.id, firstName: schema.persons.firstName, lastName: schema.persons.lastName, username: schema.persons.username, tg: schema.persons.telegramUserId }).from(schema.persons).where(inArray(schema.persons.id, ids)).catch(() => []);
  return Object.fromEntries(rows.map((r) => [r.id, { id: r.id, name: fullName({ ...r, telegramUserId: r.tg }) }])) as Record<number, { id: number; name: string }>;
}

export default async function Shchyro({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const tab = TABS.some((t) => t[0] === sp.tab) ? sp.tab! : "overview";
  const configured = shchyroConfigured();
  const [counts, res, plans, st] = await Promise.all([navCounts(), resourceList(), planList(), safe(() => shchyroSettings(), { enabled: false, resourceKey: "shchyro.access", pushedIds: [] as number[], lastSync: null, lastPush: null, lastCheck: null })]);
  const entitled = await safe(() => shchyroEntitled(st.resourceKey), [] as Entitled[]);
  const resource = res.find((r) => r.key === st.resourceKey);
  const inPlans = plans.filter((p) => Object.keys((p.entitlements ?? {}) as Record<string, string>).includes(st.resourceKey));
  const status = <>{!configured ? <Pill tone="crit">не підключено</Pill> : st.enabled ? <Pill tone="good">автоматика увімкнена</Pill> : <Pill tone="warn">лише спостереження</Pill>}{resource && !resource.isActive && <Pill tone="mute">ресурс вимкнено</Pill>}</>;
  const link = (p: Partial<SP>) => { const u = new URLSearchParams(); const all = { ...sp, ok: undefined, err: undefined, ...p }; for (const [k, v] of Object.entries(all)) if (v) u.set(k, String(v)); const s = u.toString(); return "/shchyro" + (s ? "?" + s : ""); };

  return (
    <Shell title="Бот «Щиро»" counts={counts}>
      <div className="ph" style={{ marginBottom: 6 }}><span className="ph-ico"><Bot size={16} /></span><h2 className="ph-title">{resource?.name ?? "Бот «Щиро»"}</h2>{status}<span className="spacer" />
        <div className="row-actions">{configured && <a href={shchyroBaseUrl()} target="_blank" rel="noreferrer" className="btn sm ghost"><ExternalLink size={14} /> Панель «Щиро»</a>}{resource && <Link href={`/resources/${resource.key}`} className="btn sm ghost">Ресурс у тарифах</Link>}</div></div>
      <div className="tabs">{TABS.map(([k, l]) => <Link key={k} href={link({ tab: k, q: undefined, f: undefined, p: undefined, run: undefined })} className={tab === k ? "on" : ""}>{l}</Link>)}</div>
      {sp.ok && <Alert tone="ok">{sp.ok}</Alert>}{sp.err && <Alert tone="bad">{sp.err}</Alert>}
      {!configured && tab !== "access" && <Alert tone="warn">«Щиро» не підключено: додайте SHCHYRO_API_URL і SHCHYRO_API_SECRET у Vercel. Поки що показуються лише дані Hub.</Alert>}
      {tab === "overview" && <Overview configured={configured} st={st} entitled={entitled} inPlans={inPlans} resourceKey={st.resourceKey} />}
      {tab === "people" && <People configured={configured} sp={sp} entitled={entitled} link={link} />}
      {tab === "access" && <AccessTab resources={res} people={await peopleById(entitled.map((e) => e.personId))} />}
      {tab === "analytics" && <Analytics configured={configured} sp={sp} />}
    </Shell>
  );
}

async function Overview({ configured, st, entitled, inPlans, resourceKey }: { configured: boolean; st: Awaited<ReturnType<typeof shchyroSettings>>; entitled: Entitled[]; inPlans: Awaited<ReturnType<typeof planList>>; resourceKey: string }) {
  const r = configured ? await shchyroStats() : null;
  const s: ShchyroStats | null = r?.ok ? r.data : null;
  const bySrc = { manual: entitled.filter((e) => e.source === "manual").length, plan: entitled.filter((e) => e.source === "plan").length, zenedu: entitled.filter((e) => e.source === "zenedu").length };
  const lp = st.lastPush as { at?: string; granted?: number; revoked?: number; failed?: number; pending?: number } | null; const ls = st.lastSync;
  return (<>
    {configured && r && !r.ok && <Alert tone="bad">«Щиро» не відповідає: {r.error}. Перевірте адресу, секрет і чи піднятий контейнер панелі.</Alert>}
    <div className="grid g4" style={{ marginBottom: 16 }}>
      <Stat label="Мають право в Hub" value={n(entitled.length)} hint={`тариф ${bySrc.plan} · вручну ${bySrc.manual} · ZenEdu ${bySrc.zenedu}`} />
      <Stat label="Відкрито в боті" value={s ? n(s.access.active_count) : "—"} hint={s ? `з них Hub відкрив ${st.pushedIds.length}` : "немає зв'язку"} tone={s && st.enabled && s.access.active_count !== entitled.length ? "warn" : undefined} />
      <Stat label="Клієнток у боті" value={s ? n(s.totals.clients) : "—"} hint={s ? `писали за добу ${s.totals.active_24h}` : undefined} />
      <Stat label="Реплік у журналі" value={s ? n(s.totals.messages) : "—"} hint={s ? `карток заповнено ${s.totals.profiles}` : undefined} />
    </div>
    {s && <div className="grid g4" style={{ marginBottom: 16 }}>
      <Stat label="Активні за 7 днів" value={n(s.activity.active_7d)} hint={`нових ${s.activity.new_7d}`} />
      <Stat label="Активні за 30 днів" value={n(s.activity.active_30d)} hint={`нових ${s.activity.new_30d}`} />
      <Stat label="Не писали понад 30 днів" value={n(s.activity.dormant_30d)} hint="є що повернути розсилкою" tone={s.activity.dormant_30d > s.activity.active_30d ? "warn" : undefined} />
      <Stat label="Токенів усього" value={n(s.usage.total_tokens)} hint={`${n(s.usage.total_calls)} викликів моделі`} />
    </div>}
    <div className="grid g21">
      <div className="form">
        <Section title="Тарифи з доступом до «Щиро»" description="Активна підписка на будь-який із цих тарифів автоматично відкриває бота. Коли підписка закінчується, доступ закривається сам." actions={<Link href="/offers" className="btn sm">Оффери</Link>}>
          {inPlans.length ? inPlans.map((p) => <Row key={p.id} tone={p.isActive ? "on" : "off"} title={<Link href={`/offers/${p.id}`}>{p.name}</Link>} sub={`${priceLabel(p)} · ${p.paymentType === "one_time" ? "разова оплата" : "підписка"}${(p.entitlements ?? {})[resourceKey] ? ` · квота ${(p.entitlements ?? {})[resourceKey]}` : ""}`} right={<Pill tone={p.isActive ? "good" : "mute"}>{p.isActive ? "продається" : "зупинено"}</Pill>} />)
            : <EmptyState title="Жоден тариф ще не дає доступ до «Щиро»" text="Відкрийте оффер і поставте галочку на ресурсі «Бот Щиро» у правах. Після цього всі активні підписки на цей тариф отримають бота автоматично." action={<Link href="/offers" className="btn sm">До офферів</Link>} />}
        </Section>
        {s && <Section title="Залученість клієнток" description="За кількістю повідомлень на людину: спробували, розговорилися, постійні.">
          <div className="grid g3">
            <Stat label="Спробували" value={n(s.activity.engagement.tried)} hint="до 4 повідомлень" />
            <Stat label="Розговорилися" value={n(s.activity.engagement.engaged)} hint="5–20 повідомлень" />
            <Stat label="Постійні" value={n(s.activity.engagement.loyal)} hint="понад 20" tone="good" />
          </div>
        </Section>}
        {s && Object.keys(s.usage.by_kind).length > 0 && <Section title="Витрата токенів за типом виклику" className="tbl">
          <table><thead><tr><th>Тип</th><th className="num">Викликів</th><th className="num">Вхідних</th><th className="num">Вихідних</th><th className="num">Усього</th></tr></thead><tbody>
            {Object.entries(s.usage.by_kind).map(([k, v]) => <tr key={k}><td className="mono">{({ answer: "відповіді клієнткам", summary: "стиснення пам'яті", analytics: "аналітичний звіт" } as Record<string, string>)[k] ?? k}</td><td className="num">{n(v.calls)}</td><td className="num">{n(v.prompt_tokens)}</td><td className="num">{n(v.completion_tokens)}</td><td className="num">{n(v.total_tokens)}</td></tr>)}
          </tbody></table>
        </Section>}
      </div>
      <div className="form aside-sticky">
        <Section title="Як це працює">
          <ol className="fld-h" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
            <li>Людина оплачує тариф із ресурсом «Бот Щиро» або отримує ручне право в картці.</li>
            <li>Hub щохвилини передає зміни боту: нове право відкриває доступ, завершена підписка закриває.</li>
            <li>Бот перевіряє свій список доступу з кешем 5 секунд, тому зміни видно майже одразу.</li>
            <li>Щодня о 04:00 Hub звіряє повний список із ботом і виправляє розбіжності. Пам'ять клієнток при цьому не чіпається.</li>
          </ol>
        </Section>
        <Section title="Стан підключення">
          <KV items={[
            { k: "Адреса API", v: configured ? `${shchyroBaseUrl()}/api/v1/hub` : "не задано", mono: true },
            { k: "Останній тік", v: lp?.at ? `${dateTime(lp.at)} · +${lp.granted ?? 0} / −${lp.revoked ?? 0}${lp.failed ? ` · помилок ${lp.failed}` : ""}` : "ще не було", mono: true },
            { k: "Остання звірка", v: ls?.at ? `${dateTime(ls.at)} · ${ls.ok ? `+${ls.activated ?? 0} / −${ls.deactivated ?? 0}` : "не пройшла"}` : "ще не було", mono: true },
            { k: "Моделі бота", v: s ? `${s.memory.llm_model} · пам'ять ${s.memory.summary_model}` : "—", mono: true },
            { k: "Адміністраторів бота", v: s ? n(s.access.admin_ids.length) : "—", mono: true },
          ]} />
          <div className="row-actions" style={{ marginTop: 12 }}><Link href="/shchyro?tab=access" className="btn sm">Керувати доступом</Link></div>
        </Section>
        {s?.analytics.last_ok && <Section title="Аналітичний звіт">
          <KV items={[{ k: "Останній звіт", v: dateTime(s.analytics.last_ok.finished_at), mono: true }, { k: "Охоплено клієнток", v: n(s.analytics.last_ok.clients_analyzed), mono: true }, { k: "Наступний", v: s.analytics.days_left != null ? (s.analytics.days_left <= 0 ? "час оновити" : `через ${s.analytics.days_left} дн`) : "—", mono: true }]} />
          <div className="row-actions" style={{ marginTop: 12 }}><Link href="/shchyro?tab=analytics" className="btn sm"><Sparkles size={14} /> Читати звіт</Link></div>
        </Section>}
      </div>
    </div>
  </>);
}
async function People({ configured, sp, entitled, link }: { configured: boolean; sp: SP; entitled: Entitled[]; link: (p: Partial<SP>) => string }) {
  const q = (sp.q ?? "").trim(); const f = sp.f ?? "all"; const page = Math.max(1, Number(sp.p) || 1); const per = 50;
  const r = configured ? await shchyroClients(q, 500, 0) : null;
  const rows: ShchyroClientRow[] = r?.ok ? r.data.items : [];
  const entitledTg = new Set(entitled.map((e) => e.telegramUserId));
  const people = await peopleByTelegram(rows.map((x) => x.user_id));
  let list = rows;
  if (f === "access") list = rows.filter((x) => x.access.has_access);
  else if (f === "noaccess") list = rows.filter((x) => !x.access.has_access);
  else if (f === "mismatch") list = rows.filter((x) => x.access.has_access !== entitledTg.has(x.user_id) && !x.access.is_admin);
  const mismatch = rows.filter((x) => x.access.has_access !== entitledTg.has(x.user_id) && !x.access.is_admin).length;
  const slice = list.slice((page - 1) * per, page * per);
  return (<>
    <Toolbar>
      <form className="search" method="get"><input type="hidden" name="tab" value="people" /><input name="q" defaultValue={q} placeholder="Ім'я, @username або Telegram ID" />{f !== "all" && <input type="hidden" name="f" value={f} />}</form>
      <div className="seg">{[["all", `Усі · ${rows.length}`], ["access", `З доступом · ${rows.filter((x) => x.access.has_access).length}`], ["noaccess", `Без доступу · ${rows.filter((x) => !x.access.has_access).length}`], ["mismatch", `Розбіжності · ${mismatch}`]].map(([k, l]) => <Link key={k} href={link({ tab: "people", f: k, p: undefined })} className={f === k ? "on" : ""}>{l}</Link>)}</div>
    </Toolbar>
    {configured && r && !r.ok && <Alert tone="bad">«Щиро» не відповідає: {r.error}</Alert>}
    {mismatch > 0 && f !== "mismatch" && <Alert tone="info">У {mismatch} людей доступ у боті не збігається з правом у Hub: бот відкритий без права (додані вручну в панелі «Щиро» або до переїзду) або право є, а бот ще не відкрито. Звірка на вкладці «Доступ» вирівнює це.</Alert>}
    {!slice.length ? <div className="card"><EmptyState title={q ? "Нічого не знайдено" : "Клієнток ще немає"} text="Тут з'являються всі, хто писав боту «Щиро», зі станом доступу та пам'яттю бота." /></div> : <div className="card tbl"><table>
      <thead><tr><th>Клієнтка</th><th>Telegram ID</th><th>У боті</th><th>Право в Hub</th><th className="num">Повідомлень</th><th className="num">Сесій</th><th>Картка</th><th>Остання активність</th><th></th></tr></thead>
      <tbody>{slice.map((x) => { const p = people[x.user_id]; const ent = entitledTg.has(x.user_id); return <tr key={x.user_id}>
        <td>{p ? <Link href={`/people/${p.id}`}>{p.name}</Link> : <span>{[x.first_name, x.last_name].filter(Boolean).join(" ") || "без імені"} <Pill tone="mute">немає в Hub</Pill></span>}{x.username ? <div className="fld-h">@{x.username}</div> : null}</td>
        <td className="mono">{x.user_id}</td>
        <td>{x.access.is_admin ? <Pill tone="moon">адмін</Pill> : x.access.is_active ? <Pill tone="good">відкрито</Pill> : <Pill tone="mute">закрито</Pill>}{x.access.source && x.access.is_active ? <div className="fld-h">{x.access.source === "hub" ? "з Hub" : x.access.source === "manual" ? "вручну в «Щиро»" : x.access.source}</div> : null}</td>
        <td>{ent ? <Pill tone="good">є</Pill> : <Pill tone="mute">немає</Pill>}{!x.access.is_admin && ent !== x.access.has_access && <div className="fld-h" style={{ color: "var(--warn)" }}>розбіжність</div>}</td>
        <td className="num">{n(x.total_messages)}</td><td className="num">{n(x.sessions_count)}</td>
        <td>{x.profile_version ? <Pill tone="moon">v{x.profile_version}</Pill> : <span className="fld-h">ще немає</span>}</td>
        <td className="mono">{dateTime(x.last_seen_at)}</td>
        <td><div className="row-actions">{p && <Link href={`/people/${p.id}`} className="btn sm ghost">Картка</Link>}{shchyroPanelClientUrl(x.user_id) && <a href={shchyroPanelClientUrl(x.user_id)!} target="_blank" rel="noreferrer" className="btn sm ghost" title="Переписка в панелі «Щиро»"><ExternalLink size={13} /></a>}</div></td>
      </tr>; })}</tbody></table>
      <Pager page={page} total={list.length} per={per} href={(p) => link({ tab: "people", p: String(p) })} />
    </div>}
    <p className="fld-h" style={{ marginTop: 12 }}>Список бере дані з бота: хто писав, скільки, чи є картка пам'яті. Повна переписка відкривається в панелі «Щиро»; у картці людини в Hub видно картку пам'яті й останні репліки.</p>
  </>);
}

async function Analytics({ configured, sp }: { configured: boolean; sp: SP }) {
  const r = configured ? await shchyroAnalytics(true) : null;
  const a: ShchyroAnalytics | null = r?.ok ? r.data : null;
  const runId = Number(sp.run) || 0;
  const pr = runId && configured ? await shchyroAnalyticsRun(runId) : null;
  const picked: ShchyroRun | null = pr?.ok ? pr.data : null;
  const shown = picked ?? a?.last_ok ?? null;
  const due = a?.days_left != null && a.days_left <= 0;
  return (<>
    {configured && r && !r.ok && <Alert tone="bad">«Щиро» не відповідає: {r.error}</Alert>}
    {a?.running && <Alert tone="info">Звіт формується зараз: агент проходить по картках клієнток, це кілька хвилин. Оновіть сторінку трохи згодом.</Alert>}
    {a && !a.running && due && <Alert tone="warn">Минуло понад {a.period_days} дн. з останнього звіту: час оновити.</Alert>}
    <div className="grid g4" style={{ marginBottom: 16 }}>
      <Stat label="Останній звіт" value={a?.last_ok ? date(a.last_ok.finished_at) : "—"} hint={a?.last_ok ? `охоплено ${n(a.last_ok.clients_analyzed)} клієнток` : "ще не було"} />
      <Stat label="Наступний" value={a?.days_left == null ? "—" : a.days_left <= 0 ? "зараз" : `${a.days_left} дн`} hint={a ? `період ${a.period_days} дн` : undefined} tone={due ? "warn" : undefined} />
      <Stat label="Токенів на звіт" value={a?.last_ok ? n(a.last_ok.total_tokens) : "—"} hint={a ? a.model : undefined} />
      <Stat label="Запусків" value={a ? n(a.runs.length) : "—"} hint={a?.latest?.status === "failed" ? "останній упав" : undefined} tone={a?.latest?.status === "failed" ? "crit" : undefined} />
    </div>
    <div className="grid g21">
      <Section title={shown ? `Звіт від ${date(shown.finished_at ?? shown.started_at)}` : "Звіт"} description={shown ? `${shown.started_by === "hub" ? "запущено з Hub" : `запустив ${shown.started_by ?? "—"}`} · ${n(shown.clients_analyzed)} клієнток · ${n(shown.total_tokens)} токенів` : "Агент читає картки пам'яті клієнток і зводить, хто ці люди, з чим звертаються, коли пишуть і на що звернути увагу."}
        actions={<>{shown?.report_md && <a href={`/shchyro/report/${shown.id}`} className="btn sm"><Download size={14} /> .md</a>}<form action={shchyroStartAnalytics}><button className="btn pri sm" type="submit" disabled={!configured || Boolean(a?.running)}><RefreshCw size={14} /> Оновити звіт</button></form></>}>
        {shown?.report_md ? <div className="report" dangerouslySetInnerHTML={{ __html: markdownToHtml(shown.report_md) }} /> : shown?.status === "failed" ? <Alert tone="bad">Запуск не вдався: {shown.error}</Alert> : <EmptyState icon={<Sparkles size={20} />} title="Звіту ще немає" text="Натисніть «Оновити звіт»: агент пройде по картках і за кілька хвилин збере зведення для власниці практики." />}
      </Section>
      <div className="form aside-sticky">
        <Section title="Історія запусків">
          {a?.runs.length ? a.runs.map((x) => <Row key={x.id} tone={x.status === "done" ? "on" : x.status === "running" ? "warn" : "off"} title={<Link href={`/shchyro?tab=analytics&run=${x.id}`}>{dateTime(x.started_at)}</Link>} sub={`${x.status === "done" ? "готовий" : x.status === "running" ? "формується" : `не вдався${x.error ? ": " + x.error.slice(0, 80) : ""}`} · ${n(x.clients_analyzed)} клієнток · ${n(x.total_tokens)} ток.`} right={x.status === "done" ? <a href={`/shchyro/report/${x.id}`} className="btn sm ghost" title="Завантажити .md"><Download size={13} /></a> : undefined} />)
            : <p className="fld-h">Запусків ще не було.</p>}
        </Section>
        <Section title="Чому це недорого"><p className="fld-h" style={{ margin: 0 }}>Агент не перечитує сирі діалоги: бере вже стиснуті картки клієнток і статистику з бази. Сотня клієнток — це кілька викликів моделі, а не сотня. Повний текст звіту також доступний у панелі «Щиро».</p></Section>
      </div>
    </div>
  </>);
}
