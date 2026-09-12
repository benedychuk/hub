import Link from "next/link";
import { notFound } from "next/navigation";
import { Send, Eye, Copy, Trash2, XCircle, RefreshCw, Users, MousePointerClick, Inbox, ArrowRight } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { PageHeader, Stepper, Section, Field, FormRow, Stat, Summary, EmptyState, Alert, FilterGroup } from "@/components/ui/layout";
import { Checkbox, Switch, Kebab, MenuAction } from "@/components/ui/controls";
import { StepText, AttachmentsPicker } from "@/components/funnel-ui";
import { BroadcastButtonsEditor, SendTimePicker } from "@/components/broadcast-ui";
import { AudienceMode } from "../audience-mode";
import { navCounts, broadcastDetail } from "@/lib/queries";
import { saveBroadcastContent, saveBroadcastAudience, sendBroadcast, cancelBroadcast, deleteBroadcastFromSubscribers, deleteBroadcast, duplicateBroadcast, previewBroadcast, runBroadcastsNow } from "@/lib/actions";
import { countAudience, previewAudience, SUB_STATUSES, STATUS_UA } from "@/lib/broadcasts";
import { dateTime, fullName } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const RSTATUS: Record<string, [string, string]> = { pending: ["чекає", "mute"], sending: ["надсилається", "warn"], sent: ["отримала", "good"], failed: ["не доставлено", "crit"], deleted: ["видалено", "mute"] };
const STEPS = ["Зміст", "Отримувачі", "Надсилання"];
const VARS = [{ key: "first_name", label: "ім’я" }, { key: "last_name", label: "прізвище" }, { key: "name", label: "ім’я та прізвище" }, { key: "username", label: "@username" }];

