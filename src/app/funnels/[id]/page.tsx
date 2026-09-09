import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { navCounts, funnelDetail, botList, mediaList, hubFunnels } from "@/lib/queries";
import { saveFunnel, deleteFunnel, addStep, saveStep, deleteStep, moveStep, testFunnelOnMe, stopFunnelEnrollment, runTickNow } from "@/lib/actions";
import { dateTime, fullName } from "@/lib/format";
import type { StepConfig } from "@/lib/funnels";

export const dynamic = "force-dynamic";
const UNITS: Record<string, string> = { minutes: "хвилин", hours: "годин", days: "днів" };

export default async function FunnelEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [counts, d, bl, med, allFun] = await Promise.all([navCounts(), funnelDetail(Number(id)), botList(), mediaList(), hubFunnels()]);
  const LABEL: Record<string, string> = { video_note: "кружечок", photo: "фото", video: "відео", animation: "GIF", voice: "голосове", audio: "аудіо", document: "файл", sticker: "стікер" };
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
          {steps.map((st, i) => { const c = (st.config ?? {}) as StepConfig; const sc = stat(st.id); const atStr = c.at ? `${String(c.at.hour).padStart(2, "0")}:${String(c.at.minute).padStart(2, "0")}` : "12:00"; return (
            <form key={st.id} action={saveStep} className="card form" style={{ marginBottom: 12 }}>
              <input type="hidden" name="id" value={st.id} /><input type="hidden" name="funnelId" value={f.id} />
              <h3><span>Крок {i + 1} <span className="sub">отримали {sc?.sent ?? 0} · кліки {sc?.clicked ?? 0} · чекають {wait(st.position)}</span></span>
                <span className="row-actions"><button className="btn sm ghost" formAction={moveStep} name="dir" value="up" type="submit" disabled={i === 0}>↑</button><button className="btn sm ghost" formAction={moveStep} name="dir" value="down" type="submit" disabled={i === steps.length - 1}>↓</button><button className="btn sm danger ghost" formAction={deleteStep} type="submit">Видалити</button></span></h3>
              <div className="form two"><label className="field">Назва кроку<input name="title" defaultValue={st.title ?? ""} /></label>
                <label className="field">Медіа з бібліотеки<select name="mediaId" defaultValue={c.mediaId ?? ""}><option value="">Без медіа</option>{med.map((m) => <option key={m.id} value={m.id}>#{m.id} {LABEL[m.kind] ?? m.kind}{m.title ? " · " + m.title : m.caption ? " · " + m.caption.slice(0, 30) : ""}{m.duration ? ` · ${m.duration} с` : ""}</option>)}</select></label></div>
              <div className="form two">
                <label className="field">Коли надсилати<select name="timing" defaultValue={c.timing ?? "delay"}><option value="delay">Після попереднього кроку через затримку</option><option value="at">О конкретній годині (після затримки, за Києвом)</option></select></label>
                <label className="field">Затримка · година<div style={{ display: "flex", gap: 6 }}><input name="delayValue" type="number" min={0} defaultValue={c.delay?.value ?? 0} style={{ width: 70 }} /><select name="delayUnit" defaultValue={c.delay?.unit ?? "days"}>{Object.entries(UNITS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><input name="atTime" type="time" defaultValue={atStr} style={{ width: 110 }} /></div></label></div>
              <label className="field">Текст: до 4096 знаків, або підпис до медіа до 1024; для кружечка текст іде окремим повідомленням<textarea name="body" rows={5} defaultValue={st.body ?? ""} /></label>
              <label className="field">Тег за отримання кроку (порожньо = автотег fn:назва:sN)<input name="tag" defaultValue={c.tag ?? ""} placeholder={`Перегляд: ${st.title ?? "крок " + (i + 1)}`} /></label>
              <div className="field">Кнопки: текст, дія, ціль, тег за клік</div>
              {[0, 1, 2].map((k) => { const b = c.buttons?.[k]; const kind = b?.kind ?? (b?.url ? "url" : "next"); return (
                <div key={k} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1.2fr 1fr", gap: 6 }}>
                  <input name={`btnText${k}`} defaultValue={b?.text ?? ""} placeholder={`Кнопка ${k + 1}`} style={{ border: "1px solid var(--line-2)", borderRadius: 8, padding: "6px 9px" }} />
                  <select name={`btnKind${k}`} defaultValue={kind} style={{ border: "1px solid var(--line-2)", borderRadius: 8, padding: "6px 9px" }}><option value="url">Посилання</option><option value="next">Наступний крок одразу</option><option value="goto">Перейти до кроку №</option><option value="funnel">Запустити воронку (id)</option><option value="offer">Оффер / оплата (посилання)</option><option value="tag">Лише тег</option></select>
                  <input name={`btnTarget${k}`} defaultValue={b?.url ?? b?.target ?? ""} placeholder="https://… · № кроку · id воронки" style={{ border: "1px solid var(--line-2)", borderRadius: 8, padding: "6px 9px" }} />
                  <input name={`btnTag${k}`} defaultValue={b?.tag ?? ""} placeholder="тег за клік (авто)" style={{ border: "1px solid var(--line-2)", borderRadius: 8, padding: "6px 9px" }} />
                </div>); })}
              <div className="row-actions" style={{ gap: 16 }}>
                <label className="ck"><input type="checkbox" name="quietHours" defaultChecked={c.quietHours ?? true} /> не надсилати 22:00–09:00</label>
                <label className="ck"><input type="checkbox" name="protect" defaultChecked={c.protect ?? false} /> захист контенту</label>
                <label className="ck"><input type="checkbox" name="preview" defaultChecked={c.disablePreview === false} /> прев’ю посилань</label>
              </div>
              <div><button className="btn sm pri" type="submit">Зберегти крок</button></div>
            </form>); })}
          <form action={addStep}><input type="hidden" name="funnelId" value={f.id} /><button className="btn" type="submit">+ Додати крок «повідомлення»</button></form>
          <p className="note">Воронки Hub для кнопки «Запустити воронку»: {allFun.map((x) => `${x.name} = ${x.id}`).join(" · ") || "—"}. Слово «стоп» у боті зупиняє всі активні воронки людини.</p>
        </div>
      </div>
    </Shell>
  );
}
