import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { navCounts, resourceList } from "@/lib/queries";
import { seedResources, saveResource } from "@/lib/actions";

export const dynamic = "force-dynamic";
const KINDS: Record<string, string> = { telegram_channel: "Telegram-канал", telegram_group: "Telegram-група", bot_feature: "Функція бота", external_url: "Посилання", course: "Курс" };

export default async function Resources() {
  const [counts, res] = await Promise.all([navCounts(), resourceList()]);
  return (
    <Shell title="Доступи" counts={counts}>
      <div className="hdr"><h2>Ресурси</h2>{!res.length && <form action={seedResources}><button className="btn pri" type="submit">Створити стандартні: канал, чат, «Щиро», архів</button></form>}</div>
      <div className="grid g2">
        {res.map((r) => { const c = (r.config ?? {}) as { note?: string; zenedu_grants?: boolean; offer_url?: string; quota_per_day?: number; chatId?: string }; return (
          <form key={r.id} action={saveResource} className="card form"><h3>{r.name} <Pill tone={r.isActive ? "good" : "mute"}>{KINDS[r.kind] ?? r.kind}</Pill></h3>
            <input type="hidden" name="key" value={r.key} /><input type="hidden" name="kind" value={r.kind} />
            <div className="form two"><label className="field">Назва<input name="name" defaultValue={r.name} /></label><label className="field">Код<input value={r.key} disabled /></label></div>
            {r.kind === "bot_feature" && <>
              <label className="ck"><input type="checkbox" name="zenedu_grants" defaultChecked={c.zenedu_grants ?? false} /> Давати доступ усім активним підпискам ZenEdu (перехідний режим, як зараз у «Щиро»)</label>
              <div className="form two"><label className="field">Квота на день за замовчуванням<input name="quota_per_day" type="number" defaultValue={c.quota_per_day ?? ""} placeholder="0 = без ліміту" /></label><label className="field">Посилання на оффер для тих, хто без доступу<input name="offer_url" defaultValue={c.offer_url ?? ""} placeholder="https://t.me/…" /></label></div>
            </>}
            {(r.kind === "telegram_channel" || r.kind === "telegram_group") && <label className="field">chat_id каналу або групи<input name="chatId" defaultValue={c.chatId ?? ""} placeholder="-1001234567890" /></label>}
            <label className="field">Нотатка<input name="note" defaultValue={c.note ?? ""} /></label>
            <div><button className="btn sm" type="submit">Зберегти</button></div>
          </form>); })}
        <form action={saveResource} className="card form"><h3>Додати або змінити ресурс</h3>
          <div className="form two"><label className="field">Код<input name="key" placeholder="course.diag" required /></label><label className="field">Назва<input name="name" placeholder="Діагностичний міні-курс" /></label></div>
          <div className="form two"><label className="field">Тип<select name="kind">{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label className="field">Нотатка<input name="note" placeholder="де живе, як видається" /></label></div>
          <div><button className="btn" type="submit">Зберегти</button></div></form>
      </div>
    </Shell>
  );
}
