import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Eye, Play, Pause, Send, RefreshCw, Trash2, Pencil, Copy, ArrowUp, ArrowDown, Plus, GitBranch, Users, MessageSquareText } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { PageHeader, Section, Field, FormRow, Stat, Row, EmptyState, Alert, KV } from "@/components/ui/layout";
import { Kebab, MenuAction, MenuLink, MenuSep, Switch, AutoSubmitToggleClient } from "@/components/ui/controls";
import { CoverInput, StepText } from "@/components/funnel-ui";
import { StepIcon } from "@/components/step-icon";
import { navCounts, funnelDetail, botList } from "@/lib/queries";
import { saveFunnelSettings, deleteFunnel, setFunnelStatus, addStep, deleteStep, moveStep, toggleStep, duplicateStep, testFunnelOnMe, stopFunnelEnrollment, runTickNow, addModule, renameModule, deleteModule, moveModule, saveCommand, deleteCommand } from "@/lib/actions";
import { dateTime, fullName } from "@/lib/format";
import { STEP_TYPES, sendTimeLabel, type StepConfig, type FunnelSettings } from "@/lib/funnels";

export const dynamic = "force-dynamic";
const TABS = [["content", "Зміст"], ["modules", "Модулі"], ["menu", "Меню"], ["settings", "Налаштування"]] as const;

