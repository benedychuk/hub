import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { ConfirmSubmit, MenuCloser } from "@/components/funnel-ui";
import { navCounts, resourceList, planList } from "@/lib/queries";
import { saveResource, saveChannelResource, refreshChatInfo, toggleResource, deleteResource } from "@/lib/actions";
import { botRightsIn, channelStats, type ChannelConfig } from "@/lib/telegram-access";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
const KINDS: Record<string, string> = { telegram_channel: "Канал", telegram_group: "Група", bot_feature: "Функція бота", external_url: "Посилання", course: "Курс" };
type Cfg = ChannelConfig & { cover?: string; memberCount?: number; username?: string; syncedAt?: string; url?: string; description?: string; zenedu_grants?: boolean; offer_url?: string; quota_per_day?: number };

export default async function ResourcePage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ saved?: string; new?: string }> }) {
  const { key } = await params; const sp = await searchParams;
  const [counts, res, plans] = await Promise.all([navCounts(), resourceList(), planList()]);
  const r = res.find((x) => x.key === key);
  if (!r) notFound();
  const c = (r.config ?? {}) as Cfg;
  const chat = r.kind === "telegram_channel" || r.kind === "telegram_group";
  const [s, rights] = chat ? await Promise.all([channelStats(r.key).catch(() => null), c.chatId && process.env.TELEGRAM_BOT_TOKEN ? botRightsIn(c.chatId) : Promise.resolve(null)]) : [null, null];
  const inPlans = plans.filter((p) => Object.keys((p.entitlements ?? {}) as Record<string, string>).includes(r.key));
  return (
    <Shell title={chat ? "Канали і групи" : "Цифрові продукти"} counts={counts}>
      <MenuCloser />
      <div className="fhead">
        <Link href={chat ? "/resources" : "/resources?tab=digital"} className="btn sm ghost">← Назад</Link>
        {c.cover && <span style={{ width: 36, height: 36, borderRadius: 10, backgroundImage: `url(${c.cover})`, backgroundSize: "cover" }} />}
        <h2>{r.name}</h2>
        <Pill tone="moon">{KINDS[r.kind] ?? r.kind}</Pill>
        {!r.isActive ? <Pill tone="mute">Вимкнено</Pill> : chat && !c.chatId ? <Pill tone="warn">Не підключено</Pill> : chat && rights && !rights.ok ? <Pill tone="crit">Бот без прав</Pill> : <Pill tone="good">Active</Pill>}
        {chat && c.chatId && <form action={refreshChatInfo}><input type="hidden" name="key" value={r.key} /><button className="btn sm" type="submit">⟳ Оновити з Telegram</button></form>}
        <details className="menu"><summary>⋮</summary><div className="dd">
          <form action={toggleResource}><input type="hidden" name="key" value={r.key} /><button type="submit">{r.isActive ? "⏸ Вимкнути" : "▶ Увімкнути"}</button></form>
          <div className="sep" />
          <form action={deleteResource}><input type="hidden" name="key" value={r.key} /><ConfirmSubmit className="danger" message={`Видалити «${r.name}» з Hub?`}>🗑 Видалити</ConfirmSubmit></form>
        </div></details>
      </div>
      {sp.new && <div className="alert ok">{chat ? "Канал підключено. Перевірте режим вступу й тексти нижче, а право доступу додайте в тарифі." : "Продукт створено. Додайте його до тарифу, щоб видавати доступ."}</div>}
      {sp.saved && <div className="alert ok">Збережено.</div>}
      {chat && rights && !rights.ok && <div className="alert bad">Hub-бот не має потрібних прав у цьому чаті: {(rights as { error?: string }).error ?? `статус ${(rights as { status?: string }).status}`}. Зробіть бота адміністратором із правами «Додавати учасників» і «Блокувати користувачів».</div>}
      {chat && s && <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="stat"><small>З правом</small><b>{s.withRight}</b><span className="pct">мають доступ за тарифом чи вручну</span></div>
        <div className="stat"><small>У чаті</small><b>{s.joined}</b><span className="pct">{c.memberCount != null ? `усього в Telegram ${c.memberCount}` : ""}</span></div>
        <div className="stat"><small>Запрошені</small><b>{s.invited}</b><span className="pct">отримали посилання, ще не зайшли</span></div>
        <div className="stat"><small>Без права в чаті</small><b style={{ color: s.withoutRight ? "var(--crit)" : undefined }}>{s.withoutRight}</b><span className="pct">виключить найближчий тік</span></div>
      </div>}
      <div className="grid g21">
        {chat ? (
          <form action={saveChannelResource} className="card form"><input type="hidden" name="key" value={r.key} />
            <h3>Налаштування</h3>
            <div className="form two"><label className="field">Назва<input name="name" defaultValue={r.name} /></label><label className="field">chat_id<input name="chatId" defaultValue={c.chatId ?? ""} placeholder="-1001234567890" /></label></div>
            <div className="form two"><label className="field">Режим вступу<select name="joinMode" defaultValue={c.joinMode ?? "invite"}><option value="invite">Одноразове посилання (як у ZenEdu)</option><option value="request">За заявкою: бот схвалює лише з правом</option></select></label><label className="field">Посилання діє, годин<input name="inviteTtlHours" type="number" defaultValue={c.inviteTtlHours ?? 24} /></label></div>
            <div className="form two"><label className="field">Grace після кінця підписки, днів<input name="graceDays" type="number" defaultValue={c.graceDays ?? 0} /></label><label className="field">Нотатка<input name="note" defaultValue={c.note ?? ""} /></label></div>
            <label className="field">Текст із посиланням<textarea name="inviteText" rows={2} defaultValue={c.inviteText ?? ""} placeholder={`Доступ відкрито: ${r.name}. Посилання одноразове і діє 24 год.`} /></label>
            <label className="field">Текст при виключенні<textarea name="kickText" rows={2} defaultValue={c.kickText ?? ""} placeholder={`Термін доступу до «${r.name}» завершився. Щоб повернутись, поновіть підписку: /plans`} /></label>
            <div className="row-actions"><button className="btn pri" type="submit">Зберегти</button><span className="muted mono">{r.key}{c.syncedAt ? ` · оновлено ${dateTime(c.syncedAt)}` : ""}</span></div>
          </form>
        ) : (
          <form action={saveResource} className="card form"><input type="hidden" name="key" value={r.key} /><input type="hidden" name="kind" value={r.kind} />
            <h3>Налаштування</h3>
            <label className="field">Назва<input name="name" defaultValue={r.name} /></label>
            {(r.kind === "external_url" || r.kind === "course") && <label className="field">Посилання, яке отримує людина з правом<input name="url" defaultValue={c.url ?? ""} placeholder="https://…" /></label>}
            <label className="field">Опис для людини<textarea name="description" rows={2} defaultValue={c.description ?? ""} /></label>
            {r.kind === "bot_feature" && <>
              <label className="ck"><input type="checkbox" name="zenedu_grants" defaultChecked={c.zenedu_grants ?? false} /> Давати доступ усім активним підпискам ZenEdu (перехідний режим, як зараз у «Щиро»)</label>
              <div className="form two"><label className="field">Квота на день<input name="quota_per_day" type="number" defaultValue={c.quota_per_day ?? ""} placeholder="0 = без ліміту" /></label><label className="field">Посилання на оффер для тих, хто без доступу<input name="offer_url" defaultValue={c.offer_url ?? ""} placeholder="https://t.me/…" /></label></div>
            </>}
            <label className="field">Нотатка<input name="note" defaultValue={c.note ?? ""} /></label>
            <div className="row-actions"><button className="btn pri" type="submit">Зберегти</button><span className="muted mono">{r.key}</span></div>
          </form>
        )}
        <div className="form">
          <div className="card"><h3>У тарифах</h3>{inPlans.length ? inPlans.map((p) => <div key={p.id} className="ent"><span className="dot" /><div><b><Link href={`/plans/${p.id}`}>{p.name}</Link></b><small>{p.price} {p.currency} / {p.period}</small></div></div>) : <p className="muted">Поки не входить у жоден тариф. Додайте в <Link href="/plans">Тарифах</Link>, щоб доступ видавався автоматично.</p>}</div>
          {chat && <div className="card"><h3>Як це працює</h3><p className="note" style={{ margin: 0 }}>Людина з правом отримує в Hub-боті одноразове посилання, що діє {c.inviteTtlHours ?? 24} год. Коли право закінчується{c.graceDays ? ` і минає ${c.graceDays} дн. grace` : ""}, щохвилинний тік виключає її з чату з можливістю повернутись і надсилає текст при виключенні. Право дають тарифи Hub і ручна видача в картці людини.</p></div>}
          {r.kind === "bot_feature" && <div className="card"><h3>Як це працює</h3><p className="note" style={{ margin: 0 }}>Зовнішній бот питає в Hub через API, чи має людина право «{r.key}». Ключ для бота створюється в розділі «Боти й меню».</p></div>}
        </div>
      </div>
    </Shell>
  );
}
