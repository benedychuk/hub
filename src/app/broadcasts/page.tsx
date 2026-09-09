import Link from "next/link";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { ConfirmSubmit } from "@/components/funnel-ui";
import { Kebab } from "@/components/kebab";
import { navCounts, broadcastList } from "@/lib/queries";
import { createBroadcast, duplicateBroadcast, cancelBroadcast, deleteBroadcastFromSubscribers, deleteBroadcast, previewBroadcast, runBroadcastsNow } from "@/lib/actions";
import { deliveredLabel, clickedLabel, STATUS_UA } from "@/lib/broadcasts";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Broadcasts({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; err?: string }> }) {
  const sp = await searchParams;
  const [counts, list] = await Promise.all([navCounts(), broadcastList({ q: sp.q, status: sp.status })]);
  const sending = list.some((b) => b.status === "sending" || b.status === "deleted" && !b.finishedAt);
  return (
    <Shell title="Розсилки" counts={counts}>
            {sp.err && <div className="alert bad">{sp.err}</div>}
      <div className="toolbar">
        <form className="search" method="get"><span className="muted">⌕</span><input name="q" defaultValue={sp.q ?? ""} placeholder="Пошук розсилки" />{sp.status && <input type="hidden" name="status" value={sp.status} />}</form>
        <form method="get" className="row-actions">{sp.q && <input type="hidden" name="q" value={sp.q} />}<select name="status" defaultValue={sp.status ?? ""} className="btn"><option value="">Статус: усі</option>{Object.entries(STATUS_UA).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select><button className="btn" type="submit">Фільтр</button></form>
        {sending && <form action={runBroadcastsNow}><button className="btn sm ghost" type="submit">⟳ Продовжити надсилання зараз</button></form>}
        <span className="spacer" />
        <form action={createBroadcast}><button className="btn pri" type="submit" name="name" value="">+ Нова розсилка</button></form>
      </div>
      <div className="card tbl">
        <table><thead><tr><th>Назва</th><th>Статус</th><th>Час надсилання</th><th className="num">Доставлено</th><th className="num">Клікнули</th><th></th></tr></thead><tbody>
          {list.map((b) => { const [l, tone] = STATUS_UA[b.status] ?? [b.status, ""]; const editable = b.status === "draft" || b.status === "scheduled"; return (
            <tr key={b.id}>
              <td><div className="row-actions" style={{ flexWrap: "nowrap" }}><span className="steptype">➤</span><div><b style={{ fontWeight: 500 }}><Link href={`/broadcasts/${b.id}`}>{b.name}</Link></b>{b.lastError && <div className="muted" style={{ fontSize: 11.5 }}>{b.lastError}</div>}</div></div></td>
              <td><Pill tone={tone}>{l}</Pill></td>
              <td className="mono">{b.status === "draft" ? "" : dateTime(b.scheduledAt ?? b.startedAt)}</td>
              <td className="num">{deliveredLabel(b)}</td>
              <td className="num">{["sent", "sending", "deleted"].includes(b.status) ? clickedLabel(b) : ""}</td>
              <td><Kebab>
                <form action={previewBroadcast}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="step" value={editable ? "content" : "recipients"} /><button type="submit">👁 Перегляд (надіслати собі)</button></form>
                <form action={duplicateBroadcast}><input type="hidden" name="id" value={b.id} /><button type="submit">⧉ Дублювати</button></form>
                {editable && <Link href={`/broadcasts/${b.id}?step=content`}>✎ Редагувати</Link>}
                {b.status === "scheduled" && <form action={cancelBroadcast}><input type="hidden" name="id" value={b.id} /><ConfirmSubmit message="Скасувати заплановану розсилку? Вона стане чернеткою.">⏹ Скасувати</ConfirmSubmit></form>}
                {b.status === "sent" && <form action={deleteBroadcastFromSubscribers}><input type="hidden" name="id" value={b.id} /><ConfirmSubmit className="danger" message={`Видалити повідомлення «${b.name}» у всіх ${b.sentCount} отримувачів? Можливо лише впродовж 48 годин після надсилання.`}>🗑 Видалити у підписників</ConfirmSubmit></form>}
                {b.status !== "sending" && <><div className="sep" /><form action={deleteBroadcast}><input type="hidden" name="id" value={b.id} /><ConfirmSubmit className="danger" message={`Видалити розсилку «${b.name}» з Hub? Надіслані повідомлення в людей залишаться.`}>✕ Видалити з Hub</ConfirmSubmit></form></>}
              </Kebab></td>
            </tr>); })}
          {!list.length && <tr><td colSpan={6} className="muted">Розсилок ще немає. Натисніть «+ Нова розсилка».</td></tr>}
        </tbody></table>
      </div>
      <p className="note">Розсилки йдуть через Hub-бот тим, хто його запустив і не заблокував. «Доставлено» = надіслано / у списку; «Клікнули» = частка отримувачів, що натиснули кнопку. Надсилання йде порціями зі швидкістю ~20 повідомлень на секунду; довгі списки дошле щохвилинний тік.</p>
    </Shell>
  );
}