export default async function FunnelEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; saved?: string; tested?: string }> }) {
  const { id } = await params; const sp = await searchParams;
  const [counts, d, bl] = await Promise.all([navCounts(), funnelDetail(Number(id)), botList()]);
  if (!d) notFound();
  const { f, steps, modules, commands, stats, enr, waiting, summary } = d;
  const fs = (f.settings ?? {}) as FunnelSettings;
  const tab = TABS.some((t) => t[0] === sp.tab) ? sp.tab! : "content";
  const botUser = bl.find((b) => b.key === "hub")?.username;
  const stat = (sid: number) => stats.find((x) => x.stepId === sid);
  const wait = (pos: number) => waiting.find((x) => x.pos === pos)?.c ?? 0;
  const pct = (n: number) => summary.started ? Math.round((n / summary.started) * 100) : 0;
  const stepLabel = (t: string) => STEP_TYPES.find((x) => x.key === t)?.label ?? t;
  const groups = [...modules.map((m) => ({ mod: m, items: steps.filter((s) => s.moduleId === m.id) })), { mod: null as (typeof modules)[number] | null, items: steps.filter((s) => !s.moduleId || !modules.some((m) => m.id === s.moduleId)) }].filter((g) => g.items.length || g.mod);
  const StepRow = ({ st, i }: { st: (typeof steps)[number]; i: number }) => { const c = (st.config ?? {}) as StepConfig; const s = stat(st.id); return (
    <tr>
      <td><div className="row-actions" style={{ flexWrap: "nowrap" }}><StepIcon type={st.type} /><div><Link href={`/funnels/${f.id}/steps/${st.id}`} className="lnk-ink">{i + 1}. {st.title || stepLabel(st.type)}</Link><div className="fld-h">{stepLabel(st.type)}{c.attachments?.length ? ` · ${c.attachments.length} вкл.` : ""}{c.buttons?.length ? ` · ${c.buttons.length} кн.` : ""}</div></div></div></td>
      <td className="num">{s?.people ?? 0}</td><td className="num">{wait(st.position)}</td><td className="num">{summary.started ? Math.round(((s?.people ?? 0) / summary.started) * 100) : 0}%</td>
      <td className="mono" style={{ fontSize: 12.5 }}>{sendTimeLabel(c)}{c.autodelete?.mode === "in" ? " · автовидалення" : ""}{c.protect || fs.contentProtection ? " · захист" : ""}</td>
      <td><form action={toggleStep}><input type="hidden" name="id" value={st.id} /><input type="hidden" name="funnelId" value={f.id} /><AutoSubmitToggleClient checked={st.isActive} label={st.isActive ? "Активний" : "Зупинений"} /></form></td>
      <td><Kebab>
        <MenuLink href={`/funnels/${f.id}/steps/${st.id}`} icon={<Pencil />}>Редагувати</MenuLink>
        <MenuAction action={duplicateStep} fields={{ id: st.id, funnelId: f.id }} icon={<Copy />}>Дублювати</MenuAction>
        <MenuAction action={moveStep} fields={{ id: st.id, funnelId: f.id, dir: "up" }} icon={<ArrowUp />} disabled={i === 0}>Вище</MenuAction>
        <MenuAction action={moveStep} fields={{ id: st.id, funnelId: f.id, dir: "down" }} icon={<ArrowDown />} disabled={i === steps.length - 1}>Нижче</MenuAction>
        <MenuSep />
        <MenuAction action={deleteStep} fields={{ id: st.id, funnelId: f.id }} icon={<Trash2 />} danger confirm={`Видалити крок «${st.title ?? ""}»?`}>Видалити</MenuAction>
      </Kebab></td>
    </tr>); };
  const AddStep = ({ moduleId }: { moduleId?: number }) => (
    <form action={addStep} className="types"><input type="hidden" name="funnelId" value={f.id} />{moduleId ? <input type="hidden" name="moduleId" value={moduleId} /> : null}
      {STEP_TYPES.map((t) => <button key={t.key} type="submit" name="type" value={t.key}><b><StepIcon type={t.key} /> {t.label}</b><small>{t.hint}</small></button>)}
    </form>);
  return (
    <Shell title="Воронки" counts={counts}>
      <PageHeader back="/funnels" backLabel="Воронки" icon={<GitBranch size={16} />} title={f.name}
        status={<Pill tone={f.isActive ? "good" : f.status === "stopped" ? "warn" : "mute"}>{f.isActive ? "активна" : f.status === "stopped" ? "зупинена" : "чернетка"}</Pill>}
        actions={<>
          <form action={testFunnelOnMe}><input type="hidden" name="funnelId" value={f.id} /><button className="btn sm" type="submit" name="mode" value="steps" disabled={!f.isActive} title="Надішле кроки воронки на ваш Telegram"><Send size={15} /> Тест собі</button></form>
          <form action={setFunnelStatus}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="status" value={f.isActive ? "stopped" : "active"} /><button className={`btn sm ${f.isActive ? "" : "pri"}`} type="submit">{f.isActive ? <><Pause size={15} /> Зупинити</> : <><Play size={15} /> Активувати</>}</button></form>
          <Kebab>
            <MenuLink href={`/f/${f.id}`} icon={<Eye />} external>Перегляд лендінгу</MenuLink>
            <MenuAction action={testFunnelOnMe} fields={{ funnelId: f.id, mode: "intro" }} icon={<MessageSquareText />} disabled={!f.isActive}>Тест вступу з кнопкою</MenuAction>
            <MenuAction action={runTickNow} icon={<RefreshCw />}>Надіслати належні кроки зараз</MenuAction>
            <MenuSep />
            <MenuAction action={deleteFunnel} fields={{ id: f.id }} icon={<Trash2 />} danger confirm={`Видалити воронку «${f.name}»?`}>Видалити воронку</MenuAction>
          </Kebab>
        </>} />
      {sp.saved && <Alert tone="ok">Налаштування збережено.</Alert>}
      {sp.tested === "1" && <Alert tone="ok">Надіслано на ваш Telegram. Кроки із затримкою прийдуть за розкладом.</Alert>}
      {sp.tested === "0" && <Alert tone="bad">Не знайдено вашу людину в Hub: натисніть /start у Hub-боті з акаунта, вказаного в ADMIN_TELEGRAM_ID.</Alert>}
      {!f.isActive && <Alert tone="warn">Воронка не активна: люди не заходять у неї, кроки не надсилаються. Натисніть «Активувати», коли зміст готовий.</Alert>}
      <div className="tabs">{TABS.map(([k, l]) => <Link key={k} href={`/funnels/${f.id}?tab=${k}`} className={tab === k ? "on" : ""}>{l}{k === "content" ? ` · ${steps.length}` : k === "modules" ? ` · ${modules.length}` : k === "menu" ? ` · ${commands.length}` : ""}</Link>)}</div>

      {tab === "content" && <>
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <Stat label="Розпочали" value={summary.started} hint="усі, хто заходив у воронку" />
          <Stat label="Активні" value={summary.active} hint={`${pct(summary.active)}%`} tone="good" />
          <Stat label="Зупинені" value={summary.stopped} hint={`${pct(summary.stopped)}%`} tone={summary.stopped ? "warn" : undefined} />
          <Stat label="Завершили" value={summary.finished} hint={`${pct(summary.finished)}%`} />
        </div>
        <Section title="Кроки" description="Порядок у списку = порядок надсилання. Час кожного кроку рахується від попереднього." className="tbl">
          <table><thead><tr><th>Крок</th><th className="num">Отримали</th><th className="num">Чекають</th><th className="num">Дійшли</th><th>Час надсилання</th><th>Статус</th><th></th></tr></thead><tbody>
            {groups.map((g) => <Fragment key={g.mod?.id ?? "none"}>
              {g.mod && <tr className="modhead"><td colSpan={7}>{g.mod.name} <span className="muted" style={{ fontWeight: 400 }}>· {g.items.length} кроків</span></td></tr>}
              {!g.mod && modules.length > 0 && g.items.length > 0 && <tr className="modhead"><td colSpan={7}>Без модуля</td></tr>}
              {g.items.map((st) => <StepRow key={st.id} st={st} i={steps.findIndex((x) => x.id === st.id)} />)}
            </Fragment>)}
            {!steps.length && <tr><td colSpan={7}><EmptyState title="Кроків ще немає" text="Оберіть тип першого кроку нижче." /></td></tr>}
          </tbody></table>
        </Section>
        <Section title="Додати крок" description={modules.length ? "Крок без модуля. Усередині модуля кроки додаються на вкладці «Модулі»." : undefined}><AddStep /></Section>
        <Section title="Проходження" description={`останні ${enr.length}`}>
          {enr.map(({ e, p }) => <Row key={e.id} tone={e.status === "active" ? "on" : "off"} title={<Link href={`/people/${p.id}`}>{fullName(p)}</Link>} sub={`${e.status === "active" ? "проходить" : e.status === "done" ? "завершила" : "зупинено"} · крок ${steps.findIndex((x) => x.position >= e.nextPosition) + 1 || "—"} · далі ${dateTime(e.nextAt)}${e.awaitingStepId ? " · чекаємо відповідь" : ""}${e.stopReason ? " · " + e.stopReason : ""}`}
            right={e.status === "active" ? <form action={stopFunnelEnrollment}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="funnelId" value={f.id} /><button className="btn sm ghost" type="submit">Зупинити</button></form> : undefined} />)}
          {!enr.length && <EmptyState icon={<Users size={20} />} title="Ще ніхто не проходив" text="Додайте людину з її картки або натисніть «Тест собі»." />}
        </Section>
      </>}

      {tab === "modules" && <div className="grid g12">
        <form action={addModule}><input type="hidden" name="funnelId" value={f.id} /><Section title="Новий модуль" description="Модулі групують кроки, як розділи курсу. Порядок надсилання визначає загальна послідовність кроків."><Field label="Назва"><input name="name" placeholder="Модуль 1. Основи" required /></Field><div className="row-actions" style={{ marginTop: 12 }}><button className="btn pri" type="submit"><Plus size={15} /> Додати модуль</button></div></Section></form>
        <div className="form">
          {modules.map((m, i) => <Section key={m.id} title={<form action={renameModule} className="row-actions" style={{ flexWrap: "nowrap" }}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="funnelId" value={f.id} /><input name="name" defaultValue={m.name} className="input" style={{ width: 260, fontWeight: 600 }} aria-label="Назва модуля" /><button className="btn sm ghost" type="submit">Зберегти</button></form>}
            actions={<Kebab><MenuAction action={moveModule} fields={{ id: m.id, funnelId: f.id, dir: "up" }} icon={<ArrowUp />} disabled={i === 0}>Вище</MenuAction><MenuAction action={moveModule} fields={{ id: m.id, funnelId: f.id, dir: "down" }} icon={<ArrowDown />} disabled={i === modules.length - 1}>Нижче</MenuAction><MenuSep /><MenuAction action={deleteModule} fields={{ id: m.id, funnelId: f.id }} icon={<Trash2 />} danger confirm={`Видалити модуль «${m.name}»? Кроки залишаться.`}>Видалити</MenuAction></Kebab>}>
            {steps.filter((s) => s.moduleId === m.id).map((s) => <Row key={s.id} icon={<StepIcon type={s.type} />} title={<Link href={`/funnels/${f.id}/steps/${s.id}`}>{steps.indexOf(s) + 1}. {s.title || stepLabel(s.type)}</Link>} sub={sendTimeLabel((s.config ?? {}) as StepConfig)} right={<Pill tone={s.isActive ? "good" : "mute"}>{s.isActive ? "активний" : "зупинений"}</Pill>} />)}
            <details style={{ marginTop: 8 }}><summary className="fld-h" style={{ cursor: "pointer" }}>Додати крок у модуль</summary><div style={{ marginTop: 8 }}><AddStep moduleId={m.id} /></div></details>
          </Section>)}
          {!modules.length && <div className="card"><EmptyState title="Модулів ще немає" text="Без модулів усі кроки йдуть одним списком." /></div>}
        </div>
      </div>}

      {tab === "menu" && <div className="grid g12">
        <form action={saveCommand}><input type="hidden" name="funnelId" value={f.id} /><Section title="Нова команда меню" description="Команди діють для людей, які проходять цю воронку; меню в Telegram оновлюється при вході.">
          <FormRow><Field label="Команда" hint="латиниця й цифри, без слеша"><input name="command" placeholder="lesson1" pattern="[a-zA-Z0-9_/]+" required /></Field><Field label="Опис у меню Telegram"><input name="description" placeholder="Урок 1" maxLength={256} /></Field></FormRow>
          <FormRow><Field label="Дія"><select name="actionType" defaultValue="step"><option value="step">Надіслати крок</option><option value="text">Відповісти текстом</option></select></Field><Field label="Крок для дії «надіслати крок»"><select name="stepId" defaultValue="">{steps.map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {s.title || stepLabel(s.type)}</option>)}</select></Field></FormRow>
          <Field label="Текст для дії «відповісти текстом»"><textarea name="text" rows={3} /></Field>
          <div className="row-actions" style={{ marginTop: 12 }}><button className="btn pri" type="submit"><Plus size={15} /> Додати команду</button></div>
        </Section></form>
        <Section title="Команди" description={`${commands.length}`} className="tbl">
          <table><thead><tr><th>Команда</th><th>Опис</th><th>Дія</th><th></th></tr></thead><tbody>
            {commands.map((c) => <tr key={c.id}><td className="mono">/{c.command}</td><td>{c.description}</td><td>{c.action.type === "step" ? `крок: ${steps.find((s) => s.id === c.action.stepId)?.title ?? "видалено"}` : `текст: ${(c.action.text ?? "").slice(0, 40)}`}</td><td><Kebab><MenuAction action={deleteCommand} fields={{ id: c.id, funnelId: f.id }} icon={<Trash2 />} danger confirm={`Видалити команду /${c.command}?`}>Видалити</MenuAction></Kebab></td></tr>)}
            {!commands.length && <tr><td colSpan={4}><EmptyState title="Команд ще немає" /></td></tr>}
          </tbody></table>
        </Section>
      </div>}

      {tab === "settings" && <form action={saveFunnelSettings} className="grid g21"><input type="hidden" name="id" value={f.id} />
        <div className="form">
          <Section title="Основне">
            <Field label="Назва"><input name="name" defaultValue={f.name} required maxLength={120} /></Field>
            <Field label="Опис" hint="Показується у вступному повідомленні перед кнопкою."><StepText name="description" defaultValue={f.description ?? ""} max={3000} minHeight={120} placeholder="Про що ця воронка й що отримає людина" /></Field>
            <Field label="Текст кнопки"><input name="buttonText" defaultValue={f.buttonText ?? "Отримати доступ"} maxLength={64} /></Field>
            <Field label="Обкладинка"><CoverInput current={f.cover} /></Field>
          </Section>
          <Section title="Посилання" description={`Якщо у воронки є опис або обкладинка, за посиланням людина спершу бачить вступ із кнопкою «${f.buttonText || "Отримати доступ"}». Без них воронка стартує одразу.`}>
            <div id="links"><KV items={[{ k: "Посилання на воронку", v: <span style={{ userSelect: "all" }}>https://t.me/{botUser ?? "hub-бот"}?start=f_{f.id}</span>, mono: true }, { k: "Лендінг", v: <a href={`/f/${f.id}`} target="_blank" rel="noreferrer">/f/{f.id}</a>, mono: true }]} /></div>
            <FormRow><Field label="Вхід"><select name="entryKind" defaultValue={fs.entryKind ?? "start"}><option value="start">параметр /start</option><option value="keyword">ключове слово в боті</option><option value="manual">лише вручну та за f_{f.id}</option></select></Field><Field label="Параметр або слова через кому"><input name="entryValue" defaultValue={fs.entryValue ?? ""} placeholder="promo_sep" /></Field></FormRow>
          </Section>
        </div>
        <div className="form aside-sticky">
          <Section title="Доступ">
            <Switch name="accessDirect" defaultChecked={Boolean(fs.accessDirect)} label="Після прямої підписки на бота" hint="усі, хто натискає /start без посилання, потрапляють у воронку" />
            <Switch name="accessAfterFinish" defaultChecked={fs.accessAfterFinish !== false} label="Після завершення воронки" hint="команди меню й кнопки кроків далі працюють" />
            <Switch name="contentProtection" defaultChecked={Boolean(fs.contentProtection)} label="Захист контенту" hint="без пересилання й збереження" />
          </Section>
          <Section title="Більше">
            <Switch name="restart" defaultChecked={Boolean(fs.restart)} label="Перезапуск воронки" hint="людина може пройти її знову" />
            <Switch name="lessonTitles" defaultChecked={Boolean(fs.lessonTitles)} label="Назви уроків" hint="назва кроку-уроку жирним на початку" />
            <Switch name="quietHours" defaultChecked={fs.quietHours !== false} label="Тихі години" hint="відкладені кроки не йдуть 22:00–09:00" />
            <Switch name="template" defaultChecked={Boolean(fs.template)} label="Шаблон" hint="лише для дублювання, людей не приймає" />
          </Section>
          <Section><div className="form"><button className="btn pri" type="submit">Зберегти</button><Link href={`/funnels/${f.id}`} className="btn ghost">Скасувати</Link></div></Section>
        </div>
      </form>}
    </Shell>
  );
}
