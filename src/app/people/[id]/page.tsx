import Link from "next/link";
import { notFound } from "next/navigation";
import { X, Plus, Send, KeyRound, MessageSquare, History } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { PageHeader, Section, Field, FormRow, Row, Timeline, EmptyState, KV } from "@/components/ui/layout";
import { navCounts, person, resourceList, hubFunnels, personPayments } from "@/lib/queries";
import { Kebab, MenuAction, MenuLink } from "@/components/ui/controls";
import { subscriptionAction, refundPayment } from "@/lib/actions";
import { payLink } from "@/lib/payments";
import { Alert } from "@/components/ui/layout";
import { CreditCard, Pause, Play, XCircle, RefreshCw, Undo2 } from "lucide-react";
import { date, dateTime, fullName, money } from "@/lib/format";
import { addTag, removeTag, saveNotes, grantEntitlement, revokeEntitlement, replyToPerson, enrollToFunnel, resendInvite } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function Person({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params; const sp = await searchParams;
  const [counts, d, res, fun, pay] = await Promise.all([navCounts(), person(Number(id)), resourceList(), hubFunnels(), personPayments(Number(id))]);
  if (!d) notFound();
  const { p, subs, orders, events, identities, entitlements, memberships } = d;
  const hub = identities.find((i) => i.botKey === "hub");
  const initials = fullName(p).split(" ").map((x) => x[0]).join("").slice(0, 2);
  const period = (days: number) => days >= 360 ? "рік" : days >= 90 ? "3 міс" : days <= 14 ? "2 тижні" : "міс";
  return (
    <Shell title="Люди" counts={counts}>
      <PageHeader back="/people" backLabel="Люди" icon={<span className="avatar avatar-lg" style={{ width: 32, height: 32, fontSize: 12, borderRadius: 9 }}>{initials}</span>} title={fullName(p)}
        status={<>{hub && !hub.blockedAt ? <Pill tone="acc">Hub-бот запущено</Pill> : <Pill tone="mute">Hub-бот не запускала</Pill>}{p.zenIsBlocked ? <Pill tone="crit">заблокувала бот ZenEdu</Pill> : p.zenIsActive === false ? <Pill tone="mute">неактивна в ZenEdu</Pill> : null}</>} />
      {sp.ok && <Alert tone="ok">{sp.ok}</Alert>}{sp.err && <Alert tone="bad">{sp.err}</Alert>}
      <Section className="sec" title={undefined}>
        <div className="grid g2">
          <KV items={[
            { k: "Telegram", v: <>{p.username ? "@" + p.username + " · " : ""}id {p.telegramUserId}</>, mono: true },
            { k: "Контакти", v: [p.phone, p.email].filter(Boolean).join(" · ") || "—", mono: true },
            { k: "ZenEdu", v: p.zenSubscriberId ? `#${p.zenSubscriberId}` : "—", mono: true },
            { k: "Остання активність", v: date(p.lastActiveAt), mono: true },
          ]} />
          <div>
            <div className="fld-l" style={{ marginBottom: 6 }}>Теги</div>
            <div className="tags" style={{ alignItems: "center" }}>
              {(p.tags ?? []).map((t) => <form key={t} action={removeTag}><input type="hidden" name="personId" value={p.id} /><input type="hidden" name="tag" value={t} /><button className="tagbtn" title="Зняти тег" type="submit">{t} <X size={11} /></button></form>)}
              <form action={addTag} className="row-actions" style={{ gap: 4 }}><input type="hidden" name="personId" value={p.id} /><input name="tag" placeholder="новий тег" className="input" style={{ height: 30, width: 140, fontSize: 12.5 }} /><button className="btn sm ghost" type="submit"><Plus size={14} /> Додати</button></form>
            </div>
          </div>
        </div>
      </Section>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <Section title="Підписки" actions={pay.sub ? <Kebab label="Керувати">
            {["active", "trialing"].includes(pay.sub.status) && !pay.sub.cancelAtPeriodEnd && <MenuAction action={subscriptionAction} fields={{ id: pay.sub.id, personId: p.id, act: "cancel" }} icon={<XCircle />} confirm="Вимкнути продовження? Доступ лишиться до кінця оплаченого періоду.">Вимкнути продовження</MenuAction>}
            {(pay.sub.cancelAtPeriodEnd || ["paused", "cancelled", "expired"].includes(pay.sub.status)) && <MenuAction action={subscriptionAction} fields={{ id: pay.sub.id, personId: p.id, act: "resume" }} icon={<Play />}>Відновити</MenuAction>}
            {["active", "trialing", "past_due"].includes(pay.sub.status) && <MenuAction action={subscriptionAction} fields={{ id: pay.sub.id, personId: p.id, act: "pause" }} icon={<Pause />} confirm="Поставити на паузу? Доступ закриється одразу, списань не буде до відновлення.">Пауза</MenuAction>}
            {pay.sub.paymentMethodId && <MenuAction action={subscriptionAction} fields={{ id: pay.sub.id, personId: p.id, act: "charge" }} icon={<RefreshCw />} confirm={`Списати ${money(pay.sub.price, pay.sub.currency)} зараз?`}>Списати зараз</MenuAction>}
            {pay.plan && <MenuLink href={payLink(p.id, pay.plan.key, "card")} icon={<CreditCard />} external>Посилання на зміну картки</MenuLink>}
          </Kebab> : undefined}>
          {subs.length ? subs.map((s) => <Row key={s.id} tone={["active", "trialing", "past_due"].includes(s.status) ? "on" : "off"} title={<>{money(s.price, s.currency)} / {period(s.periodDays)} <Pill status={s.status} />{s.source === "hub" && s.cancelAtPeriodEnd && <Pill tone="warn">до кінця періоду</Pill>}</>} sub={`${s.source === "zenedu" ? "списує ZenEdu" : "списує Hub"} · до ${date(s.currentPeriodEnd)} · оплат ${s.paymentsCount} · з ${date(s.startedAt)}${s.source === "hub" && s.nextChargeAt ? ` · наступне списання ${dateTime(s.nextChargeAt)}` : ""}${s.source === "hub" && s.retryCount ? ` · невдалих спроб ${s.retryCount}` : ""}`} />)
            : <EmptyState title="Підписок немає" />}
          {pay.cards.length > 0 && <div style={{ marginTop: 10 }}>{pay.cards.map((c) => <Row key={c.id} icon={<CreditCard size={14} />} tone={c.isActive && !c.failedAt ? "on" : "off"} title={`${c.cardPan ?? "картка"} ${c.cardType ?? ""}`} sub={`${c.bank ?? ""}${c.failedAt ? " · останнє списання не пройшло" : ""} · додано ${date(c.createdAt)}`} right={pay.sub?.paymentMethodId === c.id ? <Pill tone="good">основна</Pill> : undefined} />)}</div>}
          {pay.attempts.length > 0 && <div className="tbl" style={{ marginTop: 10 }}><table><thead><tr><th>Коли</th><th>Тип</th><th className="num">Сума</th><th>Стан</th><th></th></tr></thead><tbody>{pay.attempts.slice(0, 8).map((a) => <tr key={a.id}><td className="mono">{dateTime(a.createdAt)}</td><td>{({ first: "перша оплата", renewal: "автосписання", manual: "поновлення", card: "зміна картки", migrate: "переїзд" } as Record<string, string>)[a.kind] ?? a.kind}{a.mode === "test" ? " · тест" : ""}</td><td className="num">{money(a.amount, a.currency)}</td><td><Pill tone={a.status === "approved" ? "good" : a.status === "pending" ? "warn" : a.status === "refunded" ? "moon" : "crit"}>{a.status}</Pill>{a.reason && a.status !== "approved" ? <div className="fld-h">{a.reason}</div> : null}</td><td>{a.status === "approved" && ["first", "renewal", "manual"].includes(a.kind) && <form action={refundPayment}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="back" value={`/people/${p.id}`} /><button className="btn sm ghost" type="submit"><Undo2 size={13} /> Повернути</button></form>}</td></tr>)}</tbody></table></div>}
        </Section>
        <Section title="Права доступу" description="Ручні права поверх підписки: діють до вказаної дати.">
          {entitlements.filter((e) => !e.revokedAt).map((e) => <Row key={e.id} tone={e.validUntil && e.validUntil < new Date() ? "off" : "on"} title={res.find((r) => r.key === e.resourceKey)?.name ?? e.resourceKey} sub={`до ${date(e.validUntil)} · ${e.grantedBy === "manual" ? "видано вручну" : e.grantedBy}`}
            right={<form action={revokeEntitlement}><input type="hidden" name="personId" value={p.id} /><input type="hidden" name="id" value={e.id} /><button className="btn sm danger ghost" type="submit">Забрати</button></form>} />)}
          {!entitlements.filter((e) => !e.revokedAt).length && <p className="fld-h">Ручних прав немає.</p>}
          {res.length ? (<form action={grantEntitlement} style={{ marginTop: 12 }}><input type="hidden" name="personId" value={p.id} />
            <FormRow cols={3}><Field label="Продукт"><select name="resourceKey">{res.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select></Field><Field label="На скільки днів"><input name="days" type="number" defaultValue={30} /></Field><div className="fld"><span className="fld-l">&nbsp;</span><button className="btn" type="submit"><KeyRound size={15} /> Видати доступ</button></div></FormRow></form>) : <p className="fld-h">Продукти ще не створені: <Link href="/resources">Канали і групи</Link>.</p>}
        </Section>
        <Section title="Канали і групи">
          {memberships.length ? memberships.map((m) => <Row key={m.id} tone={m.status === "joined" ? "on" : m.status === "invited" ? "warn" : "off"} title={res.find((r) => r.key === m.resourceKey)?.name ?? m.resourceKey}
            sub={`${m.status === "joined" ? `у каналі з ${date(m.joinedAt)}` : m.status === "invited" ? `посилання надіслано ${dateTime(m.invitedAt)}, діє до ${dateTime(m.inviteExpiresAt)}` : m.status === "kicked" ? `виключено ${date(m.kickedAt)}` : m.status === "left" ? `вийшла ${date(m.leftAt)}` : m.status}${m.note ? ` · ${m.note}` : ""}`}
            right={<form action={resendInvite}><input type="hidden" name="personId" value={p.id} /><input type="hidden" name="resourceKey" value={m.resourceKey} /><button className="btn sm" type="submit">Надіслати посилання ще раз</button></form>} />)
            : <EmptyState title="Ще не запрошувалась" text="Видайте право на канал вище: посилання прийде в боті протягом хвилини." />}
        </Section>
        <Section title="Платежі" description={`${orders.length} замовлень`} className="tbl">
          <table><thead><tr><th>Дата</th><th>Оффер</th><th>Тип</th><th className="num">Сума</th><th>Статус</th></tr></thead><tbody>
            {orders.map((o) => <tr key={o.id}><td className="mono">{date(o.createdAt)}</td><td>{o.offerName}</td><td className="mono">{o.type}</td><td className="num">{money(o.price, o.currency)}</td><td><Pill tone={o.status === "paid" ? "good" : "warn"}>{o.status}</Pill></td></tr>)}
            {!orders.length && <tr><td colSpan={5}><EmptyState title="Платежів немає" /></td></tr>}
          </tbody></table>
        </Section>
        <Section title="Нотатки">
          <form action={saveNotes}><input type="hidden" name="personId" value={p.id} /><Field label="Для команди"><textarea name="notes" rows={4} defaultValue={p.notes ?? ""} placeholder="Що важливо пам’ятати про цю людину" /></Field><div className="row-actions" style={{ marginTop: 10 }}><button className="btn" type="submit">Зберегти</button></div></form>
          {Object.keys(p.customFields ?? {}).length ? <div style={{ marginTop: 14 }}><KV items={Object.entries(p.customFields ?? {}).map(([k, v]) => ({ k, v: String(v) }))} /></div> : null}
          {p.utm?.length ? <p className="fld-h" style={{ marginTop: 10 }}>UTM: {p.utm.map((u) => Object.entries(u).map(([k, v]) => `${k}=${v}`).join(" ")).join("; ")}</p> : null}
        </Section>
        <Section title="Дії в Hub-боті">
          {hub && !hub.blockedAt ? <>
            <form action={replyToPerson}><input type="hidden" name="personId" value={p.id} /><Field label="Написати повідомлення"><textarea name="text" rows={3} placeholder="Повідомлення від імені клубу" required /></Field><div className="row-actions" style={{ marginTop: 10 }}><button className="btn pri" type="submit"><Send size={15} /> Надіслати</button><Link href={`/chats?p=${p.id}`} className="btn ghost"><MessageSquare size={15} /> Відкрити чат</Link></div></form>
            <div style={{ marginTop: 16 }}>{fun.length ? <form action={enrollToFunnel}><input type="hidden" name="personId" value={p.id} /><FormRow><Field label="Додати у воронку"><select name="funnelId">{fun.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field><div className="fld"><span className="fld-l">&nbsp;</span><button className="btn" type="submit"><Plus size={15} /> Додати</button></div></FormRow></form> : <p className="fld-h">Активних воронок Hub ще немає: <Link href="/funnels">створити</Link>.</p>}</div>
          </> : <EmptyState title="Людина ще не запускала Hub-бот" text="Писати їй і додавати у воронки можна буде після /start у боті. Поки що лише через ZenEdu." />}
        </Section>
      </div>
      <Section title="Історія" description={`${events.length} подій`} className="sec">
        {events.length ? <Timeline items={events.map((e) => ({ id: e.id, when: dateTime(e.createdAt), what: <><Pill tone={e.source === "zenedu" ? "" : "acc"}>{e.type}</Pill> {e.type.startsWith("bot.") && (e.payload as { text?: string })?.text ? <span className="muted">— {(e.payload as { text?: string }).text}</span> : null}</> }))} /> : <EmptyState icon={<History size={20} />} title="Подій ще немає" />}
      </Section>
    </Shell>
  );
}
