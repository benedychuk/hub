import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { navCounts, person, resourceList, hubFunnels } from "@/lib/queries";
import { date, dateTime, fullName, money } from "@/lib/format";
import { addTag, removeTag, saveNotes, grantEntitlement, revokeEntitlement, replyToPerson, enrollToFunnel } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function Person({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [counts, d, res, fun] = await Promise.all([navCounts(), person(Number(id)), resourceList(), hubFunnels()]);
  if (!d) notFound();
  const { p, subs, orders, events, identities, entitlements } = d;
  const hub = identities.find((i) => i.botKey === "hub");
  const initials = fullName(p).split(" ").map((x) => x[0]).join("").slice(0, 2);
  return (
    <Shell title={fullName(p)} counts={counts}>
      <div className="card" style={{ marginBottom: 16, display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div className="avatar">{initials}</div>
        <div style={{ flex: 1 }}>
          <div className="mono muted">{p.username ? "@" + p.username + " · " : ""}tg {p.telegramUserId}{p.phone ? " · " + p.phone : ""}{p.email ? " · " + p.email : ""}{p.zenSubscriberId ? ` · ZenEdu #${p.zenSubscriberId}` : ""}</div>
          <div className="tags" style={{ marginTop: 8, alignItems: "center" }}>
            {(p.tags ?? []).map((t) => <form key={t} action={removeTag} style={{ display: "inline" }}><input type="hidden" name="personId" value={p.id} /><input type="hidden" name="tag" value={t} /><button className="tag" title="Зняти тег" type="submit">{t} ✕</button></form>)}
            <form action={addTag} style={{ display: "inline-flex", gap: 4 }}><input type="hidden" name="personId" value={p.id} /><input name="tag" placeholder="+ тег" style={{ border: "1px solid var(--line-2)", borderRadius: 6, padding: "1px 6px", fontSize: 12, width: 110 }} /><button className="btn sm ghost" type="submit">Додати</button></form>
          </div>
        </div>
        <div className="row-actions">
          {hub && !hub.blockedAt ? <Pill tone="acc">Hub-бот: активна</Pill> : <Pill tone="mute">Hub-бот: не запускала</Pill>}
          {p.zenIsBlocked ? <Pill tone="crit">заблокувала бот ZenEdu</Pill> : p.zenIsActive === false ? <Pill tone="mute">неактивна в ZenEdu</Pill> : null}
        </div>
      </div>
      <div className="grid g2">
        <div className="card"><h3>Підписки</h3>
          {subs.length ? subs.map((s) => (<div key={s.id} className="ent"><span className={`dot ${["active", "trialing", "past_due"].includes(s.status) ? "" : "off"}`} /><div><b>{money(s.price, s.currency)} / {s.periodDays >= 360 ? "рік" : s.periodDays >= 90 ? "3 міс" : s.periodDays <= 14 ? "2 тижні" : "міс"} <Pill status={s.status} /></b><small>до {date(s.currentPeriodEnd)} · оплат {s.paymentsCount} · з {date(s.startedAt)} · {s.source === "zenedu" ? "списує ZenEdu" : "списує Hub"}</small></div></div>))
            : <p className="muted">Підписок немає.</p>}
          <p className="note">Пауза, перенесення списання і скасування з'являться, коли підписка переїде в Hub.</p>
        </div>
        <div className="card"><h3>Права доступу <span className="sub">ручні, поверх підписки</span></h3>
          {entitlements.filter((e) => !e.revokedAt).map((e) => (<div key={e.id} className="ent"><span className={`dot ${e.validUntil && e.validUntil < new Date() ? "off" : ""}`} /><div><b>{res.find((r) => r.key === e.resourceKey)?.name ?? e.resourceKey}</b><small>{e.resourceKey} · до {date(e.validUntil)} · {e.grantedBy}</small></div>
            <form action={revokeEntitlement}><input type="hidden" name="personId" value={p.id} /><input type="hidden" name="id" value={e.id} /><button className="btn sm danger" type="submit">Забрати</button></form></div>))}
          {res.length ? (<form action={grantEntitlement} className="row-actions" style={{ marginTop: 10 }}><input type="hidden" name="personId" value={p.id} />
            <select name="resourceKey" className="btn sm">{res.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select>
            <input name="days" type="number" defaultValue={30} className="btn sm" style={{ width: 80 }} /> <span className="muted">днів</span>
            <button className="btn sm pri" type="submit">Видати доступ</button></form>) : <p className="note">Ресурси ще не створені: <Link href="/resources">Доступи</Link>.</p>}
        </div>
        <div className="card"><h3>Платежі <span className="sub">{orders.length}</span></h3>
          <div className="tbl"><table><thead><tr><th>Дата</th><th>Оффер</th><th>Тип</th><th className="num">Сума</th><th>Статус</th></tr></thead><tbody>
            {orders.map((o) => <tr key={o.id}><td className="mono">{date(o.createdAt)}</td><td>{o.offerName}</td><td className="mono">{o.type}</td><td className="num">{money(o.price, o.currency)}</td><td><Pill tone={o.status === "paid" ? "good" : "warn"}>{o.status}</Pill></td></tr>)}
            {!orders.length && <tr><td colSpan={5} className="muted">Платежів немає.</td></tr>}
          </tbody></table></div>
        </div>
        <div className="card"><h3>Нотатки</h3>
          <form action={saveNotes} className="form"><input type="hidden" name="personId" value={p.id} /><textarea name="notes" rows={4} defaultValue={p.notes ?? ""} className="field" style={{ width: "100%", border: "1px solid var(--line-2)", borderRadius: 9, padding: 8 }} placeholder="Нотатка для команди…" /><div><button className="btn sm" type="submit">Зберегти</button></div></form>
          {Object.keys(p.customFields ?? {}).length ? <dl className="kv" style={{ marginTop: 12 }}>{Object.entries(p.customFields ?? {}).map(([k, v]) => <><dt key={k + "k"}>{k}</dt><dd key={k + "v"}>{String(v)}</dd></>)}</dl> : null}
          {p.utm?.length ? <p className="note">UTM: {p.utm.map((u) => Object.entries(u).map(([k, v]) => `${k}=${v}`).join(" ")).join("; ")}</p> : null}
        </div>
        <div className="card"><h3>Додати у воронку Hub</h3>
          {hub && !hub.blockedAt ? (fun.length ? <form action={enrollToFunnel} className="row-actions"><input type="hidden" name="personId" value={p.id} /><select name="funnelId" className="btn sm">{fun.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select><button className="btn sm pri" type="submit">Додати</button></form> : <p className="muted">Активних воронок Hub ще немає: <Link href="/funnels">створити</Link>.</p>) : <p className="muted">Людина ще не запускала Hub-бот.</p>}
        </div>
        <div className="card"><h3>Написати в Hub-боті</h3>
          {hub && !hub.blockedAt ? <form action={replyToPerson} className="form"><input type="hidden" name="personId" value={p.id} /><textarea name="text" rows={3} className="field" style={{ width: "100%", border: "1px solid var(--line-2)", borderRadius: 9, padding: 8 }} placeholder="Повідомлення…" required /><div><button className="btn sm pri" type="submit">Надіслати</button></div></form>
            : <p className="muted">Людина ще не запускала Hub-бот, тому писати їй можна лише через ZenEdu.</p>}
        </div>
        <div className="card"><h3>Історія <span className="sub">{events.length}</span></h3>
          <ul className="tl">{events.map((e) => <li key={e.id}><span>{dateTime(e.createdAt)}</span><span><Pill tone={e.source === "zenedu" ? "" : "acc"}>{e.type}</Pill> {e.type.startsWith("bot.") && (e.payload as { text?: string })?.text ? <span className="muted">— {(e.payload as { text?: string }).text}</span> : null}</span></li>)}{!events.length && <li><span></span><span className="muted">Подій ще немає.</span></li>}</ul>
        </div>
      </div>
    </Shell>
  );
}
