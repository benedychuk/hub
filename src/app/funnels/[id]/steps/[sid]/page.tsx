import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { ConfirmSubmit, StepText, AttachmentsPicker, ButtonsEditor, SendTimeFields, AutoDeleteFields } from "@/components/funnel-ui";
import { navCounts, stepDetail } from "@/lib/queries";
import { saveStep, deleteStep, addStep } from "@/lib/actions";
import { STEP_TYPES, STEP_ICON, sendTimeLabel, type StepConfig, type FunnelSettings } from "@/lib/funnels";

export const dynamic = "force-dynamic";

export default async function StepEditor({ params, searchParams }: { params: Promise<{ id: string; sid: string }>; searchParams: Promise<{ saved?: string; sent?: string }> }) {
  const { id, sid } = await params; const sp = await searchParams;
  const [counts, d] = await Promise.all([navCounts(), stepDetail(Number(id), Number(sid))]);
  if (!d) notFound();
  const { f, step, steps, modules, media, allFunnels, offers } = d;
  const c = (step.config ?? {}) as StepConfig;
  const fs = (f.settings ?? {}) as FunnelSettings;
  const idx = steps.findIndex((s) => s.id === step.id);
  const type = STEP_TYPES.find((t) => t.key === step.type) ?? STEP_TYPES[0];
  const isOptions = step.type === "survey" || step.type === "quiz";
  return (
    <Shell title="Воронки" counts={counts}>
      <div className="fhead">
        <Link href={`/funnels/${f.id}`} className="btn sm ghost">← {f.name}</Link>
        <h2>Крок {idx + 1}: {step.title || type.label}</h2>
        <Pill tone="moon">{STEP_ICON[step.type]} {type.label}</Pill>
        <Pill tone={step.isActive ? "good" : "mute"}>{step.isActive ? "активний" : "зупинений"}</Pill>
      </div>
      {sp.saved && <div className="alert ok">Крок збережено.</div>}
      {sp.sent && <div className="alert ok">Крок надіслано на ваш Telegram для перегляду.</div>}
      <form action={saveStep} className="editor" id="stepform">
        <input type="hidden" name="id" value={step.id} /><input type="hidden" name="funnelId" value={f.id} />
        <div className="form">
          <div className="card form">
            <div className="form two">
              <label className="field">Назва кроку (для себе; для уроків може показуватись у повідомленні)<input name="title" defaultValue={step.title ?? ""} maxLength={120} /></label>
              <label className="field">Модуль<select name="moduleId" defaultValue={step.moduleId ?? ""}><option value="">Без модуля</option>{modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
            </div>
            <div className="field">Текст<StepText name="body" defaultValue={step.body ?? ""} /></div>
          </div>
          <div className="card"><h3>Вкладення <span className="sub">фото, відео, кружечок, голосове, файл, GIF, стікер</span></h3><AttachmentsPicker media={media} initial={c.attachments ?? []} /></div>
          <div className="card"><h3>{isOptions ? "Варіанти відповіді" : "Кнопки"}</h3>
            <ButtonsEditor initial={c.buttons ?? []} steps={steps.map((s) => ({ id: s.id, title: s.title, position: s.position }))} funnels={allFunnels.filter((x) => x.id !== f.id)} offers={offers} stepType={step.type} />
            {step.type === "quiz" && <div className="form two" style={{ marginTop: 12 }}><label className="field">Відповідь при правильному варіанті<input name="correctText" defaultValue={c.correctText ?? ""} placeholder="✅ Правильно!" /></label><label className="field">Відповідь при неправильному<input name="wrongText" defaultValue={c.wrongText ?? ""} placeholder="❌ Не зовсім." /></label></div>}
            {(step.type === "question" || step.type === "survey" || step.type === "assignment") && <label className="field" style={{ marginTop: 12 }}>Зберігати відповідь у поле картки людини (назва поля; порожньо = лише в історію)<input name="saveTo" defaultValue={c.saveTo ?? ""} placeholder={step.type === "assignment" ? "homework_1" : "goal"} /></label>}
            {step.type === "assignment" && <p className="note">Завдання чекає текстову відповідь. Наступний крок надсилається за своїм розкладом незалежно від відповіді; відповідь видно в картці людини та в історії.</p>}
          </div>
        </div>
        <div className="form">
          <div className="card form"><h3>Налаштування</h3>
            <SendTimeFields initial={c.sendTime ?? { mode: "immediately" }} />
            <AutoDeleteFields initial={c.autodelete ?? { mode: "never" }} />
            <label className="ck"><input type="checkbox" name="protect" defaultChecked={Boolean(c.protect)} /> Захист контенту {fs.contentProtection && <span className="muted">(увімкнено для всієї воронки)</span>}</label>
            <label className="ck"><input type="checkbox" name="preview" defaultChecked={Boolean(c.preview)} /> Показувати прев’ю посилань</label>
            <label className="ck"><input type="checkbox" name="quietHours" defaultChecked={c.quietHours !== false} /> Не надсилати 22:00–09:00 (відкладені кроки)</label>
            <label className="field">Тег за отримання кроку<input name="tag" defaultValue={c.tag ?? ""} placeholder={`порожньо = fn:…:s${idx + 1}`} /></label>
            <label className="field">Статус<select name="status" defaultValue={step.isActive ? "active" : "stopped"}><option value="active">Активний</option><option value="stopped">Зупинений: пропускається</option></select></label>
          </div>
          <div className="card form">
            <div className="row-actions"><button className="btn pri" type="submit">Зберегти</button><button className="btn" type="submit" name="after" value="preview" title="Зберегти й надіслати цей крок на ваш Telegram">👁 Перегляд</button><button className="btn ghost" type="submit" name="after" value="close">Зберегти й закрити</button></div>
            <ConfirmSubmit className="btn sm danger ghost" formAction={deleteStep} name="back" value="1" message="Видалити цей крок?">Видалити крок</ConfirmSubmit>
          </div>
          <div className="card steps-side"><h3>Кроки <span className="sub">{steps.length}</span></h3>
            {steps.map((s, i) => <Link key={s.id} href={`/funnels/${f.id}/steps/${s.id}`} className={`${s.id === step.id ? "on" : ""} ${s.isActive ? "" : "off"}`}><span className={`steptype ${s.type}`}>{STEP_ICON[s.type]}</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i + 1}. {s.title || s.type}</span><small>{sendTimeLabel((s.config ?? {}) as StepConfig)}</small></Link>)}
          </div>
        </div>
      </form>
      <form action={addStep} className="card" style={{ marginTop: 16 }}><input type="hidden" name="funnelId" value={f.id} /><input type="hidden" name="moduleId" value={step.moduleId ?? ""} /><h3>Додати крок</h3><div className="types">{STEP_TYPES.map((t) => <button key={t.key} type="submit" name="type" value={t.key}><b>{STEP_ICON[t.key]} {t.label}</b><small>{t.hint}</small></button>)}</div></form>
    </Shell>
  );
}
