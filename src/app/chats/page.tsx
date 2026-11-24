import Link from "next/link";
import { MessageSquare, Send, User, Trash2 } from "lucide-react";
import Shell from "@/components/shell";
import { EmptyState, Section } from "@/components/ui/layout";
import { navCounts, chatThreads, person } from "@/lib/queries";
import { dateTime, fullName } from "@/lib/format";
import { replyToPerson, deleteChatMessage } from "@/lib/actions";
import { Kebab, MenuAction } from "@/components/ui/controls";
import { Alert } from "@/components/ui/layout";

export const dynamic = "force-dynamic";

export default async function Chats({ searchParams }: { searchParams: Promise<{ p?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const [counts, threads] = await Promise.all([navCounts(), chatThreads()]);
  const cur = sp.p ? await person(Number(sp.p)) : null;
  const msgs = cur ? cur.events.filter((e) => e.type === "bot.message" || e.type === "bot.reply").reverse() : [];
  return (
    <Shell title="Чати" counts={counts}>
      {sp.ok && <Alert tone="ok">{sp.ok}</Alert>}
      {sp.err && <Alert tone="bad">{sp.err}</Alert>}
      <div className="chat">
        <div className="card chat-list">
          {threads.map((t) => <Link key={t.person_id} href={`?p=${t.person_id}`} className={String(t.person_id) === sp.p ? "on" : ""}><b>{fullName({ firstName: t.first_name, lastName: t.last_name, username: t.username })}<small>{dateTime(t.created_at)}</small></b><p>{t.text ?? "медіа"}</p></Link>)}
          {!threads.length && <EmptyState icon={<MessageSquare size={20} />} title="Повідомлень ще не було" text="Тут з’являться діалоги з тими, хто пише в Hub-бот." />}
        </div>
        {cur ? (
          <Section title={<Link href={`/people/${cur.p.id}`}>{fullName(cur.p)}</Link>} description={`@${cur.p.username ?? "—"} · id ${cur.p.telegramUserId}`} actions={<Link href={`/people/${cur.p.id}`} className="btn sm"><User size={15} /> Картка</Link>}>
            <div className="chat-msgs">{msgs.map((m) => { const pl = (m.payload ?? {}) as { text?: string; message_id?: number; deleted_at?: string }; const mine = m.type === "bot.reply";
              // видалити можна наші повідомлення, номер яких у Telegram відомий; Telegram дозволяє це лише 48 годин
              const canDelete = mine && pl.message_id && !pl.deleted_at && Date.now() - new Date(m.createdAt).getTime() < 48 * 3600_000;
              return <div key={m.id} className={`msg ${mine ? "me" : ""} ${pl.deleted_at ? "deleted" : ""}`}>
                {canDelete && <span className="msg-menu"><Kebab><MenuAction action={deleteChatMessage} fields={{ eventId: m.id }} icon={<Trash2 />} danger confirm="Видалити це повідомлення в Telegram у людини? Скасувати не можна.">Видалити в Telegram</MenuAction></Kebab></span>}
                {String(pl.text ?? "медіа")}<small>{dateTime(m.createdAt)}{m.source === "assistant" ? " · асистентка" : ""}{pl.deleted_at ? ` · видалено в Telegram ${dateTime(pl.deleted_at)}` : ""}</small></div>; })}{!msgs.length && <EmptyState title="Повідомлень ще немає" />}</div>
            <form action={replyToPerson} className="row-actions"><input type="hidden" name="personId" value={cur.p.id} /><input name="text" placeholder="Відповісти від імені клубу" required className="input" style={{ flex: 1 }} /><button className="btn pri" type="submit"><Send size={15} /> Надіслати</button></form>
          </Section>
        ) : <div className="card"><EmptyState icon={<MessageSquare size={20} />} title="Оберіть діалог" text="Список зліва: останні повідомлення з Hub-бота." /></div>}
      </div>
    </Shell>
  );
}
