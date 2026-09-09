import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { navCounts, resourceList, settingsMap } from "@/lib/queries";
import { seedResources, saveResource, saveChannelResource, runAccessTickNow, runReconcileNow } from "@/lib/actions";
import { botRightsIn, channelStats, type ChannelConfig } from "@/lib/telegram-access";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
const KINDS: Record<string, string> = { telegram_channel: "Telegram-канал", telegram_group: "Telegram-група", bot_feature: "Функція бота", external_url: "Посилання", course: "Курс" };

export default async function Resources() {
  const [counts, res, st] = await Promise.all([navCounts(), resourceList(), settingsMap()]);
  const known = (st["known_chats"] as { id: number; title: string; type: string; status: string; at: string }[] | undefined) ?? [];
  const hasToken = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const channels = res.filter((r) => r.kind === "telegram_channel" || r.kind === "telegram_group");
  const others = res.filter((r) => !(r.kind === "telegram_channel" || r.kind === "telegram_group"));
  const stats = await Promise.all(channels.map(async (r) => { const cfg = (r.config ?? {}) as ChannelConfig; return { key: r.key, s: await channelStats(r.key).catch(() => null), rights: hasToken && cfg.chatId ? await botRightsIn(cfg.chatId) : null }; }));
  const rec = st["reconcile.last"] as { at?: string; checked?: number; fixed?: number } | undefined;
  return (
    <Shell title="Доступи" counts={counts}>
      <div className="hdr"><h2>Продукти: канали і групи</h2><div className="row-actions">{!res.length && <form action={seedResources}><button className="btn pri" type="submit">Створити стандартні ресурси</button></form>}<form action={runAccessTickNow}><button className="btn" type="submit">Запросити і виключити зараз</button></form><form action={runReconcileNow}><button className="btn ghost" type="submit">Звірити з Telegram</button></form></div></div>
      {known.length > 0 && <div className="alert ok">Hub-бот бачить такі чати, де його додали: {known.map((c) => <span key={c.id} className="mono" style={{ marginRight: 10 }}>{c.title} · {c.type} · <b>{c.id}</b> · {c.status}</span>)}. Скопіюйте потрібний id у поле chat_id нижче.</div>}
      {!known.length && hasToken && <div className="alert">Щоб керувати каналом, додайте Hub-бот у тестовий канал і групу адміністратором з правами «Додавати учасників» і «Блокувати користувачів». Після цього id чату з'явиться тут.</div>}
      <div className="grid g2" style={{ marginBottom: 24 }}>
        {channels.map((r) => { const c = (r.config ?? {}) as ChannelConfig; const x = stats.find((z) => z.key === r.key); return (
          <form key={r.id} action={saveChannelResource} className="card form"><input type="hidden" name="key" value={r.key} />
            <h3>{r.name} <Pill tone={!c.chatId ? "mute" : x?.rights?.ok ? "good" : "crit"}>{!c.chatId ? "chat_id не задано" : x?.rights?.ok ? `бот адмін · ${(x.rights as { title?: string }).title}` : `бот без прав: ${(x?.rights as { error?: string; status?: string })?.error ?? (x?.rights as { status?: string })?.status ?? "невідомо"}`}</Pill></h3>
            {x?.s && <div className="grid g4" style={{ gap: 8, marginBottom: 6 }}><div className="kpi card" style={{ padding: "10px 12px" }}><h3>З правом</h3><b style={{ fontSize: 20 }}>{x.s.withRight}</b></div><div className="kpi card" style={{ padding: "10px 12px" }}><h3>У каналі</h3><b style={{ fontSize: 20 }}>{x.s.joined}</b></div><div className="kpi card" style={{ padding: "10px 12px" }}><h3>Запрошені</h3><b style={{ fontSize: 20 }}>{x.s.invited}</b></div><div className="kpi card" style={{ padding: "10px 12px" }}><h3>Без права в каналі</h3><b style={{ fontSize: 20, color: x.s.withoutRight ? "var(--crit)" : undefined }}>{x.s.withoutRight}</b></div></div>}
            <div className="form two"><label className="field">Назва<input name="name" defaultValue={r.name} /></label><label className="field">chat_id<input name="chatId" defaultValue={c.chatId ?? ""} placeholder="-1001234567890" /></label></div>
            <div className="form two"><label className="field">Режим вступу<select name="joinMode" defaultValue={c.joinMode ?? "invite"}><option value="invite">Одноразове посилання (як у ZenEdu)</option><option value="request">За заявкою: бот схвалює лише з правом</option></select></label><label className="field">Посилання діє, годин<input name="inviteTtlHours" type="number" defaultValue={c.inviteTtlHours ?? 24} /></label></div>
            <div className="form two"><label className="field">Grace після кінця підписки, днів<input name="graceDays" type="number" defaultValue={c.graceDays ?? 0} /></label><label className="field">Нотатка<input name="note" defaultValue={c.note ?? ""} /></label></div>
            <label className="field">Текст із посиланням<textarea name="inviteText" rows={2} defaultValue={c.inviteText ?? ""} placeholder={`Доступ відкрито: ${r.name}. Посилання одноразове і діє 24 год.`} /></label>
            <label className="field">Текст при виключенні<textarea name="kickText" rows={2} defaultValue={c.kickText ?? ""} placeholder={`Термін доступу до «${r.name}» завершився. Щоб повернутись, поновіть підписку: /plans`} /></label>
            <div className="row-actions"><button className="btn sm pri" type="submit">Зберегти</button><span className="muted mono">{r.key}</span></div>
          </form>); })}
      </div>
      <p className="note" style={{ marginBottom: 24 }}>Як це працює: людина з правом отримує в Hub-боті одноразове посилання на 24 години. Коли право закінчується, тік раз на хвилину виключає її з каналу з можливістю повернутись. Звірка з Telegram щоночі о 04:00{rec?.at ? `, остання ${dateTime(rec.at)}: перевірено ${rec.checked}, виправлено ${rec.fixed}` : ""}. Право береться з ручних видач у картці людини і з активних підписок Hub на тариф із цим ресурсом.</p>

      <div className="hdr"><h2>Цифрові продукти: боти, посилання, курси</h2></div>
      <div className="grid g2">
        {others.map((r) => { const c = (r.config ?? {}) as { note?: string; zenedu_grants?: boolean; offer_url?: string; quota_per_day?: number }; return (
          <form key={r.id} action={saveResource} className="card form"><h3>{r.name} <Pill tone={r.isActive ? "good" : "mute"}>{KINDS[r.kind] ?? r.kind}</Pill></h3>
            <input type="hidden" name="key" value={r.key} /><input type="hidden" name="kind" value={r.kind} />
            <div className="form two"><label className="field">Назва<input name="name" defaultValue={r.name} /></label><label className="field">Код<input value={r.key} disabled /></label></div>
            {r.kind === "bot_feature" && <>
              <label className="ck"><input type="checkbox" name="zenedu_grants" defaultChecked={c.zenedu_grants ?? false} /> Давати доступ усім активним підпискам ZenEdu (перехідний режим, як зараз у «Щиро»)</label>
              <div className="form two"><label className="field">Квота на день за замовчуванням<input name="quota_per_day" type="number" defaultValue={c.quota_per_day ?? ""} placeholder="0 = без ліміту" /></label><label className="field">Посилання на оффер для тих, хто без доступу<input name="offer_url" defaultValue={c.offer_url ?? ""} placeholder="https://t.me/…" /></label></div>
            </>}
            <label className="field">Нотатка<input name="note" defaultValue={c.note ?? ""} /></label>
            <div><button className="btn sm" type="submit">Зберегти</button></div>
          </form>); })}
        <form action={saveResource} className="card form"><h3>Додати ресурс</h3>
          <div className="form two"><label className="field">Код<input name="key" placeholder="test.channel" required /></label><label className="field">Назва<input name="name" placeholder="Тестовий канал" /></label></div>
          <div className="form two"><label className="field">Тип<select name="kind">{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label className="field">Нотатка<input name="note" /></label></div>
          <div><button className="btn" type="submit">Створити</button></div></form>
      </div>
    </Shell>
  );
}
