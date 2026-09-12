import Link from "next/link";
import { notFound } from "next/navigation";
import { Eye, Play, Pause, Copy, Trash2, Tag, Plus, Link2, Bot, Users } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { PageHeader, Section, Field, FormRow, Alert, KV, Stat, Row, EmptyState } from "@/components/ui/layout";
import { Kebab, MenuAction, MenuLink, MenuSep, Switch, Checkbox, AutoSubmitToggleClient } from "@/components/ui/controls";
import { Modal } from "@/components/modal";
import { CoverInput, StepText } from "@/components/funnel-ui";
import { OfferPaymentFields } from "@/components/offer-ui";
import { navCounts, offerDetail, productPicker, resourceList, botList } from "@/lib/queries";
import { saveOffer, setOfferStatus, duplicateOffer, deleteOffer, createAccessLink, toggleAccessLink, deleteAccessLink } from "@/lib/actions";
import { priceLabel, accessLabel, intervalLabel } from "@/lib/offers";
import { money, date, dateTime, fullName } from "@/lib/format";
import { appUrl } from "@/lib/bot";

export const dynamic = "force-dynamic";
const TABS = [["general", "Основне"], ["design", "Дизайн"], ["settings", "Налаштування"], ["links", "Посилання"]] as const;
const KIND_LABEL: Record<string, string> = { telegram_channel: "канал", telegram_group: "група", bot_feature: "функція бота", external_url: "посилання", course: "курс" };
const toDateInput = (d: Date | null | undefined) => d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : "";
const toDateTimeInput = (d: Date | null | undefined) => d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";

