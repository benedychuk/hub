import { CreditCard, Link2 } from "lucide-react";
import { Pill } from "@/components/ui";
import { Section, Field, FormRow, KV, Alert, Row } from "@/components/ui/layout";
import { RadioCards, Switch } from "@/components/ui/controls";
import { CopyBox } from "./copy-box";
import { paymentSettings } from "@/lib/payments";
import { liveConfigured, TEST_MERCHANT } from "@/lib/wayforpay";
import { savePaymentSettings, makeTestPayLink, planKeys } from "@/lib/actions";
import { appUrl } from "@/lib/bot";
import { hasDb } from "@/db";

export default async function PaymentsTab({ link }: { link?: string }) {
  if (!hasDb()) return <Alert tone="warn">Підключіть базу даних.</Alert>;
  const [st, plansL] = await Promise.all([paymentSettings(), planKeys()]);
  const live = liveConfigured();
  return (
    <div className="grid g21">
      <div className="form">
        <form action={savePaymentSettings}>
          <Section title="Режим оплат" description="Тестовий режим використовує тестового мерчанта WayForPay: гроші не списуються. Бойовий режим працює з ключами mkravchuk_com із змінних оточення.">
            <RadioCards name="mode" defaultValue={st.mode} cols={2} options={[{ value: "test", label: "Тестовий", hint: `мерчант ${TEST_MERCHANT.account}`, icon: <CreditCard size={18} /> }, { value: "live", label: "Бойовий", hint: live ? `мерчант ${process.env.WFP_MERCHANT}` : "ключі WFP_MERCHANT і WFP_SECRET не задані", icon: <CreditCard size={18} /> }]} />
            <FormRow cols={3} >
              <Field label="Нагадувати про списання за, днів"><input name="reminderDays" type="number" min={1} defaultValue={st.reminderDays} /></Field>
              <Field label="Запрошувати на переїзд за, днів" hint="до дати списання в ZenEdu"><input name="migrationDays" type="number" min={1} defaultValue={st.migrationDays} /></Field>
              <Field label="Перевірочна сума картки, грн" hint="списується й повертається"><input name="verifyAmount" type="number" min={1} defaultValue={st.verifyAmount} /></Field>
            </FormRow>
            <div style={{ marginTop: 14 }}><Switch name="enabled" defaultChecked={st.enabled} label="Оплати увімкнено для учасниць" hint="поки вимкнено, кнопки оплати в боті бачите лише ви, а посилання працюють лише для вашого акаунта" /></div>
            <div><Switch name="migrationAuto" defaultChecked={st.migrationAuto} label="Автоматичні запрошення на переїзд" hint="поки вимкнено, Hub нікому з учасниць не пише сам; запросити окрему людину можна вручну на сторінці «Міграція»" /></div>
            {!st.enabled && <Alert tone="info">Режим тестування: жодна учасниця клубу не побачить оплату і не отримає повідомлень про підписку, поки ви не увімкнете «Оплати увімкнено для учасниць».</Alert>}
            {st.migrationAuto && <Alert tone="warn">Увімкнено: щодня Hub пише активним у ZenEdu, які запустили Hub-бот і в яких списання за {st.migrationDays} дн.</Alert>}
            <div className="row-actions" style={{ marginTop: 14 }}><button className="btn pri" type="submit">Зберегти</button></div>
          </Section>
        </form>
        <form action={makeTestPayLink}>
          <Section title="Перевірити оплату" description="Створює посилання на оплату для вашого акаунта (ADMIN_TELEGRAM_ID), як його бачить учасниця.">
            <FormRow><Field label="Оффер"><select name="planKey">{plansL.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select></Field><Field label="Сценарій"><select name="kind" defaultValue="first"><option value="first">Перша оплата тарифу</option><option value="card">Зміна картки (перевірочна сума)</option><option value="migrate">Переїзд із ZenEdu</option></select></Field></FormRow>
            <div className="row-actions" style={{ marginTop: 14 }}><button className="btn" type="submit" disabled={!plansL.length}><Link2 size={15} /> Створити посилання</button>{!plansL.length && <span className="fld-h">спершу створіть активний тариф</span>}</div>
            {link && <div style={{ marginTop: 12 }}><CopyBox text={link} /></div>}
          </Section>
        </form>
      </div>
      <div className="form aside-sticky">
        <Section title="Стан підключення">
          <Row tone={live ? "on" : "off"} title="Ключі WayForPay" sub={live ? "WFP_MERCHANT і WFP_SECRET задані" : "додайте змінні у Vercel і зробіть Redeploy"} right={<Pill tone={live ? "good" : "mute"}>{live ? "є" : "немає"}</Pill>} />
          <Row tone={process.env.WFP_REGULAR_PASSWORD ? "on" : "warn"} title="Пароль регулярних платежів" sub="потрібен лише для керування графіками на боці WayForPay" right={<Pill tone={process.env.WFP_REGULAR_PASSWORD ? "good" : "mute"}>{process.env.WFP_REGULAR_PASSWORD ? "є" : "немає"}</Pill>} />
          <Row title="Зараз активний" sub={st.mode === "live" ? "бойовий мерчант" : "тестовий мерчант"} right={<Pill tone={st.mode === "live" ? "good" : "moon"}>{st.mode}</Pill>} />
        </Section>
        <Section title="Адреси для WayForPay" description="Hub передає їх у кожному запиті, у кабінеті нічого вказувати не треба.">
          <KV items={[{ k: "Service URL", v: `${appUrl()}/api/payments/wayforpay`, mono: true }, { k: "Return URL", v: `${appUrl()}/pay/done`, mono: true }]} />
        </Section>
        <Section title="Як працює списання">
          <p className="fld-h" style={{ margin: 0 }}>Перший платіж на сторінці WayForPay зберігає токен картки. Далі Hub сам списує о 10:00 за Києвом у день закінчення періоду. Якщо не вдалось: повтори через 1, 3 і 5 днів із повідомленнями в боті, після третьої невдачі доступ закривається, людина може оновити картку за посиланням і повернутись.</p>
        </Section>
      </div>
    </div>
  );
}
