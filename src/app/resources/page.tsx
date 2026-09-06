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
        {res.map((r) => <div key={r.id} className="card"><h3>{r.name} <Pill tone={r.isActive ? "good" : "mute"}>{KINDS[r.kind] ?? r.kind}</Pill></h3><div className="mono muted">{r.key}</div>{(r.config as { note?: string })?.note && <p className="note">{(r.config as { note?: string }).note}</p>}<p className="note">Керування членством у каналі і перевірка права для «Щиро» підключаються на етапі 1.</p></div>)}
        <form action={saveResource} className="card form"><h3>Додати або змінити ресурс</h3>
          <div className="form two"><label className="field">Код<input name="key" placeholder="course.diag" required /></label><label className="field">Назва<input name="name" placeholder="Діагностичний міні-курс" /></label></div>
          <div className="form two"><label className="field">Тип<select name="kind">{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label className="field">Нотатка<input name="note" placeholder="де живе, як видається" /></label></div>
          <div><button className="btn" type="submit">Зберегти</button></div></form>
      </div>
    </Shell>
  );
}
