import Link from "next/link";
import { Send, CheckCircle2, Undo2, Users } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { Section, Stat, Row, Timeline, EmptyState, Alert } from "@/components/ui/layout";
import { navCounts, migration, migrationList } from "@/lib/queries";
import { planKeys, sendMigrateInvite, markZenCancelled } from "@/lib/actions";
import { paymentSettings } from "@/lib/payments";
import { money, date, dateTime, fullName } from "@/lib/format";
import { hasDb } from "@/db";

export const dynamic = "force-dynamic";

export default async function Migration({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; f?: string }> }) {
  const sp = await searchParams;
  const [counts, m, list, plansL, st] = await Promise.all([navCounts(), migration(), migrationList(), hasDb() ? planKeys().catch(() => []) : [], hasDb() ? paymentSettings() : { migrationDays: 5 }]);
  const zenActive = (m?.bySource ?? []).filter((x) => x.source === "zenedu" && ["active", "trialing", "past_due"].includes(x.status)).reduce((a, x) => a + x.c, 0);
  const hubActive = (m?.bySource ?? []).filter((x) => x.source === "hub" && ["active", "trialing", "past_due"].includes(x.status)).reduce((a, x) => a + x.c, 0);
  const max = Math.max(1, ...(m?.cal ?? []).map((c) => c.c));
  const plan = plansL[0];
  const f = sp.f ?? "todo";
  const rows = list.filter((r) => f === "todo" ? !r.hub_id : f === "linked" ? Boolean(r.hub_id) && !r.zen_cancelled_at : f === "done" ? Boolean(r.zen_cancelled_at) : true);
  const linked = list.filter((r) => r.hub_id).length, toCancel = list.filter((r) => r.hub_id && !r.zen_cancelled_at).length, noBot = list.filter((r) => !r.in_hub).length;
  return (
    <Shell title="Міграція з ZenEdu" counts={counts}>
      {sp.ok && <Alert tone="ok">{sp.ok}</Alert>}{sp.err && <Alert tone="bad">{sp.err}</Alert>}
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Активних у ZenEdu" value={zenActive} hint="списує ZenEdu" />
        <Stat label="Прив’язали картку в Hub" value={linked} hint="наступне списання вже в Hub" tone="good" />
        <Stat label="Скасувати в ZenEdu" value={toCancel} hint="інакше спишуть двічі" tone={toCancel ? "warn" : undefined} />
        <Stat label="Не запускали Hub-бот" value={noBot} hint="їм запрошення не дійде" tone={noBot ? "crit" : undefined} />
      </div>
      <Section title="Як проходить переїзд" description={`Щодня Hub запрошує тих, у кого списання в ZenEdu за ${st.migrationDays} дн, прив’язати картку. Після прив’язки наступне списання йде в Hub за тією ж ціною і датою. Ваш крок: скасувати підписку цієї людини в ZenEdu до дати списання, щоб не списати двічі.`} className="sec">
        <div className="chips">{[["todo", "Ще не перейшли"], ["linked", "Скасувати в ZenEdu"], ["done", "Завершено"], ["all", "Усі"]].map(([k, l]) => <Link key={k} href={`/migration?f=${k}`} className={`chip ${f === k ? "on" : ""}`}>{l}</Link>)}<span className="chips-r">{rows.length}</span></div>
        <div className="tbl"><table><thead><tr><th>Людина</th><th>Підписка ZenEdu</th><th>Списання</th><th>Hub-бот</th><th>Запрошення</th><th>Картка в Hub</th><th></th></tr></thead><tbody>
          {rows.map((r) => <tr key={r.id}>
            <td><Link href={`/people/${r.person_id}`} className="lnk-ink">{fullName({ firstName: r.first_name, lastName: r.last_name, username: r.username })}</Link></td>
            <td>{money(r.price, r.currency)} <Pill status={r.status} /></td>
            <td className="mono">{r.current_period_end ? date(r.current_period_end) : "—"}</td>
            <td>{r.in_hub ? <Pill tone="good">запущено</Pill> : <Pill tone="mute">ні</Pill>}</td>
            <td className="mono">{r.invited_at ? dateTime(r.invited_at) : "—"}</td>
            <td>{r.hub_id ? <><Pill tone="good">{r.card ?? "є"}</Pill>{r.hub_next && <div className="fld-h">Hub спише {date(r.hub_next)}</div>}</> : <Pill tone="mute">немає</Pill>}</td>
            <td className="row-actions" style={{ flexWrap: "nowrap" }}>
              {!r.hub_id && r.in_hub && plan && <form action={sendMigrateInvite}><input type="hidden" name="personId" value={r.person_id} /><input type="hidden" name="planKey" value={plan.key} /><button className="btn sm" type="submit"><Send size={13} /> {r.invited_at ? "Ще раз" : "Запросити"}</button></form>}
              {r.hub_id && !r.zen_cancelled_at && <form action={markZenCancelled}><input type="hidden" name="id" value={r.hub_id} /><button className="btn sm pri" type="submit"><CheckCircle2 size={13} /> Скасовано в ZenEdu</button></form>}
              {r.hub_id && r.zen_cancelled_at && <form action={markZenCancelled}><input type="hidden" name="id" value={r.hub_id} /><input type="hidden" name="undo" value="1" /><button className="btn sm ghost" type="submit"><Undo2 size={13} /> Повернути</button></form>}
            </td>
          </tr>)}
          {!rows.length && <tr><td colSpan={7}><EmptyState icon={<Users size={20} />} title="Нікого в цьому списку" /></td></tr>}
        </tbody></table></div>
        {!plan && <p className="fld-h" style={{ marginTop: 10 }}>Щоб запрошувати, потрібен хоча б один активний тариф у розділі «Тарифи й оффери».</p>}
      </Section>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <Section title="Календар списань ZenEdu" description="Кінець періоду активних підписок: коли кожна людина потрапить у вікно переїзду.">
          {m?.cal.length ? <Timeline items={m.cal.map((c) => ({ id: c.day, when: c.day, what: <span className="row-actions" style={{ flexWrap: "nowrap" }}><b style={{ width: 36 }}>{c.c}</b><span className="bar" style={{ flex: 1 }}><i style={{ width: `${(c.c / max) * 100}%` }} /></span></span> }))} /> : <EmptyState title="Немає даних" />}
        </Section>
        <div className="form">
          <Section title="Ціни активних підписок" description="Зберігаються при переїзді." className="tbl">
            <table><thead><tr><th>Ціна</th><th className="num">Підписок</th></tr></thead><tbody>{(m?.prices ?? []).map((p, i) => <tr key={i}><td>{money(p.price, p.currency)}</td><td className="num">{p.c}</td></tr>)}</tbody></table>
          </Section>
          <Section title="Стан джерел">
            <Row title="ZenEdu API" sub="імпорт замовлень і підписників" />
            <Row tone={process.env.ZENEDU_WEBHOOK_SECRET ? "on" : "warn"} title="Вебхуки ZenEdu" sub="адреса у Налаштуваннях; вмикається в ZenEdu → Workspace → API & Webhooks" />
            <Row tone={hubActive ? "on" : "warn"} title="WayForPay в Hub" sub={`активних підписок Hub: ${hubActive}`} />
          </Section>
        </div>
      </div>
    </Shell>
  );
}
