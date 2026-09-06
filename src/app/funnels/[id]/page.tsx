import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { navCounts, funnelDetail, botList } from "@/lib/queries";
import { saveFunnel, deleteFunnel, addStep, saveStep, deleteStep, moveStep, testFunnelOnMe, stopFunnelEnrollment, runTickNow } from "@/lib/actions";
import { dateTime, fullName } from "@/lib/format";
import type { StepConfig } from "@/lib/funnels";

export const dynamic = "force-dynamic";
const UNITS: Record<string, string> = { minutes: "хвилин", hours: "годин", days: "днів" };

export default async function FunnelEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [counts, d, bl] = await Promise.all([navCounts(), funnelDetail(Number(id)), botList()]);
  if (!d) notFound();
  const { f, steps, stats, enr, waiting } = d;
  const s = (f.settings ?? {}) as { entryKind?: string; entryValue?: string };
  const stat = (sid: number) => stats.find((x) => x.stepId === sid);
  const wait = (pos: number) => waiting.find((x) => x.pos === pos)?.c ?? 0;
  const botUser = bl.find((b) => b.key === "hub")?.username;
  return (
    <Shell title={`Воронка: ${f.name}`} counts={counts}>
      <div className="grid g12">
        <div>
          <form action={saveFunnel} className="card form" style={{ marginBottom: 16 }}><input type="hidden" name="id" value={f.id} />
            <h3>Налаштування <Pill tone={f.isActive ? "good" : "mute"}>{f.isActive ? "активна" : "вимкнена"}</Pill></h3>
            <label className="field">Назва<input name="name" defaultValue={f.name} required /></label>
            <label className="field">Вхід<select name="entryKind" defaultValue={s.entryKind ?? "manual"}><option value="manual">Вручну з картки людини</option><option value="start">Посилання на бот із параметром</option><option value="keyword">Ключове слово в боті</option></select></label>
            <label className="field">Параметр посилання або слова через кому<input name="entryValue" defaultValue={s.entryValue ?? ""} placeholder="promo_sep або стоп, відписка" /></label>
            {s.entryKind === "start" && s.entryValue && <p className="note mono">t.me/{botUser ?? "<бот>"}?start={s.entryValue}</p>}
            <div className="ck"><input type="checkbox" name="isActive" defaultChecked={f.isActive} /> Воронка активна</div>
            <div className="row-actions"><button className="btn pri" type="submit">Зберегти</button></div>
          </form>
          <div className="card" style={{ marginBottom: 16 }}><h3>Дії</h3>
            <div className="row-actions">
              <form action={testFunnelOnMe}><input type="hidden" name="funnelId" value={f.id} /><button className="btn" type="submit" disabled={!f.isActive}>Тест собі</button></form>
              <form action={runTickNow}><button className="btn ghost" type="submit">Надіслати належні кроки зараз</button></form>
              <form action={deleteFunnel}><input type="hidden" name="id" value={f.id} /><button className="btn danger ghost" type="submit">Видалити воронку</button></form>
            </div>
            <p className="note">Тест надсилає воронку на ваш ADMIN_TELEGRAM_ID, якщо ви натискали /start у Hub-боті. Кроки із затримкою відправляє щохвилинний тік; без нього кнопка «надіслати зараз».</p>
          </div>
          <div className="card"><h3>Проходження <span className="sub">{enr.length}</span></h3>
            {enr.map(({ e, p }) => <div key={e.id} className="ent"><span className={`dot ${e.status === "active" ? "" : "off"}`} /><div><b><Link href={`/people/${p.id}`}>{fullName(p)}</Link></b><small>{e.status} · крок {steps.findIndex((x) => x.position >= e.nextPosition) + 1 || "—"} · далі {dateTime(e.nextAt)}{e.stopReason ? " · " + e.stopReason : ""}</small></div>{e.status === "active" && <form action={stopFunnelEnrollment}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="funnelId" value={f.id} /><button className="btn sm ghost" type="submit">Зупинити</button></form>}</div>)}
            {!enr.length && <p className="muted">Ще ніхто не проходив.</p>}
          </div>
        </div>
        <div>
          {steps.map((st, i) => { const c = (st.config ?? {}) as StepConfig; const sc = stat(st.id); return (
            <form key={st.id} action={saveStep} className="card form" style={{ marginBottom: 12 }}>
              <input type="hidden" name="id" value={st.id} /><input type="hidden" name="funnelId" value={f.id} />
              <h3><span>Крок {i + 1} <span className="sub">отримали {sc?.sent ?? 0} · кліки {sc?.clicked ?? 0} · чекають {wait(st.position)}</span></span>
                <span className="row-actions"><button className="btn sm ghost" formAction={moveStep} name="dir" value="up" type="submit" disabled={i === 0}>↑</button><button className="btn sm ghost" formAction={moveStep} name="dir" value="down" type="submit" disabled={i === steps.length - 1}>↓</button><button className="btn sm danger ghost" formAction={deleteStep} type="submit">Видалити</button></span></h3>
              <div className="form two"><label className="field">Назва кроку<input name="title" defaultValue={st.title ?? ""} /></label>
                <label className="field">Затримка після попереднього кроку<div style={{ display: "flex", gap: 6 }}><input name="delayValue" type="number" min={0} defaultValue={c.delay?.value ?? 0} style={{ width: 90 }} /><select name="delayUnit" defaultValue={c.delay?.unit ?? "days"}>{Object.entries(UNITS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div></label></div>
              <label className="field">Текст (до 4096 знаків)<textarea name="body" rows={5} defaultValue={st.body ?? ""} required /></label>
              <div className="field">Кнопки: текст і посилання; без посилання це кнопка-відповідь, клік рахується</div>
              {[0, 1, 2].map((k) => <div key={k} className="form two" style={{ gap: 6 }}><input name={`btnText${k}`} defaultValue={c.buttons?.[k]?.text ?? ""} placeholder={`Кнопка ${k + 1}`} style={{ border: "1px solid var(--line-2)", borderRadius: 8, padding: "6px 9px" }} /><input name={`btnUrl${k}`} defaultValue={c.buttons?.[k]?.url ?? ""} placeholder="https://…" style={{ border: "1px solid var(--line-2)", borderRadius: 8, padding: "6px 9px" }} /></div>)}
              <div className="row-actions" style={{ gap: 16 }}>
                <label className="ck"><input type="checkbox" name="quietHours" defaultChecked={c.quietHours ?? true} /> не надсилати 22:00–09:00</label>
                <label className="ck"><input type="checkbox" name="protect" defaultChecked={c.protect ?? false} /> захист контенту</label>
                <label className="ck"><input type="checkbox" name="preview" defaultChecked={c.disablePreview === false} /> прев’ю посилань</label>
              </div>
              <div><button className="btn sm pri" type="submit">Зберегти крок</button></div>
            </form>); })}
          <form action={addStep}><input type="hidden" name="funnelId" value={f.id} /><button className="btn" type="submit">+ Додати крок «повідомлення»</button></form>
          <p className="note">Медіа, умови, запитання і дії у кроках будуть наступним кроком розробки.</p>
        </div>
      </div>
    </Shell>
  );
}
