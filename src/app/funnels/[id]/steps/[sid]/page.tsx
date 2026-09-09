import Link from "next/link";
import { notFound } from "next/navigation";
import { Eye, Trash2, Save } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { PageHeader, Section, Field, FormRow, Alert } from "@/components/ui/layout";
import { Switch } from "@/components/ui/controls";
import { ConfirmSubmit, StepText, AttachmentsPicker, ButtonsEditor, SendTimeFields, AutoDeleteFields } from "@/components/funnel-ui";
import { StepIcon } from "@/components/step-icon";
import { navCounts, stepDetail } from "@/lib/queries";
import { saveStep, deleteStep, addStep } from "@/lib/actions";
import { STEP_TYPES, sendTimeLabel, type StepConfig, type FunnelSettings } from "@/lib/funnels";

export const dynamic = "force-dynamic";
const VARS = [{ key: "first_name", label: "ім’я" }, { key: "name", label: "ім’я та прізвище" }, { key: "username", label: "@username" }];

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
      <PageHeader back={`/funnels/${f.id}`} backLabel={f.name} icon={<StepIcon type={step.type} size={32} />} title={`Крок ${idx + 1}: ${step.title || type.label}`} status={<><Pill tone="moon">{type.label}</Pill><Pill tone={step.isActive ? "good" : "mute"}>{step.isActive ? "активний" : "зупинений"}</Pill></>} />
      {sp.saved && <Alert tone="ok">Крок збережено.</Alert>}
      {sp.sent && <Alert tone="ok">Крок надіслано на ваш Telegram для перегляду.</Alert>}
      <form action={saveStep} className="editor">
        <input type="hidden" name="id" value={step.id} /><input type="hidden" name="funnelId" value={f.id} />
        <div className="form">
          <Section title="Повідомлення">
            <FormRow><Field label="Назва кроку" hint="Для себе; для уроків може показуватись у повідомленні."><input name="title" defaultValue={step.title ?? ""} maxLength={120} /></Field><Field label="Модуль"><select name="moduleId" defaultValue={step.moduleId ?? ""}><option value="">Без модуля</option>{modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field></FormRow>
            <Field label="Текст"><StepText name="body" defaultValue={step.body ?? ""} variables={VARS} /></Field>
          </Section>
          <Section title="Вкладення" description="Фото, відео, кружечок, голосове, файл, GIF або стікер із Бібліотеки."><AttachmentsPicker media={media} initial={c.attachments ?? []} /></Section>
          <Section title={isOptions ? "Варіанти відповіді" : "Кнопки"}>
            <ButtonsEditor initial={c.buttons ?? []} steps={steps.map((s) => ({ id: s.id, title: s.title, position: s.position }))} funnels={allFunnels.filter((x) => x.id !== f.id)} offers={offers} stepType={step.type} />
            {step.type === "quiz" && <FormRow><Field label="Відповідь при правильному варіанті"><input name="correctText" defaultValue={c.correctText ?? ""} placeholder="Правильно!" /></Field><Field label="Відповідь при неправильному"><input name="wrongText" defaultValue={c.wrongText ?? ""} placeholder="Не зовсім." /></Field></FormRow>}
            {(step.type === "question" || step.type === "survey" || step.type === "assignment") && <Field label="Зберігати відповідь у поле картки людини" hint="назва поля; порожньо = лише в історію"><input name="saveTo" defaultValue={c.saveTo ?? ""} placeholder={step.type === "assignment" ? "homework_1" : "goal"} /></Field>}
            {step.type === "assignment" && <p className="fld-h">Завдання чекає текстову відповідь. Наступний крок іде за своїм розкладом незалежно від відповіді.</p>}
          </Section>
        </div>
        <div className="form">
          <Section title="Надсилання">
            <SendTimeFields initial={c.sendTime ?? { mode: "immediately" }} />
            <div style={{ marginTop: 12 }}><AutoDeleteFields initial={c.autodelete ?? { mode: "never" }} /></div>
          </Section>
          <Section title="Налаштування">
            <Switch name="protect" defaultChecked={Boolean(c.protect)} label="Захист контенту" hint={fs.contentProtection ? "увімкнено для всієї воронки" : "без пересилання й збереження"} />
            <Switch name="preview" defaultChecked={Boolean(c.preview)} label="Прев’ю посилань" />
            <Switch name="quietHours" defaultChecked={c.quietHours !== false} label="Тихі години" hint="не надсилати 22:00–09:00" />
            <Field label="Тег за отримання кроку" hint={`порожньо = автотег fn:…:s${idx + 1}`}><input name="tag" defaultValue={c.tag ?? ""} /></Field>
            <Field label="Статус"><select name="status" defaultValue={step.isActive ? "active" : "stopped"}><option value="active">Активний</option><option value="stopped">Зупинений: пропускається</option></select></Field>
          </Section>
          <Section>
            <div className="form"><button className="btn pri" type="submit"><Save size={15} /> Зберегти</button><button className="btn" type="submit" name="after" value="preview" title="Зберегти й надіслати цей крок на ваш Telegram"><Eye size={15} /> Зберегти й переглянути</button><button className="btn ghost" type="submit" name="after" value="close">Зберегти й закрити</button></div>
            <div style={{ marginTop: 10 }}><ConfirmSubmit className="btn sm danger ghost" formAction={deleteStep} name="back" value="1" message="Видалити цей крок?"><Trash2 size={14} /> Видалити крок</ConfirmSubmit></div>
          </Section>
          <Section title="Кроки" description={`${steps.length} у воронці`} className="steps-side">
            {steps.map((s, i) => <Link key={s.id} href={`/funnels/${f.id}/steps/${s.id}`} className={`${s.id === step.id ? "on" : ""} ${s.isActive ? "" : "off"}`}><StepIcon type={s.type} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i + 1}. {s.title || s.type}</span><small>{sendTimeLabel((s.config ?? {}) as StepConfig)}</small></Link>)}
          </Section>
        </div>
      </form>
      <form action={addStep} style={{ marginTop: 16 }}><input type="hidden" name="funnelId" value={f.id} /><input type="hidden" name="moduleId" value={step.moduleId ?? ""} /><Section title="Додати наступний крок"><div className="types">{STEP_TYPES.map((t) => <button key={t.key} type="submit" name="type" value={t.key}><b><StepIcon type={t.key} /> {t.label}</b><small>{t.hint}</small></button>)}</div></Section></form>
    </Shell>
  );
}
