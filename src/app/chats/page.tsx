import Link from "next/link";
import Shell from "@/components/shell";
import { navCounts, chatThreads, person } from "@/lib/queries";
import { dateTime, fullName } from "@/lib/format";
import { replyToPerson } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function Chats({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const sp = await searchParams;
  const [counts, threads] = await Promise.all([navCounts(), chatThreads()]);
  const cur = sp.p ? await person(Number(sp.p)) : null;
  const msgs = cur ? cur.events.filter((e) => e.type === "bot.message" || e.type === "bot.reply").reverse() : [];
  return (
    <Shell title="Чати" counts={counts}>
      <div className="grid g12">
        <div className="card" style={{ padding: 0 }}>
          {threads.map((t) => <Link key={t.person_id} href={`?p=${t.person_id}`} style={{ display: "block", padding: "12px 16px", borderBottom: "1px solid var(--line)", textDecoration: "none", color: "var(--ink)", background: String(t.person_id) === sp.p ? "var(--orange-soft)" : undefined }}><b style={{ fontWeight: 500, display: "flex", justifyContent: "space-between" }}>{fullName({ firstName: t.first_name, lastName: t.last_name, username: t.username })}<small className="mono muted">{dateTime(t.created_at)}</small></b><div className="muted" style={{ fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.text ?? "медіа"}</div></Link>)}
          {!threads.length && <p className="muted" style={{ padding: 16 }}>Повідомлень у Hub-бот ще не було.</p>}
        </div>
        <div className="card">
          {cur ? (<>
            <div className="hdr"><h2><Link href={`/people/${cur.p.id}`}>{fullName(cur.p)}</Link></h2><span className="muted mono">tg {cur.p.telegramUserId}</span></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>{msgs.map((m) => <div key={m.id} style={{ alignSelf: m.type === "bot.reply" ? "flex-end" : "flex-start", maxWidth: "75%", padding: "8px 12px", borderRadius: 12, background: m.type === "bot.reply" ? "var(--jet)" : "var(--surface-2)", color: m.type === "bot.reply" ? "#fff" : "var(--ink)", fontSize: 13.5 }}>{String((m.payload as { text?: string })?.text ?? "медіа")}<small style={{ display: "block", opacity: .6, fontFamily: "var(--mono)", fontSize: 10.5 }}>{dateTime(m.createdAt)}</small></div>)}</div>
            <form action={replyToPerson} className="row-actions"><input type="hidden" name="personId" value={cur.p.id} /><input name="text" placeholder="Відповісти…" required style={{ flex: 1, border: "1px solid var(--line-2)", borderRadius: 9, padding: "9px 12px", font: "inherit" }} /><button className="btn pri" type="submit">Надіслати</button></form>
          </>) : <p className="muted">Оберіть діалог зліва.</p>}
        </div>
      </div>
    </Shell>
  );
}
