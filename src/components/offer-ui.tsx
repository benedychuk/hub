"use client";
import { useState } from "react";
import { DollarSign, Repeat, Package, Link2, Ban } from "lucide-react";
import { Field, FormRow } from "@/components/ui/layout";
import { RadioCards } from "@/components/ui/controls";

type Init = { paymentType: string; price: string; currency: string; period: string; intervalCount: number; trialDays: number; trialPrice: string | null; accessMode: string; accessDays: number | null; accessUntil: string | null };

/** Вкладка «Основне» оффера: тип оплати перемикає інтервал і пробний період (підписка) або тривалість доступу (разова оплата). */
export function OfferPaymentFields({ initial }: { initial: Init }) {
  const [type, setType] = useState(initial.paymentType === "one_time" ? "one_time" : "subscription");
  const [trial, setTrial] = useState(initial.trialDays > 0);
  const [access, setAccess] = useState(initial.accessMode || "forever");
  return (
    <div className="form">
      <RadioCards name="paymentType" defaultValue={type} cols={2} onChange={setType} options={[
        { value: "one_time", label: "Разова оплата", hint: "один платіж, доступ на визначений строк", icon: <DollarSign size={18} /> },
        { value: "subscription", label: "Підписка", hint: "автосписання за інтервалом, поки не скасують", icon: <Repeat size={18} /> },
      ]} />
      <FormRow cols={2}>
        <Field label="Ціна"><input name="price" type="number" step="0.01" min={0} defaultValue={initial.price} required /></Field>
        <Field label="Валюта"><select name="currency" defaultValue={initial.currency}><option>UAH</option><option>USD</option><option>EUR</option></select></Field>
      </FormRow>
      {type === "subscription" && <>
        <FormRow cols={2}>
          <Field label="Інтервал списання" hint="кожні N одиниць"><input name="intervalCount" type="number" min={1} defaultValue={initial.intervalCount || 1} /></Field>
          <Field label="Одиниця"><select name="period" defaultValue={initial.period || "month"}><option value="day">день</option><option value="week">тиждень</option><option value="month">місяць</option><option value="quarter">квартал</option><option value="year">рік</option></select></Field>
        </FormRow>
        <Field label="Пробний період" hint="Перший інтервал за іншою ціною, далі повна.">
          <select value={trial ? "on" : ""} onChange={(e) => setTrial(e.target.value === "on")}><option value="">Немає</option><option value="on">Платний пробний період</option></select>
        </Field>
        {trial && <input type="hidden" name="trial" value="on" />}
        {trial && <FormRow cols={2}>
          <Field label="Пробний період, днів"><input name="trialDays" type="number" min={1} defaultValue={initial.trialDays || 7} /></Field>
          <Field label="Ціна пробного періоду"><input name="trialPrice" type="number" step="0.01" min={0} defaultValue={initial.trialPrice ?? "1"} /></Field>
        </FormRow>}
      </>}
      {type === "one_time" && <>
        <Field label="Тривалість доступу" hint="Скільки діє доступ до продуктів і каналів після оплати.">
          <select name="accessMode" value={access} onChange={(e) => setAccess(e.target.value)}>
            <option value="forever">Безстроково</option><option value="days">N днів після оплати</option><option value="until">До конкретної дати</option><option value="none">Без доступу (лише оплата)</option>
          </select>
        </Field>
        {access === "days" && <Field label="Днів доступу"><input name="accessDays" type="number" min={1} defaultValue={initial.accessDays ?? 30} /></Field>}
        {access === "until" && <Field label="Доступ до дати"><input name="accessUntil" type="date" defaultValue={initial.accessUntil ?? ""} /></Field>}
      </>}
    </div>
  );
}

/** Модальне вікно «Новий продукт»: як у ZenEdu — назва, формат, потім оффер (новий / наявний / пізніше). */
export function ProductCreateFields({ offers, folders, defaultFolder }: { offers: { id: number; name: string }[]; folders: { id: number; name: string }[]; defaultFolder?: number | null }) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState("new");
  return (
    <div className="form">
      <div style={{ display: step === 1 ? "block" : "none" }} className="form">
        <Field label="Назва"><input name="name" placeholder="Наприклад, Курс про гроші" required maxLength={120} /></Field>
        <Field label="Формат"><div className="rcards c2"><label className="rcard on"><span className="rcard-i"><Package size={18} /></span><span className="rcard-t"><b>У боті</b><small>кроки приходять у Hub-бот</small></span></label><label className="rcard" aria-disabled="true"><span className="rcard-i"><Ban size={18} /></span><span className="rcard-t"><b>У порталі</b><small>у Hub немає веб-порталу</small></span></label></div></Field>
        {folders.length > 0 && <Field label="Папка"><select name="folderId" defaultValue={defaultFolder ?? ""}><option value="">Без папки</option>{folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>}
        <div className="modal-f"><button type="button" className="btn pri" onClick={() => setStep(2)}>Далі</button></div>
      </div>
      <div style={{ display: step === 2 ? "block" : "none" }} className="form">
        <RadioCards name="offerMode" defaultValue={mode} cols={3} onChange={setMode} options={[
          { value: "new", label: "Новий оффер", hint: "ціна й тип оплати зараз", icon: <DollarSign size={18} /> },
          { value: "existing", label: "Наявний оффер", hint: "додати продукт до оффера", icon: <Link2 size={18} /> },
          { value: "none", label: "Пізніше", hint: "лише продукт", icon: <Package size={18} /> },
        ]} />
        {mode === "new" && <>
          <Field label="Тип оплати"><select name="paymentType" defaultValue="one_time"><option value="one_time">Разова оплата</option><option value="subscription">Підписка</option></select></Field>
          <FormRow cols={2}><Field label="Ціна"><input name="price" type="number" step="0.01" min={0} defaultValue="0" /></Field><Field label="Валюта"><select name="currency" defaultValue="UAH"><option>UAH</option><option>USD</option><option>EUR</option></select></Field></FormRow>
        </>}
        {mode === "existing" && <Field label="Оффер">{offers.length ? <select name="offerId">{offers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select> : <p className="fld-h">Офферів ще немає: оберіть «Новий оффер».</p>}</Field>}
        <div className="modal-f"><button type="button" className="btn ghost" onClick={() => setStep(1)}>Назад</button><button className="btn pri" type="submit">Створити</button></div>
      </div>
    </div>
  );
}