export default async function BroadcastEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string; sent?: string; err?: string }> }) {
  const { id } = await params; const sp = await searchParams;
  const [counts, d] = await Promise.all([navCounts(), broadcastDetail(Number(id))]);
  if (!d) notFound();
  const { b, recipients, clicks, media, tags, funnels, plans, offers, hubOffers, resources, byStatus } = d;
  const editable = b.status === "draft" || b.status === "scheduled";
  const a = b.audience ?? {};
  const hasFilters = Object.entries(a).some(([k, v]) => k !== "onlyAdmin" && (Array.isArray(v) ? v.length > 0 : Boolean(v)));
  const mode: "all" | "filters" | "me" = a.onlyAdmin ? "me" : hasFilters ? "filters" : "all";
  const [audCount, audPreview, total] = editable ? await Promise.all([countAudience(a).catch(() => 0), previewAudience(a, 30).catch(() => []), countAudience({}).catch(() => 0)]) : [b.totalCount, [], 0];
  const stepKey = editable ? (["content", "recipients", "send"].includes(sp.step ?? "") ? sp.step! : "content") : (["content", "recipients", "clicked"].includes(sp.step ?? "") ? sp.step! : "recipients");
  const stepIdx = ["content", "recipients", "send"].indexOf(stepKey);
  const [statusLabel, tone] = STATUS_UA[b.status] ?? [b.status, ""];
  const cnt = (s: string) => byStatus.find((x) => x.status === s)?.c ?? 0;
  const kyiv = b.scheduledAt ? new Date(b.scheduledAt.toLocaleString("en-US", { timeZone: "Europe/Kyiv" })) : null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const initDate = kyiv ? `${kyiv.getFullYear()}-${pad(kyiv.getMonth() + 1)}-${pad(kyiv.getDate())}` : undefined;
  const initTime = kyiv ? `${pad(kyiv.getHours())}:${pad(kyiv.getMinutes())}` : undefined;
  const textLen = (b.text ?? "").replace(/<[^>]+>/g, "").length;
  const n = (arr?: unknown[]) => arr?.length ?? 0;
  const groupCounts = {
    sub: (a.customer && a.customer !== "any" ? 1 : 0) + n(a.subStatus) + n(a.planIds) + n(a.offerIds),
    tags: n(a.tagsAny) + n(a.tagsAll) + n(a.tagsNone), funnels: n(a.funnelIn) + n(a.funnelNotIn), access: n(a.entitlements),
    activity: (a.activeDays ? 1 : 0) + (a.startedAfter ? 1 : 0) + (a.startedBefore ? 1 : 0), manual: n(a.includeIds) + n(a.excludeIds),
  };
  const Nav = () => editable ? <Stepper steps={STEPS} current={stepIdx} hrefFor={(i) => `/broadcasts/${b.id}?step=${["content", "recipients", "send"][i]}`} />
    : <div className="tabs">{[["content", "Зміст"], ["recipients", "Отримувачі"], ["clicked", "Клікнули"]].map(([k, l]) => <Link key={k} href={`/broadcasts/${b.id}?step=${k}`} className={stepKey === k ? "on" : ""}>{l}{k === "recipients" ? ` · ${b.sentCount}` : k === "clicked" ? ` · ${b.clickedCount}` : ""}</Link>)}</div>;
  const chatLabel = (p: { first_name: string | null; last_name: string | null; telegram_user_id: number }) => [p.first_name, p.last_name].filter(Boolean).join(" ") || "tg " + p.telegram_user_id;

  return (
    <Shell title="Розсилки" counts={counts}>
      <PageHeader back="/broadcasts" backLabel="Розсилки" icon={<Send size={16} />} title={b.name}
        status={<Pill tone={tone}>{statusLabel}{b.scheduledAt && b.status === "scheduled" ? " · " + dateTime(b.scheduledAt) : ""}</Pill>}
        actions={<>
          <form action={previewBroadcast}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="step" value={stepKey} /><button className="btn sm" type="submit"><Eye size={15} /> Перегляд</button></form>
          <form action={duplicateBroadcast}><input type="hidden" name="id" value={b.id} /><button className="btn sm" type="submit"><Copy size={15} /> Дублювати</button></form>
          <Kebab>
            {b.status === "scheduled" && <MenuAction action={cancelBroadcast} fields={{ id: b.id }} icon={<XCircle />} confirm="Скасувати заплановану розсилку? Вона стане чернеткою.">Скасувати розклад</MenuAction>}
            {b.status === "sending" && <MenuAction action={runBroadcastsNow} icon={<RefreshCw />}>Продовжити надсилання зараз</MenuAction>}
            {b.status === "sent" && <MenuAction action={deleteBroadcastFromSubscribers} fields={{ id: b.id }} icon={<Trash2 />} danger confirm={`Видалити повідомлення у всіх ${b.sentCount} отримувачів? Можливо лише впродовж 48 годин після надсилання.`}>Видалити у підписників</MenuAction>}
            {b.status !== "sending" && <MenuAction action={deleteBroadcast} fields={{ id: b.id }} icon={<Trash2 />} danger confirm="Видалити розсилку з Hub? Надіслані повідомлення в людей залишаться.">Видалити з Hub</MenuAction>}
          </Kebab>
        </>} />
      {sp.sent && <Alert tone="ok">Надіслано вам у Telegram для перегляду.</Alert>}
      {sp.err && <Alert tone="bad">{sp.err}</Alert>}
      {b.status === "sending" && <Alert tone="info">Надсилається: {b.sentCount} з {b.totalCount}{b.failedCount ? `, не доставлено ${b.failedCount}` : ""}. Решту дошле щохвилинний тік; оновіть сторінку, щоб побачити прогрес.</Alert>}
      {b.status === "deleted" && <Alert tone="warn">Повідомлення видаляються у підписників: видалено {cnt("deleted")} з {b.sentCount}.</Alert>}
      <Nav />

      {/* ---------- 1. Зміст ---------- */}
      {stepKey === "content" && (editable ? (
        <form action={saveBroadcastContent} className="grid g21"><input type="hidden" name="id" value={b.id} />
          <div className="form">
            <Section title="Повідомлення">
              <Field label="Назва розсилки" hint="Внутрішня, підписники її не бачать."><input name="name" defaultValue={b.name} required maxLength={120} /></Field>
              <Field label="Текст"><StepText name="text" defaultValue={b.text ?? ""} variables={VARS} /></Field>
            </Section>
            <Section title="Вкладення" description="Фото, відео, кружечок, голосове або файл із Бібліотеки. Щоб додати новий файл, надішліть його в Hub-бот.">
              <AttachmentsPicker media={media} initial={b.attachments ?? []} />
              <div className="chips-in" style={{ marginTop: 10 }}>
                <Checkbox name="attachedToText" defaultChecked={b.attachedToText} label="Прикріпити до тексту" hint="одне повідомлення: медіа з підписом до 1024 знаків" />
                <Checkbox name="spoiler" defaultChecked={b.spoiler} label="Сховати спойлером" hint="фото й відео розмиті до натискання" />
              </div>
            </Section>
            <Section title="Кнопки" description="До 10 кнопок під повідомленням: посилання, дії в боті, оплата, Mini App.">
              <BroadcastButtonsEditor initial={b.buttons ?? []} funnels={funnels} offers={offers} hubOffers={hubOffers} />
            </Section>
          </div>
          <div className="form aside-sticky">
            <Section title="Налаштування">
              <Switch name="protect" defaultChecked={b.protectContent} label="Захист контенту" hint="без пересилання й збереження" />
              <Switch name="preview" defaultChecked={!b.disablePreview} label="Прев’ю посилань" hint="Telegram показує картку сайту" />
            </Section>
            <Section>
              <div className="form">
                <button className="btn pri" type="submit">Далі: отримувачі <ArrowRight size={15} /></button>
                <button className="btn" type="submit" name="after" value="preview"><Eye size={15} /> Зберегти й переглянути</button>
                <button className="btn ghost" type="submit" name="after" value="exit">Зберегти чернетку</button>
              </div>
              <p className="fld-h" style={{ marginTop: 10 }}>Перегляд надсилає розсилку на ваш Telegram без запису в статистику.</p>
            </Section>
          </div>
        </form>
      ) : (
        <div className="grid g21">
          <Section title="Повідомлення" description="Надіслану розсилку не редагують. Щоб надіслати змінену версію, натисніть «Дублювати».">
            <Summary items={[
              { label: "Назва", value: b.name },
              { label: "Вкладення", value: b.attachments?.length ? b.attachments.map((id) => { const m = media.find((x) => x.id === id); return m ? `#${m.id} ${m.kind}${m.title ? " · " + m.title : ""}` : `#${id}`; }).join(", ") + (b.attachedToText ? " · з текстом" : " · окремо") + (b.spoiler ? " · спойлер" : "") : "немає" },
              { label: "Кнопки", value: b.buttons?.length ? b.buttons.map((x) => x.text).join(" · ") : "немає" },
              { label: "Налаштування", value: `${b.protectContent ? "захист контенту · " : ""}${b.disablePreview ? "без прев’ю" : "прев’ю посилань"}` },
            ]} />
            <div className="fld-l" style={{ margin: "14px 0 6px" }}>Текст</div>
            <div className="rte"><div className="rte-ed" dangerouslySetInnerHTML={{ __html: (b.text ?? "").replace(/\n/g, "<br>") }} /></div>
          </Section>
          <Section title="Підсумок">
            <Summary items={[{ label: "Надіслано", value: `${dateTime(b.startedAt)} → ${dateTime(b.finishedAt)}` }, { label: "Доставлено", value: `${b.sentCount} / ${b.totalCount}` }, { label: "Не доставлено", value: b.failedCount, tone: b.failedCount ? "warn" : undefined }, { label: "Клікнули", value: b.clickedCount }]} />
          </Section>
        </div>
      ))}

      {/* ---------- 2. Отримувачі ---------- */}
      {stepKey === "recipients" && editable && (
        <form action={saveBroadcastAudience} className="grid g21"><input type="hidden" name="id" value={b.id} />
          <div className="form">
            <Section title="Кому надсилати" description="Розсилка йде через Hub-бот, тому отримати її можуть лише ті, хто його запустив і не заблокував.">
              <AudienceMode initial={mode} total={total} filters={<>
                <FilterGroup title="Підписка та оплата" active={groupCounts.sub}>
                  <FormRow>
                    <Field label="Оплати"><select name="customer" defaultValue={a.customer ?? "any"}><option value="any">Будь-хто</option><option value="customer">Customer: є хоча б одна оплата</option><option value="not">Not customer: без оплат</option></select></Field>
                    <Field label="Статус підписки"><div className="chips-in">{SUB_STATUSES.map(([k, l]) => <Checkbox key={k} name="subStatus" value={k} defaultChecked={a.subStatus?.includes(k)} label={l} />)}</div></Field>
                  </FormRow>
                  <FormRow>
                    <Field label="Тариф Hub (активна підписка)"><div className="chips-in">{plans.length ? plans.map((p) => <Checkbox key={p.id} name="planIds" value={String(p.id)} defaultChecked={a.planIds?.includes(p.id)} label={p.name} />) : <span className="fld-h">тарифів ще немає</span>}</div></Field>
                    <Field label="Оффер ZenEdu (активна підписка)"><div className="chips-in" style={{ maxHeight: 150, overflow: "auto" }}>{offers.map((o) => <Checkbox key={o.id} name="offerIds" value={String(o.id)} defaultChecked={a.offerIds?.includes(o.id)} label={o.name} />)}</div></Field>
                  </FormRow>
                </FilterGroup>
                <FilterGroup title="Теги" active={groupCounts.tags}>
                  <FormRow cols={3}>
                    <Field label="Є хоча б один із тегів" hint="через кому"><input name="tagsAny" defaultValue={(a.tagsAny ?? []).join(", ")} list="taglist" /></Field>
                    <Field label="Є всі теги"><input name="tagsAll" defaultValue={(a.tagsAll ?? []).join(", ")} list="taglist" /></Field>
                    <Field label="Немає жодного з тегів"><input name="tagsNone" defaultValue={(a.tagsNone ?? []).join(", ")} list="taglist" /></Field>
                  </FormRow>
                  <datalist id="taglist">{tags.map((t) => <option key={t.tag} value={t.tag}>{t.n}</option>)}</datalist>
                </FilterGroup>
                <FilterGroup title="Воронки" active={groupCounts.funnels}>
                  {funnels.length ? <FormRow>
                    <Field label="Проходили воронку"><div className="chips-in">{funnels.map((f) => <Checkbox key={f.id} name="funnelIn" value={String(f.id)} defaultChecked={a.funnelIn?.includes(f.id)} label={f.name} />)}</div></Field>
                    <Field label="Не проходили воронку"><div className="chips-in">{funnels.map((f) => <Checkbox key={f.id} name="funnelNotIn" value={String(f.id)} defaultChecked={a.funnelNotIn?.includes(f.id)} label={f.name} />)}</div></Field>
                  </FormRow> : <p className="fld-h">Воронок ще немає.</p>}
                </FilterGroup>
                <FilterGroup title="Доступ до продуктів" active={groupCounts.access}>
                  <Field label="Має активний доступ до"><div className="chips-in">{resources.map((r) => <Checkbox key={r.key} name="entitlements" value={r.key} defaultChecked={a.entitlements?.includes(r.key)} label={r.name} />)}</div></Field>
                </FilterGroup>
                <FilterGroup title="Активність і дата" active={groupCounts.activity}>
                  <FormRow cols={3}>
                    <Field label="Писали боту за останні, днів"><input name="activeDays" type="number" min={0} defaultValue={a.activeDays ?? ""} placeholder="30" /></Field>
                    <Field label="Запустили бот після"><input name="startedAfter" type="date" defaultValue={a.startedAfter ?? ""} /></Field>
                    <Field label="Запустили бот до"><input name="startedBefore" type="date" defaultValue={a.startedBefore ?? ""} /></Field>
                  </FormRow>
                </FilterGroup>
                <FilterGroup title="Вручну" active={groupCounts.manual}>
                  <FormRow>
                    <Field label="Додатково включити" hint="ID людей у Hub через кому"><input name="includeIds" defaultValue={(a.includeIds ?? []).join(", ")} /></Field>
                    <Field label="Виключити" hint="ID людей у Hub через кому"><input name="excludeIds" defaultValue={(a.excludeIds ?? []).join(", ")} /></Field>
                  </FormRow>
                </FilterGroup>
              </>} />
            </Section>
            <div className="row-actions">
              <button className="btn pri" type="submit">Далі: надсилання <ArrowRight size={15} /></button>
              <button className="btn" type="submit" name="after" value="stay"><RefreshCw size={15} /> Порахувати отримувачів</button>
              <button className="btn ghost" type="submit" name="after" value="exit">Зберегти чернетку</button>
            </div>
          </div>
          <div className="form aside-sticky">
            <Section title="Отримають розсилку">
              <Stat label="людей" value={audCount} hint={mode === "me" ? "лише ваш акаунт" : mode === "all" ? "усі підписники Hub-бота" : "за поточними фільтрами"} tone={audCount ? undefined : "crit"} />
              {audPreview.length ? <div className="list" style={{ marginTop: 8 }}>{audPreview.map((p) => <div key={p.id} className="ent"><span className={`dot ${p.customer ? "" : "off"}`} /><div><b><Link href={`/people/${p.id}`}>{chatLabel(p)}</Link></b><small>{p.username ? "@" + p.username : `tg ${p.telegram_user_id}`} · {p.customer ? "Customer" : "Not customer"}</small></div></div>)}{audCount > audPreview.length && <p className="fld-h" style={{ marginTop: 8 }}>Показано перші {audPreview.length}.</p>}</div>
                : <EmptyState icon={<Inbox size={20} />} title="Нікого" text="Нікого не знайдено за цими умовами. Люди мають запустити Hub-бот і не блокувати його." />}
              <p className="fld-h" style={{ marginTop: 10 }}>Лічильник оновлюється після «Порахувати отримувачів» або переходу далі.</p>
            </Section>
          </div>
        </form>
      )}

      {stepKey === "recipients" && !editable && (
        <Section title="Отримувачі" description={`${b.sentCount} отримали · ${b.failedCount} не доставлено · ${cnt("pending") + cnt("sending")} чекають`} className="tbl">
          <table><thead><tr><th>Ім’я</th><th>Telegram</th><th>Тип</th><th>Стан</th><th>Дата отримання</th></tr></thead><tbody>
            {recipients.map(({ r, p, customer }) => { const [l, t] = RSTATUS[r.status] ?? [r.status, ""]; return <tr key={r.id}><td><Link href={`/people/${p.id}`}>{fullName(p)}</Link></td><td className="mono">{p.username ? "@" + p.username : ""}</td><td><Pill tone={customer ? "moon" : "mute"}>{customer ? "Customer" : "Not customer"}</Pill></td><td><Pill tone={t}>{l}</Pill>{r.error && <div className="fld-h">{r.error}</div>}</td><td className="mono">{dateTime(r.sentAt)}{r.clickedAt ? " · клік" : ""}</td></tr>; })}
            {!recipients.length && <tr><td colSpan={5}><EmptyState icon={<Users size={20} />} title="Отримувачів немає" /></td></tr>}
          </tbody></table>
          {recipients.length >= 500 && <p className="fld-h">Показано перші 500.</p>}
        </Section>
      )}

      {stepKey === "clicked" && (
        <Section title="Клікнули" description={`${b.clickedCount} людей · ${clicks.length} кліків`} className="tbl">
          <table><thead><tr><th>Ім’я</th><th>Telegram</th><th>Кнопка</th><th>Коли</th></tr></thead><tbody>
            {clicks.map(({ c, p }) => <tr key={c.id}><td><Link href={`/people/${p.id}`}>{fullName(p)}</Link></td><td className="mono">{p.username ? "@" + p.username : ""}</td><td>{b.buttons?.[c.button]?.text ?? `#${c.button + 1}`}</td><td className="mono">{dateTime(c.createdAt)}</td></tr>)}
            {!clicks.length && <tr><td colSpan={4}><EmptyState icon={<MousePointerClick size={20} />} title="Ніхто ще не клікнув" /></td></tr>}
          </tbody></table>
        </Section>
      )}

      {/* ---------- 3. Надсилання ---------- */}
      {stepKey === "send" && editable && (
        <form action={sendBroadcast} className="grid g21"><input type="hidden" name="id" value={b.id} />
          <div className="form">
            <Section title="Коли надсилати" description="«Зараз» фіксує список отримувачів і починає відправку одразу. «Запланувати» фіксує список у момент планування; його можна змінити до старту.">
              <SendTimePicker initial={{ mode: b.status === "scheduled" ? "schedule" : "now", date: initDate, time: initTime }} count={audCount} />
            </Section>
          </div>
          <div className="form aside-sticky">
            <Section title="Підсумок">
              <Summary items={[
                { label: "Отримувачі", value: `${audCount} ${mode === "me" ? "· лише мені" : ""}`, tone: audCount ? undefined : "crit" },
                { label: "Текст", value: textLen ? `${textLen} знаків` : "порожній", tone: textLen ? undefined : "crit" },
                { label: "Вкладення", value: b.attachments?.length || "немає" },
                { label: "Кнопки", value: b.buttons?.length || "немає" },
                { label: "Захист контенту", value: b.protectContent ? "увімкнено" : "вимкнено" },
              ]} />
              {!textLen && !b.attachments?.length && <Alert tone="bad">Додайте текст або вкладення на кроці «Зміст».</Alert>}
              {!audCount && <Alert tone="bad">Немає жодного отримувача. Поверніться на крок «Отримувачі».</Alert>}
              <Link href={`/broadcasts/${b.id}?step=content`} className="btn ghost sm" style={{ marginTop: 8 }}>Змінити зміст</Link>
            </Section>
          </div>
        </form>
      )}
    </Shell>
  );
}
