import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { ConfirmSubmit, CoverInput, AutoSubmitToggle, StepText } from "@/components/funnel-ui";
import { Kebab } from "@/components/kebab";
import { navCounts, funnelDetail, botList } from "@/lib/queries";
import { saveFunnelSettings, deleteFunnel, setFunnelStatus, addStep, deleteStep, moveStep, toggleStep, duplicateStep, testFunnelOnMe, stopFunnelEnrollment, runTickNow, addModule, renameModule, deleteModule, moveModule, saveCommand, deleteCommand } from "@/lib/actions";
import { dateTime, fullName } from "@/lib/format";
import { STEP_TYPES, STEP_ICON as TYPE_ICON, sendTimeLabel, type StepConfig, type FunnelSettings } from "@/lib/funnels";

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
  const groups: { mod: (typeof modules)[number] | null; items: typeof steps }[] = [...modules.map((m) => ({ mod: m, items: steps.filter((s) => s.moduleId === m.id) })), { mod: null, items: steps.filter((s) => !s.moduleId || !modules.some((m) => m.id === s.moduleId)) }].filter((g) => g.items.length || g.mod);
  const StepRow = ({ st, i }: { st: (typeof steps)[number]; i: number }) => { const c = (st.config ?? {}) as StepConfig; const s = stat(st.id); return (
    <tr>
      <td><div className="row-actions" style={{ flexWrap: "nowrap" }}><span className={`steptype ${st.type}`} title={stepLabel(st.type)}>{TYPE_ICON[st.type]}</span><div><b style={{ fontWeight: 500 }}><Link href={`/funnels/${f.id}/steps/${st.id}`}>{i + 1}. {st.title || stepLabel(st.type)}</Link></b><br /><small className="muted">{stepLabel(st.type)}{c.attachments?.length ? ` · ${c.attachments.length} вкл.` : ""}{c.buttons?.length ? ` · ${c.buttons.length} кн.` : ""}</small></div></div></td>
      <td className="num">{s?.people ?? 0}</td><td className="num">{wait(st.position)}</td><td className="num">{summary.started ? Math.round(((s?.people ?? 0) / summary.started) * 100) : 0}%</td>
      <td className="mono" style={{ fontSize: 12.5 }}>{sendTimeLabel(c)}{c.autodelete?.mode === "in" ? " · 🗑" : ""}{c.protect || fs.contentProtection ? " · 🔒" : ""}</td>
      <td><form action={toggleStep}><input type="hidden" name="id" value={st.id} /><input type="hidden" name="funnelId" value={f.id} /><AutoSubmitToggle checked={st.isActive} label={st.isActive ? "Активний" : "Зупинений"} /></form></td>
      <td><Kebab>
        <Link href={`/funnels/${f.id}/steps/${st.id}`}>✎ Редагувати</Link>
        <form action={duplicateStep}><input type="hidden" name="id" value={st.id} /><input type="hidden" name="funnelId" value={f.id} /><button type="submit">⧉ Дублювати</button></form>
        <form action={moveStep}><input type="hidden" name="id" value={st.id} /><input type="hidden" name="funnelId" value={f.id} /><button type="submit" name="dir" value="up" disabled={i === 0}>↑ Вище</button><button type="submit" name="dir" value="down" disabled={i === steps.length - 1}>↓ Нижче</button></form>
        <div className="sep" />
        <form action={deleteStep}><input type="hidden" name="id" value={st.id} /><input type="hidden" name="funnelId" value={f.id} /><ConfirmSubmit className="danger" message={`Видалити крок «${st.title ?? ""}»?`}>🗑 Видалити</ConfirmSubmit></form>
      </Kebab></td>
    </tr>); };
  const AddStep = ({ moduleId }: { moduleId?: number }) => (
    <form action={addStep} className="types"><input type="hidden" name="funnelId" value={f.id} />{moduleId ? <input type="hidden" name="moduleId" value={moduleId} /> : null}
      {STEP_TYPES.map((t) => <button key={t.key} type="submit" name="type" value={t.key}><b>{TYPE_ICON[t.key]} {t.label}</b><small>{t.hint}</small></button>)}
    </form>);
  return (
    <Shell title="Воронки" counts={counts}>
            <div className="fhead">
        <Link href="/funnels" className="btn sm ghost">← Воронки</Link>
        <h2>{f.name}</h2>
        <Pill tone={f.isActive ? "good" : f.status === "stopped" ? "warn" : "mute"}>{f.isActive ? "активна" : f.status === "stopped" ? "зупинена" : "чернетка"}</Pill>
        <a href={`/f/${f.id}`} target="_blank" rel="noreferrer" className="btn sm">👁 Перегляд</a>
        <form action={testFunnelOnMe}><input type="hidden" name="funnelId" value={f.id} /><button className="btn sm" type="submit" name="mode" value="steps" disabled={!f.isActive} title="Надішле кроки воронки на ваш Telegram">▶ Тест собі</button></form>
        <form action={setFunnelStatus}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="status" value={f.isActive ? "stopped" : "active"} /><button className={`btn sm ${f.isActive ? "" : "pri"}`} type="submit">{f.isActive ? "⏸ Зупинити" : "▶ Активувати"}</button></form>
        <Kebab>
          <form action={testFunnelOnMe}><input type="hidden" name="funnelId" value={f.id} /><button type="submit" name="mode" value="intro" disabled={!f.isActive}>💬 Тест вступу з кнопкою</button></form>
          <form action={runTickNow}><button type="submit">⟳ Надіслати належні кроки зараз</button></form>
          <div className="sep" />
          <form action={deleteFunnel}><input type="hidden" name="id" value={f.id} /><ConfirmSubmit className="danger" message={`Видалити воронку «${f.name}»?`}>🗑 Видалити воронку</ConfirmSubmit></form>
        </Kebab>
      </div>
      {sp.saved && <div className="alert ok">Налаштування збережено.</div>}
      {sp.tested === "1" && <div className="alert ok">Надіслано на ваш Telegram. Кроки із затримкою прийдуть за розкладом (щохвилинний тік).</div>}
      {sp.tested === "0" && <div className="alert bad">Не знайдено вашу людину в Hub: натисніть /start у Hub-боті з акаунта, вказаного в ADMIN_TELEGRAM_ID.</div>}
      {!f.isActive && <div className="alert">Воронка не активна: люди не заходять у неї, кроки не надсилаються. Натисніть «Активувати», коли зміст готовий.</div>}
      <div className="tabs">{TABS.map(([k, l]) => <Link key={k} href={`/funnels/${f.id}?tab=${k}`} className={tab === k ? "on" : ""}>{l}{k === "content" ? ` · ${steps.length}` : k === "modules" ? ` · ${modules.length}` : k === "menu" ? ` · ${commands.length}` : ""}</Link>)}</div>

      {tab === "content" && <>
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <div className="stat"><small>Розпочали</small><b>{summary.started}</b><span className="pct">усі, хто заходив у воронку</span></div>
          <div className="stat"><small>Активні</small><b>{summary.active}</b><span className="pct">{pct(summary.active)}%</span></div>
          <div className="stat"><small>Зупинені</small><b>{summary.stopped}</b><span className="pct">{pct(summary.stopped)}%</span></div>
          <div className="stat"><small>Завершили</small><b>{summary.finished}</b><span className="pct">{pct(summary.finished)}%</span></div>
        </div>
        <div className="card tbl" style={{ marginBottom: 16 }}>
          <table><thead><tr><th>Крок</th><th className="num">Отримали</th><th className="num">Чекають</th><th className="num">Дійшли</th><th>Час надсилання</th><th>Статус</th><th></th></tr></thead><tbody>
            {groups.map((g) => <Fragment key={g.mod?.id ?? "none"}>
              {g.mod && <tr className="modhead"><td colSpan={7}>📂 {g.mod.name} <span className="muted" style={{ fontWeight: 400 }}>· {g.items.length} кроків</span></td></tr>}
              {!g.mod && modules.length > 0 && g.items.length > 0 && <tr className="modhead"><td colSpan={7}>Без модуля</td></tr>}
              {g.items.map((st) => <StepRow key={st.id} st={st} i={steps.findIndex((x) => x.id === st.id)} />)}
            </Fragment>)}
            {!steps.length && <tr><td colSpan={7} className="muted">Кроків ще немає. Оберіть тип першого кроку нижче.</td></tr>}
          </tbody></table>
        </div>
        <div className="card" style={{ marginBottom: 16 }}><h3>Додати крок {modules.length ? <span className="sub">без модуля; всередині модуля додавайте на вкладці «Модулі»</span> : null}</h3><AddStep /></div>
        <div className="card"><h3>Проходження <span className="sub">останні {enr.length}</span></h3>
          {enr.map(({ e, p }) => <div key={e.id} className="ent"><span className={`dot ${e.status === "active" ? "" : "off"}`} /><div><b><Link href={`/people/${p.id}`}>{fullName(p)}</Link></b><small>{e.status === "active" ? "проходить" : e.status === "done" ? "завершила" : "зупинено"} · крок {steps.findIndex((x) => x.position >= e.nextPosition) + 1 || "—"} · далі {dateTime(e.nextAt)}{e.awaitingStepId ? " · чекаємо відповідь" : ""}{e.stopReason ? " · " + e.stopReason : ""}</small></div>{e.status === "active" && <form action={stopFunnelEnrollment}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="funnelId" value={f.id} /><button className="btn sm ghost" type="submit">Зупинити</button></form>}</div>)}
          {!enr.length && <p className="muted">Ще ніхто не проходив. Додайте людину з її картки або натисніть «Тест собі».</p>}
        </div>
      </>}

      {tab === "modules" && <div className="grid g12">
        <div>
          <form action={addModule} className="card form" style={{ marginBottom: 16 }}><input type="hidden" name="funnelId" value={f.id} /><h3>Новий модуль</h3><label className="field">Назва<input name="name" placeholder="Модуль 1. Основи" required /></label><div><button className="btn pri" type="submit">Додати модуль</button></div>
            <p className="note">Модулі групують кроки (як розділи курсу). Порядок надсилання визначає загальна послідовність кроків у «Змісті».</p></form>
        </div>
        <div>
          {modules.map((m, i) => <div key={m.id} className="card" style={{ marginBottom: 12 }}>
            <div className="row-actions" style={{ marginBottom: 8 }}>
              <form action={renameModule} className="row-actions"><input type="hidden" name="id" value={m.id} /><input type="hidden" name="funnelId" value={f.id} /><input name="name" defaultValue={m.name} className="btn sm" style={{ width: 260, fontWeight: 600 }} /><button className="btn sm ghost" type="submit">ок</button></form>
              <form action={moveModule}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="funnelId" value={f.id} /><button className="btn sm ghost" name="dir" value="up" disabled={i === 0}>↑</button><button className="btn sm ghost" name="dir" value="down" disabled={i === modules.length - 1}>↓</button></form>
              <form action={deleteModule}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="funnelId" value={f.id} /><ConfirmSubmit className="btn sm danger ghost" message={`Видалити модуль «${m.name}»? Кроки залишаться.`}>Видалити</ConfirmSubmit></form>
            </div>
            {steps.filter((s) => s.moduleId === m.id).map((s) => <div key={s.id} className="ent"><span className={`steptype ${s.type}`}>{TYPE_ICON[s.type]}</span><div><b><Link href={`/funnels/${f.id}/steps/${s.id}`}>{steps.indexOf(s) + 1}. {s.title || stepLabel(s.type)}</Link></b><small>{sendTimeLabel((s.config ?? {}) as StepConfig)}</small></div><Pill tone={s.isActive ? "good" : "mute"}>{s.isActive ? "активний" : "зупинений"}</Pill></div>)}
            <details style={{ marginTop: 8 }}><summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>+ Додати крок у модуль</summary><div style={{ marginTop: 8 }}><AddStep moduleId={m.id} /></div></details>
          </div>)}
          {!modules.length && <div className="card"><p className="muted">Модулів ще немає. Без модулів усі кроки йдуть одним списком.</p></div>}
        </div>
      </div>}

      {tab === "menu" && <div className="grid g12">
        <form action={saveCommand} className="card form"><input type="hidden" name="funnelId" value={f.id} /><h3>Нова команда меню</h3>
          <label className="field">Команда<input name="command" placeholder="lesson1" pattern="[a-zA-Z0-9_/]+" required /></label>
          <label className="field">Опис у меню Telegram<input name="description" placeholder="Урок 1" maxLength={256} /></label>
          <label className="field">Дія<select name="actionType" defaultValue="step"><option value="step">Надіслати крок</option><option value="text">Відповісти текстом</option></select></label>
          <label className="field">Крок (для дії «надіслати крок»)<select name="stepId" defaultValue="">{steps.map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {s.title || stepLabel(s.type)}</option>)}</select></label>
          <label className="field">Текст (для дії «відповісти текстом»)<textarea name="text" rows={3} /></label>
          <div><button className="btn pri" type="submit">Додати команду</button></div>
          <p className="note">Команди діють для людей, які проходять цю воронку (і після завершення, якщо в налаштуваннях увімкнено доступ після завершення). Меню в Telegram оновлюється для людини при вході у воронку.</p>
        </form>
        <div className="card tbl"><h3>Команди <span className="sub">{commands.length}</span></h3>
          <table><thead><tr><th>Команда</th><th>Опис</th><th>Дія</th><th></th></tr></thead><tbody>
            {commands.map((c) => <tr key={c.id}><td className="mono">/{c.command}</td><td>{c.description}</td><td>{c.action.type === "step" ? `крок: ${steps.find((s) => s.id === c.action.stepId)?.title ?? "видалено"}` : `текст: ${(c.action.text ?? "").slice(0, 40)}`}</td><td><form action={deleteCommand}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="funnelId" value={f.id} /><button className="btn sm danger ghost" type="submit">✕</button></form></td></tr>)}
            {!commands.length && <tr><td colSpan={4} className="muted">Команд ще немає.</td></tr>}
          </tbody></table></div>
      </div>}

      {tab === "settings" && <form action={saveFunnelSettings} className="grid g12"><input type="hidden" name="id" value={f.id} />
        <div className="form">
          <div className="card form"><h3>Основне</h3>
            <label className="field">Назва<input name="name" defaultValue={f.name} required maxLength={120} /></label>
            <div className="field">Опис (показується у вступному повідомленні перед кнопкою)<StepText name="description" defaultValue={f.description ?? ""} max={3000} minHeight={120} placeholder="Про що ця воронка й що отримає людина…" /></div>
            <label className="field">Текст кнопки<input name="buttonText" defaultValue={f.buttonText ?? "Отримати доступ"} maxLength={64} /></label>
            <div className="field">Обкладинка<CoverInput current={f.cover} /></div>
          </div>
          <div className="card form" id="links"><h3>Посилання</h3>
            <div className="kv"><dt>Посилання на воронку</dt><dd className="mono" style={{ userSelect: "all" }}>https://t.me/{botUser ?? "<hub-бот>"}?start=f_{f.id}</dd>
              <dt>Лендінг</dt><dd className="mono"><a href={`/f/${f.id}`} target="_blank" rel="noreferrer">{`/f/${f.id}`}</a></dd></div>
            <label className="field">Власний параметр посилання (?start=…) або ключові слова через кому<div className="row-actions"><select name="entryKind" defaultValue={fs.entryKind ?? "start"} className="btn sm"><option value="start">параметр /start</option><option value="keyword">ключове слово в боті</option><option value="manual">лише вручну та за f_{f.id}</option></select><input name="entryValue" defaultValue={fs.entryValue ?? ""} placeholder="promo_sep" className="btn sm" style={{ flex: 1 }} /></div></label>
            <p className="note">Якщо у воронки є опис або обкладинка, за посиланням людина спершу бачить вступ із кнопкою «{f.buttonText || "Отримати доступ"}», і воронка стартує після натискання. Без опису й обкладинки воронка стартує одразу.</p>
          </div>
        </div>
        <div className="form">
          <div className="card form"><h3>Доступ</h3>
            <label className="ck"><input type="checkbox" name="accessDirect" defaultChecked={Boolean(fs.accessDirect)} /> Після прямої підписки на бота: усі, хто натискає /start без посилання, потрапляють у воронку</label>
            <label className="ck"><input type="checkbox" name="accessAfterFinish" defaultChecked={fs.accessAfterFinish !== false} /> Після завершення воронки команди меню й кнопки кроків далі працюють</label>
            <label className="ck"><input type="checkbox" name="contentProtection" defaultChecked={Boolean(fs.contentProtection)} /> Захист контенту: заборонити пересилання й збереження всіх кроків</label>
          </div>
          <div className="card form"><h3>Більше</h3>
            <label className="ck"><input type="checkbox" name="restart" defaultChecked={Boolean(fs.restart)} /> Перезапуск воронки: людина може пройти її знову за посиланням</label>
            <label className="ck"><input type="checkbox" name="lessonTitles" defaultChecked={Boolean(fs.lessonTitles)} /> Назви уроків: додавати назву кроку-уроку жирним на початку повідомлення</label>
            <label className="ck"><input type="checkbox" name="quietHours" defaultChecked={fs.quietHours !== false} /> Тихі години: відкладені кроки не надсилати 22:00–09:00 за Києвом</label>
            <label className="ck"><input type="checkbox" name="template" defaultChecked={Boolean(fs.template)} /> Шаблон воронки: показувати в списку для дублювання, людей не приймає</label>
          </div>
          <div className="row-actions"><button className="btn pri" type="submit">Зберегти</button><Link href={`/funnels/${f.id}`} className="btn ghost">Скасувати</Link></div>
        </div>
      </form>}
    </Shell>
  );
}

