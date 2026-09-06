import Link from "next/link";
import Shell from "@/components/shell";
import { Kpi, Pill } from "@/components/ui";
import { dashboard, navCounts } from "@/lib/queries";
import { dateTime, fullName, money } from "@/lib/format";
import { hasDb } from "@/db";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [counts, d] = await Promise.all([navCounts(), dashboard()]);
  const st = Object.fromEntries((d?.byStatus ?? []).map((x) => [x.status, x.c]));
  const active = (st.active ?? 0) + (st.past_due ?? 0);
  const uah = d?.rev.find((r) => r.cur === "UAH"), usd = d?.rev.find((r) => r.cur === "USD");
  const mon = d?.monthly ?? [];
  const max = Math.max(1, ...mon.map((m) => Math.max(m.starts, m.renews)));
  return (
    <Shell title="Дашборд" counts={counts}>
      {!hasDb() && <div className="alert">База даних ще не підключена. Додайте Neon у Vercel → Storage, після деплою тут з'являться дані. <Link href="/settings">Налаштування</Link></div>}
      {hasDb() && !d?.monthly.length && <div className="alert">Даних поки немає. Запустіть імпорт із ZenEdu на сторінці <Link href="/settings">Налаштування</Link>.</div>}
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi hot title="Активні підписки" value={active} note={`trial ${st.trialing ?? 0} · past due ${st.past_due ?? 0} · пауза ${st.paused ?? 0}`} />
        <Kpi title="Зібрано за 30 днів" value={uah ? money(uah.sum, "UAH") : "—"} note={usd ? `+ ${money(usd.sum, "USD")} · ${(uah?.c ?? 0) + (usd?.c ?? 0)} платежів` : `${uah?.c ?? 0} платежів`} />
        <Kpi title="Нових підписок за 30 днів" value={d?.starts30 ?? "—"} note={d ? `попередні 30 днів: ${d.startsPrev}` : ""} tone={d && d.starts30 < d.startsPrev ? "down" : "up"} />
        <Kpi title="Запустили Hub-бот" value={d?.hubStarts ?? 0} note="людей натиснули /start у новому боті" />
      </div>
      <div className="grid g21" style={{ marginBottom: 16 }}>
        <div className="card"><h3>Нові підписки і продовження по місяцях <span className="sub">за замовленнями ZenEdu</span></h3>
          {mon.length ? (
            <div className="tbl"><table><thead><tr><th>Місяць</th><th className="num">Нові</th><th className="num">Продовження</th><th className="num">UAH</th><th style={{ width: "40%" }}></th></tr></thead><tbody>
              {mon.map((m) => (<tr key={m.m}><td className="mono">{m.m}</td><td className="num">{m.starts}</td><td className="num">{m.renews}</td><td className="num">{Number(m.uah).toLocaleString("uk-UA")}</td>
                <td><div style={{ display: "grid", gap: 3 }}><div className="bar" title="нові"><i style={{ width: `${(m.starts / max) * 100}%`, background: "var(--s1)" }} /></div><div className="bar" title="продовження"><i style={{ width: `${(m.renews / max) * 100}%` }} /></div></div></td></tr>))}
            </tbody></table></div>
          ) : <p className="muted">Немає даних.</p>}
        </div>
        <div className="card"><h3>Списання на 14 днів <span className="sub">за кінцем періоду</span></h3>
          {d?.expiring.length ? <ul className="tl">{d.expiring.map((e) => <li key={e.day}><span>{e.day.slice(5)}</span><span><b>{e.c}</b> підписок</span></li>)}</ul> : <p className="muted">Немає даних.</p>}
          <p className="note">Поки списує ZenEdu. Тут видно, коли кожна людина потрапить у вікно міграції.</p>
        </div>
      </div>
      <div className="card"><h3>Останні події</h3>
        {d?.recent.length ? <ul className="tl">{d.recent.map((e) => <li key={e.id}><span>{dateTime(e.createdAt)}</span><span><Pill tone={e.type.startsWith("zenedu") ? "" : "acc"}>{e.type}</Pill> {e.personId ? <Link href={`/people/${e.personId}`}>{fullName({ firstName: e.first, lastName: e.last, username: e.username })}</Link> : ""} {e.type === "bot.message" ? <span className="muted">— {String((e.payload as { text?: string })?.text ?? "").slice(0, 80)}</span> : null}</span></li>)}</ul> : <p className="muted">Подій ще немає. Вони з'являться після запуску бота і вебхуків ZenEdu.</p>}
      </div>
    </Shell>
  );
}
