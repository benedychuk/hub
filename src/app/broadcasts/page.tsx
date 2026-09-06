import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { navCounts, broadcastList } from "@/lib/queries";
import { createBroadcast, sendBroadcastNow, identitiesCount } from "@/lib/actions";
import { dateTime } from "@/lib/format";
import { hasDb } from "@/db";

export const dynamic = "force-dynamic";

export default async function Broadcasts() {
  const [counts, list] = await Promise.all([navCounts(), broadcastList()]);
  const hubCount = hasDb() ? await identitiesCount().catch(() => 0) : 0;
  return (
    <Shell title="Розсилки" counts={counts}>
      <div className="alert">Розсилки йдуть лише через Hub-бот тим, хто його запустив: зараз це {hubCount} людей. Учасниці в ZenEdu отримують розсилки, як і раніше, з ZenEdu.</div>
      <div className="grid g12">
        <div className="card tbl"><h3>Історія</h3><table><thead><tr><th>Назва</th><th>Аудиторія</th><th className="num">Надіслано</th><th className="num">Помилок</th><th>Стан</th><th></th></tr></thead><tbody>
          {list.map((b) => <tr key={b.id}><td>{b.name}<div className="muted" style={{ fontSize: 12 }}>{b.text.slice(0, 70)}</div></td><td className="mono">{(b.audience as { kind?: string }).kind}</td><td className="num">{b.sentCount}</td><td className="num">{b.failedCount}{b.lastError && <div className="muted" style={{ fontSize: 11, whiteSpace: "normal", maxWidth: 220 }}>{b.lastError}</div>}</td><td><Pill tone={b.status === "sent" ? "good" : b.status === "scheduled" ? "moon" : b.status === "failed" ? "crit" : "warn"}>{b.status}{b.scheduledAt ? " · " + dateTime(b.scheduledAt) : ""}</Pill></td>
            <td>{b.status !== "sent" && <form action={sendBroadcastNow}><input type="hidden" name="id" value={b.id} /><button className="btn sm" type="submit">Надіслати зараз</button></form>}</td></tr>)}
          {!list.length && <tr><td colSpan={6} className="muted">Розсилок ще не було.</td></tr>}
        </tbody></table></div>
        <form action={createBroadcast} className="card form"><h3>Нова розсилка</h3>
          <label className="field">Назва<input name="name" placeholder="Ефір у вівторок" /></label>
          <label className="field">Аудиторія<select name="audience"><option value="hub_test">Тест: лише мені (ADMIN_TELEGRAM_ID)</option><option value="hub_all">Усі, хто запустив Hub-бот</option><option value="hub_active">Активні підписки, які запустили Hub-бот</option></select></label>
          <label className="field">Текст (до 4096 знаків)<textarea name="text" rows={6} required placeholder="Дівчата, у вівторок о 19:00 ефір…" /></label>
          <div className="form two"><label className="field">Кнопка: текст<input name="btnText" placeholder="Поставити питання" /></label><label className="field">Кнопка: посилання<input name="btnUrl" placeholder="https://t.me/…" /></label></div>
          <div className="form two"><label className="field">Коли<select name="when"><option value="now">Зараз</option><option value="later">У дату й час (Київ)</option></select></label><label className="field">Дата й час<input name="at" type="datetime-local" /></label></div>
          <div className="ck"><input type="checkbox" name="protect" /> Захист від пересилання і збереження</div>
          <div className="ck"><input type="checkbox" name="preview" /> Показувати прев’ю посилань</div>
          <div><button className="btn pri" type="submit">Надіслати / запланувати</button></div>
          <p className="note">Заплановані розсилки відправляються щоденним cron о 04:00 або кнопкою «Надіслати зараз». Точний час доставки з'явиться разом із чергою на етапі 2.</p>
        </form>
      </div>
    </Shell>
  );
}
