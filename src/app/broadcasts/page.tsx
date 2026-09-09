import Link from "next/link";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { Send, Eye, Copy, Pencil, XCircle, Trash2, RefreshCw, Plus, Inbox } from "lucide-react";
import { Kebab, MenuAction, MenuLink, MenuSep } from "@/components/ui/controls";
import { EmptyState } from "@/components/ui/layout";
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
        {sending && <form action={runBroadcastsNow}><button className="btn sm ghost" type="submit"><RefreshCw size={14} /> Продовжити надсилання</button></form>}
        <span className="spacer" />
        <form action={createBroadcast}><button className="btn pri" type="submit" name="name" value=""><Plus size={15} /> Нова розсилка</button></form>
      </div>
      <div className="card tbl">
        <table><thead><tr><th>Назва</th><th>Статус</th><th>Час надсилання</th><th className="num">Доставлено</th><th className="num">Клікнули</th><th></th></tr></thead><tbody>
          {list.map((b) => { const [l, tone] = STATUS_UA[b.status] ?? [b.status, ""]; const editable = b.status === "draft" || b.status === "scheduled"; return (
            <tr key={b.id}>
              <td><div className="row-actions" style={{ flexWrap: "nowrap" }}><span className="steptype"><Send size={13} /></span><div><b style={{ fontWeight: 500 }}><Link href={`/broadcasts/${b.id}`}>{b.name}</Link></b>{b.lastError && <div className="muted" style={{ fontSize: 11.5 }}>{b.lastError}</div>}</div></div></td>
              <td><Pill tone={tone}>{l}</Pill></td>
              <td className="mono">{b.status === "draft" ? "" : dateTime(b.scheduledAt ?? b.startedAt)}</td>
              <td className="num">{deliveredLabel(b)}</td>
              <td className="num">{["sent", "sending", "deleted"].includes(b.status) ? clickedLabel(b) : ""}</td>
              <td><Kebab>
                <MenuAction action={previewBroadcast} fields={{ id: b.id, step: editable ? "content" : "recipients" }} icon={<Eye />}>Перегляд: надіслати собі</MenuAction>
                <MenuAction action={duplicateBroadcast} fields={{ id: b.id }} icon={<Copy />}>Дублювати</MenuAction>
                {editable && <MenuLink href={`/broadcasts/${b.id}?step=content`} icon={<Pencil />}>Редагувати</MenuLink>}
                {b.status === "scheduled" && <MenuAction action={cancelBroadcast} fields={{ id: b.id }} icon={<XCircle />} confirm="Скасувати заплановану розсилку? Вона стане чернеткою.">Скасувати розклад</MenuAction>}
                {b.status === "sent" && <MenuAction action={deleteBroadcastFromSubscribers} fields={{ id: b.id }} icon={<Trash2 />} danger confirm={`Видалити повідомлення «${b.name}» у всіх ${b.sentCount} отримувачів? Можливо лише впродовж 48 годин після надсилання.`}>Видалити у підписників</MenuAction>}
                {b.status !== "sending" && <><MenuSep /><MenuAction action={deleteBroadcast} fields={{ id: b.id }} icon={<Trash2 />} danger confirm={`Видалити розсилку «${b.name}» з Hub? Надіслані повідомлення в людей залишаться.`}>Видалити з Hub</MenuAction></>}
              </Kebab></td>
            </tr>); })}
          {!list.length && <tr><td colSpan={6}><EmptyState icon={<Inbox size={20} />} title="Розсилок ще немає" text="Створіть першу: текст, вкладення й кнопки, потім оберіть отримувачів і час." action={<form action={createBroadcast}><button className="btn pri" type="submit" name="name" value=""><Plus size={15} /> Нова розсилка</button></form>} /></td></tr>}
        </tbody></table>
      </div>
      <p className="note">Розсилки йдуть через Hub-бот тим, хто його запустив і не заблокував. «Доставлено» = надіслано / у списку; «Клікнули» = частка отримувачів, що натиснули кнопку. Надсилання йде порціями зі швидкістю ~20 повідомлень на секунду; довгі списки дошле щохвилинний тік.</p>
    </Shell>
  );
}
