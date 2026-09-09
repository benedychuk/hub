import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { ConfirmSubmit, StepText, AttachmentsPicker } from "@/components/funnel-ui";
import { Kebab } from "@/components/kebab";
import { BroadcastButtonsEditor, SendTimePicker } from "@/components/broadcast-ui";
import { navCounts, broadcastDetail } from "@/lib/queries";
import { saveBroadcastContent, saveBroadcastAudience, sendBroadcast, cancelBroadcast, deleteBroadcastFromSubscribers, deleteBroadcast, duplicateBroadcast, previewBroadcast, runBroadcastsNow } from "@/lib/actions";
import { countAudience, previewAudience, SUB_STATUSES, STATUS_UA } from "@/lib/broadcasts";
import { dateTime, fullName } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const REL = (d: Date | null) => d ? dateTime(d) : "—";
const RSTATUS: Record<string, [string, string]> = { pending: ["чекає", "mute"], sending: ["надсилається", "warn"], sent: ["отримала", "good"], failed: ["не доставлено", "crit"], deleted: ["видалено", "mute"] };

export default async function BroadcastEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string; sent?: string; err?: string }> }) {
  const { id } = await params; const sp = await searchParams;
  const [counts, d] = await Promise.all([navCounts(), broadcastDetail(Number(id))]);
  if (!d) notFound();
  const { b, recipients, clicks, media, tags, funnels, plans, offers, resources, byStatus } = d;
  const editable = b.status === "draft" || b.status === "scheduled";
  const a = b.audience ?? {};
  const [audCount, audPreview] = editable ? await Promise.all([countAudience(a).catch(() => 0), previewAudience(a, 50).catch(() => [])]) : [b.totalCount, []];
  const step = editable ? (["content", "recipients", "send"].includes(sp.step ?? "") ? sp.step! : "content") : (["content", "recipients", "clicked"].includes(sp.step ?? "") ? sp.step! : "recipients");
  const [statusLabel, tone] = STATUS_UA[b.status] ?? [b.status, ""];
  const cnt = (s: string) => byStatus.find((x) => x.status === s)?.c ?? 0;
  const kyiv = b.scheduledAt ? new Date(b.scheduledAt.toLocaleString("en-US", { timeZone: "Europe/Kyiv" })) : null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const initDate = kyiv ? `${kyiv.getFullYear()}-${pad(kyiv.getMonth() + 1)}-${pad(kyiv.getDate())}` : undefined;
  const initTime = kyiv ? `${pad(kyiv.getHours())}:${pad(kyiv.getMinutes())}` : undefined;
  const Nav = () => editable ? (
    <div className="stepper">
      {[["content", "1", "Зміст"], ["recipients", "2", "Отримувачі"], ["send", "3", "Надсилання"]].map(([k, n, l], i) => <span key={k} style={{ display: "contents" }}>{i > 0 && <span className="sep">›</span>}<Link href={`/broadcasts/${b.id}?step=${k}`} className={step === k ? "on" : ""}><i>{n}</i>{l}</Link></span>)}
    </div>) : (
    <div className="tabs">{[["content", "Зміст"], ["recipients", "Отримувачі"], ["clicked", "Клікнули"]].map(([k, l]) => <Link key={k} href={`/broadcasts/${b.id}?step=${k}`} className={step === k ? "on" : ""}>{l}{k === "recipients" ? ` · ${b.sentCount}` : k === "clicked" ? ` · ${b.clickedCount}` : ""}</Link>)}</div>);
  return (
    <Shell title="Розсилки" counts={counts}>
            <div className="fhead">
        <Link href="/broadcasts" className="btn sm ghost">← Розсилки</Link>
        <h2>➤ {b.name}</h2>
        <Pill tone={tone}>{statusLabel}{b.scheduledAt && b.status === "scheduled" ? " · " + dateTime(b.scheduledAt) : ""}</Pill>
        <form action={previewBroadcast}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="step" value={step} /><button className="btn sm" type="submit" title="Надіслати собі для перегляду">👁 Перегляд</button></form>
        <form action={duplicateBroadcast}><input type="hidden" name="id" value={b.id} /><button className="btn sm" type="submit">⧉ Дублювати</button></form>
        <Kebab>
          {b.status === "scheduled" && <form action={cancelBroadcast}><input type="hidden" name="id" value={b.id} /><ConfirmSubmit message="Скасувати заплановану розсилку?">⏹ Скасувати розклад</ConfirmSubmit></form>}
          {b.status === "sending" && <form action={runBroadcastsNow}><button type="submit">⟳ Продовжити надсилання зараз</button></form>}
          {b.status === "sent" && <form action={deleteBroadcastFromSubscribers}><input type="hidden" name="id" value={b.id} /><ConfirmSubmit className="danger" message={`Видалити повідомлення у всіх ${b.sentCount} отримувачів? Лише впродовж 48 годин після надсилання.`}>🗑 Видалити у підписників</ConfirmSubmit></form>}
          {b.status !== "sending" && <><div className="sep" /><form action={deleteBroadcast}><input type="hidden" name="id" value={b.id} /><ConfirmSubmit className="danger" message="Видалити розсилку з Hub?">✕ Видалити з Hub</ConfirmSubmit></form></>}
        </Kebab>
      </div>
      {sp.sent && <div className="alert ok">Надіслано вам у Telegram для перегляду.</div>}
      {sp.err && <div className="alert bad">{sp.err}</div>}
      {b.status === "sending" && <div className="alert">Надсилається: {b.sentCount} з {b.totalCount}{b.failedCount ? `, не доставлено ${b.failedCount}` : ""}. Решту дошле щохвилинний тік. Оновіть сторінку, щоб побачити прогрес.</div>}
      {b.status === "deleted" && <div className="alert">Повідомлення видаляються у підписників: видалено {cnt("deleted")} з {b.sentCount}.</div>}
      <Nav />

      {step === "content" && (editable ? (
        <form action={saveBroadcastContent} className="grid g21"><input type="hidden" name="id" value={b.id} />
          <div className="form">
            <div className="card form">
              <label className="field">Назва (внутрішня)<input name="name" defaultValue={b.name} required maxLength={120} /></label>
              <div className="field">Текст<StepText name="text" defaultValue={b.text ?? ""} variables={[{ key: "first_name", label: "ім’я" }, { key: "last_name", label: "прізвище" }, { key: "name", label: "ім’я та прізвище" }, { key: "username", label: "@username" }]} /></div>
            </div>
            <div className="card"><h3>Вкладення <span className="sub">файли з Бібліотеки; надішліть їх у Hub-бот</span></h3>
              <AttachmentsPicker media={media} initial={b.attachments ?? []} />
              <div className="row-actions" style={{ gap: 18, marginTop: 8 }}>
                <label className="ck" title="Медіа й текст одним повідомленням (підпис до 1024 знаків); інакше медіа окремо, текст із кнопками окремо"><input type="checkbox" name="attachedToText" defaultChecked={b.attachedToText} /> Прикріпити до тексту</label>
                <label className="ck" title="Фото й відео приховані спойлером до натискання"><input type="checkbox" name="spoiler" defaultChecked={b.spoiler} /> Сховати спойлером</label>
              </div>
            </div>
            <div className="card"><h3>Кнопки</h3><BroadcastButtonsEditor initial={b.buttons ?? []} funnels={funnels} offers={offers} /></div>
          </div>
          <div className="form">
            <div className="card form"><h3>Налаштування</h3>
              <label className="ck"><input type="checkbox" name="protect" defaultChecked={b.protectContent} /> Захист контенту: без пересилання й збереження</label>
              <label className="ck"><input type="checkbox" name="preview" defaultChecked={!b.disablePreview} /> Прев’ю посилань</label>
            </div>
            <div className="card form">
              <div className="row-actions"><button className="btn pri" type="submit">Зберегти й далі →</button><button className="btn" type="submit" name="after" value="preview">👁 Зберегти й переглянути</button><button className="btn ghost" type="submit" name="after" value="exit">Зберегти й вийти</button></div>
              <p className="note">Перегляд надсилає розсилку на ваш Telegram (ADMIN_TELEGRAM_ID) без запису в статистику.</p>
            </div>
          </div>
        </form>
      ) : (
        <div className="grid g21">
          <div className="card form"><div className="kv"><dt>Назва</dt><dd>{b.name}</dd><dt>Текст</dt><dd style={{ whiteSpace: "pre-wrap" }}>{b.text}</dd><dt>Вкладення</dt><dd>{b.attachments?.length ? b.attachments.map((id) => { const m = media.find((x) => x.id === id); return m ? `#${m.id} ${m.kind}${m.title ? " · " + m.title : ""}` : `#${id}`; }).join(", ") : "—"}{b.attachments?.length ? ` · ${b.attachedToText ? "прикріплено до тексту" : "окремо"}${b.spoiler ? " · спойлер" : ""}` : ""}</dd>
            <dt>Кнопки</dt><dd>{b.buttons?.length ? b.buttons.map((x, i) => <div key={i}>• {x.text} <span className="muted">({x.type}{x.url ? " · " + x.url : ""})</span></div>) : "—"}</dd>
            <dt>Налаштування</dt><dd>{b.protectContent ? "захист контенту · " : ""}{b.disablePreview ? "без прев’ю" : "прев’ю посилань"}</dd></div>
            <p className="note">Надіслану розсилку не редагують. Щоб надіслати змінену версію, натисніть «Дублювати».</p></div>
          <div className="card"><h3>Підсумок</h3><div className="kv"><dt>Надіслано</dt><dd>{REL(b.startedAt)} → {REL(b.finishedAt)}</dd><dt>Доставлено</dt><dd>{b.sentCount} / {b.totalCount}</dd><dt>Не доставлено</dt><dd>{b.failedCount}</dd><dt>Клікнули</dt><dd>{b.clickedCount}</dd></div></div>
        </div>
      ))}

      {step === "recipients" && editable && (
        <form action={saveBroadcastAudience} className="grid g21"><input type="hidden" name="id" value={b.id} />
          <div className="form">
            <div className="card"><h3>Фільтри отримувачів <span className="sub">порожній фільтр = усі, хто запустив Hub-бот</span></h3>
              <div className="filters">
                <label className="field">Тип<select name="customer" defaultValue={a.customer ?? "any"}><option value="any">Усі</option><option value="customer">Customer: є оплата</option><option value="not">Not customer: без оплат</option></select></label>
                <div className="field">Статус підписки<div className="chk-list">{SUB_STATUSES.map(([k, l]) => <label key={k} className="ck"><input type="checkbox" name="subStatus" value={k} defaultChecked={a.subStatus?.includes(k)} /> {l}</label>)}</div></div>
                <label className="field">Є хоч один із тегів (через кому)<input name="tagsAny" defaultValue={(a.tagsAny ?? []).join(", ")} list="taglist" /></label>
                <label className="field">Є всі теги<input name="tagsAll" defaultValue={(a.tagsAll ?? []).join(", ")} list="taglist" /></label>
                <label className="field">Немає тегів<input name="tagsNone" defaultValue={(a.tagsNone ?? []).join(", ")} list="taglist" /></label>
                <div className="field">У воронці<div className="chk-list">{funnels.map((f) => <label key={f.id} className="ck"><input type="checkbox" name="funnelIn" value={f.id} defaultChecked={a.funnelIn?.includes(f.id)} /> {f.name}</label>)}{!funnels.length && <span className="muted">воронок ще немає</span>}</div></div>
                <div className="field">Не у воронці<div className="chk-list">{funnels.map((f) => <label key={f.id} className="ck"><input type="checkbox" name="funnelNotIn" value={f.id} defaultChecked={a.funnelNotIn?.includes(f.id)} /> {f.name}</label>)}</div></div>
                <div className="field">Тариф (активна підписка)<div className="chk-list">{plans.map((p) => <label key={p.id} className="ck"><input type="checkbox" name="planIds" value={p.id} defaultChecked={a.planIds?.includes(p.id)} /> {p.name}</label>)}</div></div>
                <div className="field">Оффер ZenEdu (активна підписка)<div className="chk-list" style={{ maxHeight: 140, overflow: "auto" }}>{offers.map((o) => <label key={o.id} className="ck"><input type="checkbox" name="offerIds" value={o.id} defaultChecked={a.offerIds?.includes(o.id)} /> {o.name}</label>)}</div></div>
                <div className="field">Має доступ до<div className="chk-list">{resources.map((r) => <label key={r.key} className="ck"><input type="checkbox" name="entitlements" value={r.key} defaultChecked={a.entitlements?.includes(r.key)} /> {r.name}</label>)}</div></div>
                <label className="field">Активні в боті за останні N днів<input name="activeDays" type="number" min={0} defaultValue={a.activeDays ?? ""} placeholder="напр. 30" /></label>
                <label className="field">Запустили бот після<input name="startedAfter" type="date" defaultValue={a.startedAfter ?? ""} /></label>
                <label className="field">Запустили бот до<input name="startedBefore" type="date" defaultValue={a.startedBefore ?? ""} /></label>
                <label className="field">Додатково включити (id людей через кому)<input name="includeIds" defaultValue={(a.includeIds ?? []).join(", ")} /></label>
                <label className="field">Виключити (id людей)<input name="excludeIds" defaultValue={(a.excludeIds ?? []).join(", ")} /></label>
                <label className="ck" style={{ alignSelf: "end" }}><input type="checkbox" name="onlyAdmin" defaultChecked={Boolean(a.onlyAdmin)} /> Тест: лише мені</label>
              </div>
              <datalist id="taglist">{tags.map((t) => <option key={t.tag} value={t.tag}>{t.n}</option>)}</datalist>
              <div className="row-actions" style={{ marginTop: 14 }}><button className="btn" type="submit" name="after" value="stay">Застосувати фільтри</button><button className="btn pri" type="submit">Зберегти й далі →</button><button className="btn ghost" type="submit" name="after" value="exit">Зберегти й вийти</button></div>
            </div>
          </div>
          <div className="card tbl"><h3>Отримають розсилку <span className="count-big">{audCount}</span></h3>
            <table><thead><tr><th>Ім’я</th><th>Telegram</th><th>Тип</th></tr></thead><tbody>
              {audPreview.map((p) => <tr key={p.id}><td><Link href={`/people/${p.id}`}>{[p.first_name, p.last_name].filter(Boolean).join(" ") || "tg " + p.telegram_user_id}</Link></td><td className="mono">{p.username ? "@" + p.username : ""}</td><td><Pill tone={p.customer ? "moon" : "mute"}>{p.customer ? "Customer" : "Not customer"}</Pill></td></tr>)}
              {!audPreview.length && <tr><td colSpan={3} className="muted">Нікого. Люди мають запустити Hub-бот (/start) і не блокувати його.</td></tr>}
            </tbody></table>
            {audCount > audPreview.length && <p className="note">Показано перші {audPreview.length}.</p>}
          </div>
        </form>
      )}

      {step === "recipients" && !editable && (
        <div className="card tbl"><h3>Список отримувачів <span className="sub">{b.sentCount} отримали · {b.failedCount} не доставлено · {cnt("pending") + cnt("sending")} чекають</span></h3>
          <table><thead><tr><th>Ім’я</th><th>Telegram</th><th>Тип</th><th>Стан</th><th>Дата отримання</th></tr></thead><tbody>
            {recipients.map(({ r, p, customer }) => { const [l, t] = RSTATUS[r.status] ?? [r.status, ""]; return <tr key={r.id}><td><Link href={`/people/${p.id}`}>{fullName(p)}</Link></td><td className="mono">{p.username ? "@" + p.username : ""}</td><td><Pill tone={customer ? "moon" : "mute"}>{customer ? "Customer" : "Not customer"}</Pill></td><td><Pill tone={t}>{l}</Pill>{r.error && <div className="muted" style={{ fontSize: 11.5 }}>{r.error}</div>}</td><td className="mono">{REL(r.sentAt)}{r.clickedAt ? " · клік" : ""}</td></tr>; })}
            {!recipients.length && <tr><td colSpan={5} className="muted">Отримувачів немає.</td></tr>}
          </tbody></table>
          {recipients.length >= 500 && <p className="note">Показано перші 500.</p>}
        </div>
      )}

      {step === "clicked" && (
        <div className="card tbl"><h3>Клікнули <span className="sub">{b.clickedCount} людей · {clicks.length} кліків</span></h3>
          <table><thead><tr><th>Ім’я</th><th>Telegram</th><th>Кнопка</th><th>Коли</th></tr></thead><tbody>
            {clicks.map(({ c, p }) => <tr key={c.id}><td><Link href={`/people/${p.id}`}>{fullName(p)}</Link></td><td className="mono">{p.username ? "@" + p.username : ""}</td><td>{b.buttons?.[c.button]?.text ?? `#${c.button + 1}`}</td><td className="mono">{dateTime(c.createdAt)}</td></tr>)}
            {!clicks.length && <tr><td colSpan={4} className="muted">Ніхто ще не клікнув.</td></tr>}
          </tbody></table>
        </div>
      )}

      {step === "send" && editable && (
        <form action={sendBroadcast} className="grid g21"><input type="hidden" name="id" value={b.id} />
          <div className="card form">
            <h3>Розсилка для <span className="count-big">{audCount}</span> людей</h3>
            <SendTimePicker initial={{ mode: b.status === "scheduled" ? "schedule" : "now", date: initDate, time: initTime }} />
            <div className="row-actions" style={{ marginTop: 8 }}>
              <ConfirmSubmit className="btn pri" message={`Надіслати або запланувати розсилку «${b.name}» для ${audCount} людей?`}>➤ Підтвердити</ConfirmSubmit>
              <Link href="/broadcasts" className="btn ghost">Зберегти й вийти</Link>
            </div>
            <p className="note">«Надіслати зараз» фіксує список отримувачів і починає відправку одразу (~20 повідомлень/с); решту дошле тік. «Запланувати» фіксує список у момент планування і доповнює його новими людьми, якщо змінити фільтри до старту.</p>
          </div>
          <div className="card"><h3>Перевірка</h3><div className="kv"><dt>Текст</dt><dd>{b.text ? `${b.text.length} знаків` : <span style={{ color: "var(--crit)" }}>порожній</span>}</dd><dt>Вкладення</dt><dd>{b.attachments?.length || 0}</dd><dt>Кнопки</dt><dd>{b.buttons?.length || 0}</dd><dt>Отримувачі</dt><dd>{audCount}</dd></div>
            {!b.text && !b.attachments?.length && <div className="alert bad" style={{ marginTop: 12 }}>Додайте текст або вкладення на кроці «Зміст».</div>}
            {!audCount && <div className="alert bad" style={{ marginTop: 12 }}>Немає жодного отримувача.</div>}
          </div>
        </form>
      )}
    </Shell>
  );
}