/** Редактор оффера: вкладки як у ZenEdu (General / Design / Settings) плюс «Посилання» (оплата в боті, доступ без оплати). */
export default async function OfferEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; saved?: string }> }) {
  const { id } = await params; const sp = await searchParams;
  const isNew = id === "new";
  const [counts, d, prods, res, bl] = await Promise.all([navCounts(), isNew ? Promise.resolve(null) : offerDetail(Number(id)), productPicker(), resourceList(), botList()]);
  if (!isNew && !d) notFound();
  const pl = d?.pl ?? null; const design = pl?.design ?? {}; const st = pl?.settings ?? {};
  const tab = isNew ? "general" : TABS.some((t) => t[0] === sp.tab) ? sp.tab! : "general";
  const botUser = bl.find((b) => b.key === "hub")?.username ?? null;
  const ents = pl?.entitlements ?? {}; const products = pl?.products ?? [];
  const isChat = (k: string) => k === "telegram_channel" || k === "telegram_group";
  const initial = { paymentType: pl?.paymentType ?? "one_time", price: pl?.price ?? "0", currency: pl?.currency ?? "UAH", period: pl?.period ?? "month", intervalCount: pl?.intervalCount ?? 1, trialDays: pl?.trialDays ?? 0, trialPrice: pl?.trialPrice ?? null, accessMode: pl?.accessMode ?? "forever", accessDays: pl?.accessDays ?? null, accessUntil: toDateInput(pl?.accessUntil) || null };
  return (
    <Shell title="Оффери" counts={counts}>
      <PageHeader back="/offers" backLabel="Оффери" icon={<Tag size={16} />} title={isNew ? "Новий оффер" : pl!.name}
        status={pl ? <Pill tone={pl.isActive ? "good" : "mute"}>{pl.isActive ? "активний" : "зупинений"}</Pill> : undefined}
        actions={pl ? <>
          <a className="btn sm" href={`/pay/${encodeURIComponent(pl.key)}?preview=1`} target="_blank" rel="noreferrer"><Eye size={15} /> Перегляд</a>
          <form action={setOfferStatus}><input type="hidden" name="id" value={pl.id} /><input type="hidden" name="status" value={pl.isActive ? "stopped" : "active"} /><button className={`btn sm ${pl.isActive ? "" : "pri"}`} type="submit">{pl.isActive ? <><Pause size={15} /> Зупинити</> : <><Play size={15} /> Активувати</>}</button></form>
          <Kebab>
            <MenuLink href={`/offers/${pl.id}?tab=links`} icon={<Link2 />}>Посилання</MenuLink>
            <MenuAction action={duplicateOffer} fields={{ id: pl.id }} icon={<Copy />}>Дублювати</MenuAction>
            <MenuSep />
            <MenuAction action={deleteOffer} fields={{ id: pl.id }} icon={<Trash2 />} danger confirm={`Видалити оффер «${pl.name}»?`}>Видалити оффер</MenuAction>
          </Kebab>
        </> : undefined} />
      {sp.saved && <Alert tone="ok">Збережено.</Alert>}
      {pl && !pl.isActive && <Alert tone="warn">Оффер зупинено: купити його не можна, посилання доступу не працюють. Чинні підписки не змінюються.</Alert>}
      {pl && pl.isActive && !products.length && !Object.keys(ents).length && <Alert tone="info">Оффер нічого не дає: додайте цифровий продукт або канал у розділі «Що дає оффер».</Alert>}
      {!isNew && <div className="tabs">{TABS.map(([k, l]) => <Link key={k} href={`/offers/${pl!.id}?tab=${k}`} className={tab === k ? "on" : ""}>{l}{k === "links" ? ` · ${d!.links.length}` : ""}</Link>)}</div>}

      {tab === "general" && <form action={saveOffer} className="grid g21"><input type="hidden" name="part" value="general" />{pl && <input type="hidden" name="id" value={pl.id} />}
        <div className="form">
          <Section title="Основне">
            <Field label="Назва" hint={pl ? `Внутрішній код: ${pl.key}` : "Код для API і звітів створиться сам."}><input name="name" defaultValue={pl?.name ?? ""} required maxLength={120} placeholder="Наприклад, Клуб · місяць" /></Field>
          </Section>
          <Section title="Що дає оффер" description="Цифрові продукти приходять у Hub-бот; канали й групи підключаються, коли для них увімкнено автоматику доступу.">
            <p className="sec-t" style={{ margin: "0 0 6px" }}>Цифрові продукти</p>
            {prods.length ? prods.map((p) => <div key={p.id} className="row-actions" style={{ justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line)" }}><Checkbox name="products" value={String(p.id)} defaultChecked={products.includes(p.id)} label={<>{p.name}{!p.isActive && <Pill tone="mute">не активний</Pill>}</>} /><Link href={`/products/${p.id}`} className="lnk">відкрити</Link></div>)
              : <p className="fld-h">Продуктів ще немає: <Link href="/products">створіть перший</Link>.</p>}
            <p className="sec-t" style={{ margin: "14px 0 6px" }}>Канали, групи, функції бота</p>
            {res.length ? res.map((r) => <div key={r.key} className="row-actions" style={{ justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line)" }}><Checkbox name={`ent:${r.key}`} defaultChecked={ents[r.key] !== undefined} label={r.name} hint={KIND_LABEL[r.kind] ?? r.kind} />{!isChat(r.kind) && <input name={`quota:${r.key}`} defaultValue={ents[r.key] ?? ""} placeholder="квота, напр. 40/день" className="input" style={{ width: 180 }} aria-label={`Квота для ${r.name}`} />}</div>)
              : <p className="fld-h">Каналів ще немає: підключіть у розділі <Link href="/resources">Канали і групи</Link>.</p>}
          </Section>
          <Section title="Оплата"><OfferPaymentFields initial={initial} /></Section>
        </div>
        <div className="form aside-sticky">
          <Section title="Статус і показ">
            <Field label="Статус"><select name="status" defaultValue={pl ? (pl.isActive ? "active" : "stopped") : "active"}><option value="active">Активний</option><option value="stopped">Зупинений</option></select></Field>
            <Switch name="showInBot" defaultChecked={pl?.showInBot ?? true} label="Показувати в боті за /plans" hint="інакше лише за посиланнями й кнопками" />
            <Switch name="isFeatured" defaultChecked={pl?.isFeatured ?? false} label="Рекомендований" hint="виділяється в списку" />
            <Field label="Порядок показу"><input name="sortOrder" type="number" defaultValue={pl?.sortOrder ?? 0} /></Field>
          </Section>
          {pl && <Section title="Продажі">
            <div className="grid g2"><Stat label="Оплат" value={d!.payments} hint={`${d!.grants} без оплати`} /><Stat label="Дохід" value={money(d!.revenue, pl.currency)} hint={`активних ${d!.active}`} /></div>
          </Section>}
          <Section><div className="form"><button className="btn pri" type="submit">{isNew ? "Створити оффер" : "Зберегти"}</button><Link href="/offers" className="btn ghost">Скасувати</Link></div>
            <p className="fld-h" style={{ marginTop: 10 }}>Зміна ціни й складу не торкається чинних підписок: у кожної своя ціна, доступ звіряється з оффером щохвилини.</p></Section>
        </div>
      </form>}

      {tab === "design" && pl && <form action={saveOffer} className="grid g21"><input type="hidden" name="part" value="design" /><input type="hidden" name="id" value={pl.id} />
        <div className="form">
          <Section title="Сторінка оплати й повідомлення в боті" description="Те саме оформлення бачать на сторінці оплати і в повідомленні бота за посиланням оффера.">
            <Field label="Заголовок" hint="Порожньо = назва оффера."><input name="title" defaultValue={design.titleMode === "custom" ? design.title ?? "" : ""} maxLength={120} placeholder={pl.name} /></Field>
            <input type="hidden" name="titleMode" value="custom" />
            <Field label="Опис" hint="Що отримає людина. Форматування як у Telegram."><StepText name="description" defaultValue={design.description ?? ""} max={4000} minHeight={140} placeholder="Опишіть, що входить в оффер і для кого він" /></Field>
            <Field label="Текст кнопки"><input name="buttonText" defaultValue={design.buttonText ?? ""} maxLength={64} placeholder="Оплатити" /></Field>
            <Field label="Зображення"><CoverInput current={design.image ?? null} /></Field>
          </Section>
        </div>
        <div className="form aside-sticky">
          <Section title="Перегляд"><Row icon={<Eye size={14} />} title={<a href={`/pay/${encodeURIComponent(pl.key)}?preview=1`} target="_blank" rel="noreferrer" className="lnk">Сторінка оплати</a>} sub="відкриється в новій вкладці без оплати" /><Row icon={<Bot size={14} />} title="Повідомлення в боті" sub={botUser ? `t.me/${botUser}?start=o_${pl.id}` : "спершу підключіть Hub-бот"} /></Section>
          <Section><div className="form"><button className="btn pri" type="submit">Зберегти</button></div></Section>
        </div>
      </form>}

      {tab === "settings" && pl && <form action={saveOffer} className="grid g21"><input type="hidden" name="part" value="settings" /><input type="hidden" name="id" value={pl.id} />
        <div className="form">
          <Section title="Обмеження продажів">
            <FormRow><Field label="Продажі до" hint="після цієї дати оплата недоступна"><input name="salesEndAt" type="datetime-local" defaultValue={toDateTimeInput(pl.salesEndAt)} /></Field><Field label="Кількість місць" hint={`зайнято ${d!.spots}; порожньо = без обмеження`}><input name="spotsLimit" type="number" min={0} defaultValue={pl.spotsLimit ?? ""} /></Field></FormRow>
          </Section>
          <Section title="Доступ до продуктів">
            <Switch name="removeContentOnEnd" defaultChecked={Boolean(st.removeContentOnEnd)} label="Прибрати надіслані кроки з бота, коли доступ закінчиться" hint="повідомлення продуктів видаляються в чаті з ботом; канали закриваються за правилами каналу" />
          </Section>
          <Section title="Після покупки" description="Надсилається в боті одразу після успішної оплати, після стандартного підтвердження.">
            <Field label="Повідомлення в боті"><StepText name="postPurchaseText" defaultValue={st.postPurchaseText ?? ""} max={4000} minHeight={120} placeholder="Дякую за покупку! Ось що робити далі…" /></Field>
          </Section>
          {pl.paymentType === "subscription" && <Section title="Відновлення оплат підписки">
            <Switch name="retries" defaultChecked={st.retries !== false} label="Повторні списання" hint="1, 3 і 5 днів після невдалого списання; доступ зберігається (past due)" />
            <Switch name="reminder" defaultChecked={st.reminder !== false} label="Нагадування про списання" hint="за кілька днів до дати; кількість днів у Налаштування → Оплати" />
          </Section>}
          {pl.paymentType === "one_time" && pl.accessMode !== "forever" && pl.accessMode !== "none" && <Section title="Нагадування про закінчення доступу">
            <Switch name="expiryReminder" defaultChecked={Boolean(st.expiryReminder)} label="Нагадувати, що доступ закінчується" />
            <FormRow><Field label="За скільки днів"><input name="expiryDays" type="number" min={1} defaultValue={st.expiryDays ?? 3} /></Field><Field label="Оффер для продовження" hint="кнопка з оплатою в нагадуванні"><select name="renewalOfferId" defaultValue={st.renewalOfferId ?? ""}><option value="">без кнопки</option>{d!.others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}<option value={pl.id}>цей самий оффер</option></select></Field></FormRow>
            <Field label="Текст" hint="Змінні: {{days}} — днів лишилось, {{offer_name}} — назва оффера."><textarea name="expiryText" rows={3} defaultValue={st.expiryText ?? ""} placeholder="Доступ до «{{offer_name}}» закінчується через {{days}} дн." /></Field>
          </Section>}
          <Section title="Збір контактів">
            <Switch name="collectEmail" defaultChecked={Boolean(st.collectEmail)} label="Просити email на сторінці оплати" hint="зберігається в картці людини; ім’я й Telegram є завжди" />
          </Section>
        </div>
        <div className="form aside-sticky"><Section><div className="form"><button className="btn pri" type="submit">Зберегти</button></div></Section></div>
      </form>}

      {tab === "links" && pl && <div className="grid g21">
        <div className="form">
          <Section title="Оплата" description="Посилання на оплату персональне: бот підставляє його для кожної людини, тому в розсилках і кроках воронок обирайте оффер у кнопці «Оплата», а не вставляйте адресу.">
            <KV items={[
              { k: "Оффер у боті", v: botUser ? <span style={{ userSelect: "all" }}>https://t.me/{botUser}?start=o_{pl.id}</span> : "підключіть Hub-бот", mono: true },
              { k: "Сторінка оплати", v: <span className="mono">{appUrl()}/pay/{pl.key}?u=…</span> },
              { k: "Перевірити на собі", v: <Link href="/settings?tab=payments" className="lnk">Налаштування → Оплати → Перевірити оплату</Link> },
            ]} />
            {!pl.showInBot && <p className="fld-h" style={{ marginTop: 8 }}>Оффер не показується за /plans: люди побачать його лише за цим посиланням або кнопками.</p>}
          </Section>
          <Section title="Посилання доступу без оплати" description="Людина переходить за посиланням у бот і одразу отримує все, що дає оффер, за його правилами тривалості. Можна обмежити кількість людей і строк." className="tbl"
            actions={<Modal title="Нове посилання доступу" width={460} trigger={<button type="button" className="btn pri"><Plus size={15} /> Посилання</button>}>
              <form action={createAccessLink} className="form"><input type="hidden" name="planId" value={pl.id} />
                <Field label="Назва" hint="для себе, наприклад «Подарунок вебінар»"><input name="name" maxLength={80} /></Field>
                <FormRow><Field label="Кількість людей" hint="порожньо = без обмеження"><input name="maxUses" type="number" min={1} /></Field><Field label="Діє до" hint="порожньо = безстроково"><input name="expiresAt" type="date" /></Field></FormRow>
                <Checkbox name="markAsPayment" label="Рахувати як оплату" hint="займає місце в обмеженні місць і потрапляє в продажі з нульовою сумою" />
                <div className="modal-f"><button className="btn pri" type="submit">Створити посилання</button></div>
              </form></Modal>}>
            <table><thead><tr><th>Посилання</th><th className="num">Перейшли</th><th>Діє до</th><th>Статус</th><th></th></tr></thead><tbody>
              {d!.links.map((l) => <tr key={l.id}>
                <td><div>{l.name || "Без назви"}{l.markAsPayment && <Pill tone="moon">як оплата</Pill>}</div><div className="fld-h mono" style={{ userSelect: "all" }}>{botUser ? `https://t.me/${botUser}?start=g_${l.token}` : `?start=g_${l.token}`}</div></td>
                <td className="num">{l.usedCount}{l.maxUses ? ` / ${l.maxUses}` : ""}</td>
                <td>{l.expiresAt ? date(l.expiresAt) : "безстроково"}</td>
                <td><form action={toggleAccessLink}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="planId" value={pl.id} /><AutoSubmitToggleClient checked={l.isActive} label={l.isActive ? "Активне" : "Вимкнене"} /></form></td>
                <td><Kebab><MenuSep /><MenuAction action={deleteAccessLink} fields={{ id: l.id, planId: pl.id }} icon={<Trash2 />} danger confirm="Видалити посилання? Ті, хто вже отримав доступ, його не втратять.">Видалити</MenuAction></Kebab></td>
              </tr>)}
              {!d!.links.length && <tr><td colSpan={5}><EmptyState icon={<Link2 size={20} />} title="Посилань ще немає" text="Створіть перше, щоб дати доступ без оплати." /></td></tr>}
            </tbody></table>
          </Section>
        </div>
        <div className="form aside-sticky">
          <Section title="Оффер"><KV items={[{ k: "Ціна", v: priceLabel(pl) }, { k: pl.paymentType === "one_time" ? "Доступ" : "Інтервал", v: pl.paymentType === "one_time" ? accessLabel(pl) : `кожні ${intervalLabel(pl)}` }, { k: "Дає", v: [...products.map((p) => prods.find((x) => x.id === p)?.name ?? `#${p}`), ...Object.keys(ents).map((k) => res.find((r) => r.key === k)?.name ?? k)].join(", ") || "нічого" }]} /></Section>
          <Section title="Останні покупці й доступи" description={`${d!.recent.length}`}>
            {d!.recent.map(({ s, p }) => <Row key={s.id} tone={["active", "trialing", "past_due"].includes(s.status) ? "on" : "off"} title={<Link href={`/people/${p.id}`}>{fullName(p)}</Link>} sub={`${s.kind === "grant" ? "без оплати" : s.kind === "one_time" ? "разово" : "підписка"} · ${s.status} · ${s.currentPeriodEnd ? `до ${date(s.currentPeriodEnd)}` : "безстроково"} · ${dateTime(s.updatedAt)}`} />)}
            {!d!.recent.length && <EmptyState icon={<Users size={20} />} title="Ще ніхто не купував" />}
          </Section>
        </div>
      </div>}
    </Shell>
  );
}
