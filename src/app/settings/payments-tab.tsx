import { CreditCard, Link2 } from "lucide-react";
import { Pill } from "@/components/ui";
import { Section, Field, FormRow, Alert, Row } from "@/components/ui/layout";
import { RadioCards, Switch } from "@/components/ui/controls";
import { CopyBox } from "./copy-box";
import { CopyField } from "@/components/ui/copy-field";
import { paymentSettings } from "@/lib/payments";
import { liveConfigured, TEST_MERCHANT } from "@/lib/wayforpay";
import { monoConfigured } from "@/lib/monobank";
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
          <Section title="Режим оплат" description="Тестовий режим: гроші не списуються (тестовий мерчант WayForPay, тестовий токен monobank MONO_TEST_TOKEN). Бойовий режим: справжні оплати з ключами зі змінних оточення (WayForPay — WFP_MERCHANT і WFP_SECRET, monobank — MONO_TOKEN).">
            <RadioCards name="mode" defaultValue={st.mode} cols={2} options={[{ value: "test", label: "Тестовий", hint: `мерчант ${TEST_MERCHANT.account}`, icon: <CreditCard size={18} /> }, { value: "live", label: "Бойовий", hint: live ? `мерчант ${process.env.WFP_MERCHANT}` : "ключі WFP_MERCHANT і WFP_SECRET не задані", icon: <CreditCard size={18} /> }]} />
            <div style={{ marginTop: 14 }}><Field label="Шлюз для нових оплат" hint="Автосписання підписок завжди йдуть тим шлюзом, яким людина оплатила вперше: поточні підписки WayForPay списуються там і далі.">
              <RadioCards name="provider" defaultValue={st.provider} cols={3} options={[
                { value: "wayforpay", label: "WayForPay", hint: "як зараз" },
                { value: "monobank_testers", label: "monobank для тестувальників", hint: monoConfigured(st.mode) ? "адміністратор і тестувальники платять через monobank, решта — WayForPay" : `немає ${st.mode === "live" ? "MONO_TOKEN" : "MONO_TEST_TOKEN"}` },
                { value: "monobank", label: "monobank для всіх", hint: monoConfigured(st.mode) ? "усі нові оплати — через monobank" : `немає ${st.mode === "live" ? "MONO_TOKEN" : "MONO_TEST_TOKEN"}` },
              ]} />
            </Field></div>
            {st.provider !== "wayforpay" && !monoConfigured(st.mode) && <Alert tone="warn">Для режиму «{st.mode === "live" ? "Бойовий" : "Тестовий"}» немає токена monobank ({st.mode === "live" ? "MONO_TOKEN" : "MONO_TEST_TOKEN"}), тому оплати йдуть через WayForPay.</Alert>}
            <FormRow cols={3} >
              <Field label="Нагадувати про списання за, днів"><input name="reminderDays" type="number" min={1} defaultValue={st.reminderDays} /></Field>
              <Field label="Запрошувати на переїзд за, днів" hint="до дати списання в ZenEdu"><input name="migrationDays" type="number" min={1} defaultValue={st.migrationDays} /></Field>
              <Field label="Перевірочна сума картки, грн" hint="списується й повертається"><input name="verifyAmount" type="number" min={1} defaultValue={st.verifyAmount} /></Field>
            </FormRow>
            <FormRow cols={3} >
              <Field label="Доступ після кінця періоду, годин" hint="Скільки годин після кінця оплаченого періоду людина ще має доступ до каналів, «Щиро» і кабінету, якщо підписку скасовано або списання не пройшло. Потім усе закривається; після оплати повертається само. Пауза закриває одразу."><input name="graceHours" type="number" min={0} max={720} defaultValue={st.graceHours} /></Field>
            </FormRow>
            <div style={{ marginTop: 14 }}><Switch name="newPeople" defaultChecked={st.newPeople} label="Оплати для нових людей" hint="оплату в боті бачать ті, у кого немає чинної підписки в ZenEdu; нинішні учасниці ZenEdu продовжують платити там і другої підписки не отримають" /></div>
            <div><Switch name="enabled" defaultChecked={st.enabled} label="Оплати увімкнено для учасниць" hint="оплату бачать усі, зокрема учасниці з підпискою в ZenEdu: вмикайте, лише якщо вони переходять у Hub, інакше гроші спишуться двічі" /></div>
            <div><Switch name="migrationAuto" defaultChecked={st.migrationAuto} label="Автоматичні запрошення на переїзд" hint="поки вимкнено, Hub нікому з учасниць не пише сам; запросити окрему людину можна вручну на сторінці «Міграція»" /></div>
            <Field label="Тестувальники: Telegram ID через кому" hint="Бачать кнопки оплати й оффери в боті, поки оплати вимкнені для учасниць. Свій ID можна дізнатись у боті @userinfobot."><input name="testers" defaultValue={st.testers.join(", ")} placeholder="123456789, 987654321" /></Field>
            {!st.enabled && !st.newPeople && <Alert tone="info">Режим тестування: оплату в боті бачите лише ви й тестувальники. Щоб нові люди могли оплачувати через Hub, увімкніть «Оплати для нових людей».</Alert>}
            {!st.enabled && st.newPeople && <Alert tone="ok">Нові люди оплачують через Hub. Учасниці з чинною підпискою в ZenEdu оплату в боті не бачать і далі платять у ZenEdu.</Alert>}
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
          <Row tone={monoConfigured("live") ? "on" : "off"} title="monobank: бойовий токен" sub={monoConfigured("live") ? "MONO_TOKEN заданий" : "MONO_TOKEN з бізнес-кабінету web.monobank.ua"} right={<Pill tone={monoConfigured("live") ? "good" : "mute"}>{monoConfigured("live") ? "є" : "немає"}</Pill>} />
          <Row tone={monoConfigured("test") ? "on" : "off"} title="monobank: тестовий токен" sub={monoConfigured("test") ? "MONO_TEST_TOKEN заданий" : "MONO_TEST_TOKEN з api.monobank.ua (гроші не списуються)"} right={<Pill tone={monoConfigured("test") ? "good" : "mute"}>{monoConfigured("test") ? "є" : "немає"}</Pill>} />
          <Row title="Шлюз для нових оплат" sub={st.provider === "wayforpay" ? "WayForPay" : st.provider === "monobank" ? "monobank для всіх" : "monobank для тестувальників"} right={<Pill tone={st.provider === "wayforpay" ? "moon" : "good"}>{st.provider === "wayforpay" ? "WFP" : "mono"}</Pill>} />
          <Row title="Зараз активний" sub={st.mode === "live" ? "бойовий мерчант" : "тестовий мерчант"} right={<Pill tone={st.mode === "live" ? "good" : "moon"}>{st.mode}</Pill>} />
        </Section>
        <Section title="Адреси для WayForPay" description="Hub передає їх у кожному запиті, у кабінеті нічого вказувати не треба.">
          <Field label="Service URL"><CopyField value={`${appUrl()}/api/payments/wayforpay`} compact ariaLabel="Service URL" /></Field>
          <Field label="Return URL"><CopyField value={`${appUrl()}/pay/done`} compact ariaLabel="Return URL" /></Field>
        </Section>
        <Section title="Адреса для monobank" description="Hub передає її в кожному рахунку сам, у кабінеті monobank нічого вказувати не треба.">
          <Field label="Webhook URL"><CopyField value={`${appUrl()}/api/payments/monobank`} compact ariaLabel="Webhook URL monobank" /></Field>
        </Section>
        <Section title="Як працює списання">
          <p className="fld-h" style={{ margin: 0 }}>Перший платіж на сторінці WayForPay зберігає токен картки. Далі Hub сам списує о 10:00 за Києвом у день закінчення періоду. Якщо не вдалось: повтори через 1, 3 і 5 днів із повідомленнями в боті. Доступ до каналів, «Щиро» і кабінету закривається через вказану кількість годин після кінця оплаченого періоду; успішне списання або оновлення картки повертає його автоматично.</p>
        </Section>
      </div>
    </div>
  );
}
