import Shell from "@/components/shell";
import { Kpi } from "@/components/ui";
import { navCounts, migration } from "@/lib/queries";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Migration() {
  const [counts, m] = await Promise.all([navCounts(), migration()]);
  const zenActive = (m?.bySource ?? []).filter((x) => x.source === "zenedu" && ["active", "trialing", "past_due"].includes(x.status)).reduce((a, x) => a + x.c, 0);
  const hubActive = (m?.bySource ?? []).filter((x) => x.source === "hub" && ["active", "trialing", "past_due"].includes(x.status)).reduce((a, x) => a + x.c, 0);
  const max = Math.max(1, ...(m?.cal ?? []).map((c) => c.c));
  return (
    <Shell title="Міграція з ZenEdu" counts={counts}>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi title="Активних у ZenEdu" value={zenActive} note="списує ZenEdu" />
        <Kpi hot title="Активних у Hub" value={hubActive} note="списує Hub · етап 2" />
        <Kpi title="Активних, що запустили Hub-бот" value={m?.inHub ?? 0} note="їх можна перевести першими" />
        <Kpi title="Відсоток у Hub" value={`${zenActive + hubActive ? Math.round((hubActive / (zenActive + hubActive)) * 100) : 0} %`} />
      </div>
      <div className="grid g2">
        <div className="card"><h3>Календар списань <span className="sub">кінець періоду активних підписок</span></h3>
          {m?.cal.length ? <ul className="tl">{m.cal.map((c) => <li key={c.day}><span>{c.day}</span><span style={{ display: "grid", gridTemplateColumns: "40px 1fr", gap: 8, alignItems: "center" }}><b>{c.c}</b><div className="bar"><i style={{ width: `${(c.c / max) * 100}%` }} /></div></span></li>)}</ul> : <p className="muted">Немає даних.</p>}
          <p className="note">План: за 2 дні до дати бот просить оновити спосіб оплати в Hub, ціна зберігається, дата списання не зсувається.</p></div>
        <div className="card"><h3>Ціни активних підписок <span className="sub">зберігаються при переїзді</span></h3>
          <div className="tbl"><table><thead><tr><th>Ціна</th><th className="num">Підписок</th></tr></thead><tbody>{(m?.prices ?? []).map((p, i) => <tr key={i}><td>{money(p.price, p.currency)}</td><td className="num">{p.c}</td></tr>)}</tbody></table></div>
          <h3 style={{ marginTop: 18 }}>Стан джерел</h3>
          <div className="ent"><span className="dot" /><div><b>ZenEdu API</b><small>імпорт замовлень і підписників</small></div></div>
          <div className="ent"><span className={`dot ${process.env.ZENEDU_WEBHOOK_SECRET ? "" : "warn"}`} /><div><b>Вебхуки ZenEdu</b><small>адреса: /api/webhooks/zenedu?key=… · налаштовується в ZenEdu → Workspace → API &amp; Webhooks</small></div></div>
          <div className="ent"><span className="dot warn" /><div><b>Токени карток</b><small>запит у ZenEdu та WayForPay відкладено; план за замовчуванням — повторна токенізація</small></div></div>
          <div className="ent"><span className="dot off" /><div><b>WayForPay в Hub</b><small>етап 2</small></div></div>
        </div>
      </div>
    </Shell>
  );
}
