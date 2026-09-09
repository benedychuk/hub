import Shell from "@/components/shell";
import { Section, Stat, Row, Timeline, EmptyState } from "@/components/ui/layout";
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
        <Stat label="Активних у ZenEdu" value={zenActive} hint="списує ZenEdu" />
        <Stat label="Активних у Hub" value={hubActive} hint="списує Hub · етап 2" tone="good" />
        <Stat label="Запустили Hub-бот" value={m?.inHub ?? 0} hint="активні, яких можна перевести першими" />
        <Stat label="Частка в Hub" value={`${zenActive + hubActive ? Math.round((hubActive / (zenActive + hubActive)) * 100) : 0} %`} />
      </div>
      <div className="grid g2">
        <Section title="Календар списань" description="Кінець періоду активних підписок. План: за 2 дні до дати бот просить оновити спосіб оплати в Hub, ціна зберігається, дата не зсувається.">
          {m?.cal.length ? <Timeline items={m.cal.map((c) => ({ id: c.day, when: c.day, what: <span className="row-actions" style={{ flexWrap: "nowrap" }}><b style={{ width: 36 }}>{c.c}</b><span className="bar" style={{ flex: 1 }}><i style={{ width: `${(c.c / max) * 100}%` }} /></span></span> }))} /> : <EmptyState title="Немає даних" />}
        </Section>
        <div className="form">
          <Section title="Ціни активних підписок" description="Зберігаються при переїзді." className="tbl">
            <table><thead><tr><th>Ціна</th><th className="num">Підписок</th></tr></thead><tbody>{(m?.prices ?? []).map((p, i) => <tr key={i}><td>{money(p.price, p.currency)}</td><td className="num">{p.c}</td></tr>)}</tbody></table>
          </Section>
          <Section title="Стан джерел">
            <Row title="ZenEdu API" sub="імпорт замовлень і підписників" />
            <Row tone={process.env.ZENEDU_WEBHOOK_SECRET ? "on" : "warn"} title="Вебхуки ZenEdu" sub="адреса у Налаштуваннях; вмикається в ZenEdu → Workspace → API & Webhooks" />
            <Row tone="warn" title="Токени карток" sub="запит у ZenEdu та WayForPay відкладено; план за замовчуванням: повторна токенізація" />
            <Row tone="off" title="WayForPay в Hub" sub="етап 2" />
          </Section>
        </div>
      </div>
    </Shell>
  );
}
