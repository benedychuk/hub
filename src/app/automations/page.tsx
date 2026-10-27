import Link from "next/link";
import { Zap, Plus, Pencil, Copy, Trash2 } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { Section, Row, EmptyState, Alert } from "@/components/ui/layout";
import { Kebab, MenuAction, MenuLink, MenuSep, AutoSubmitToggleClient } from "@/components/ui/controls";
import { navCounts, automationList, automationPickers } from "@/lib/queries";
import { automationsEnabled, automationStats, TRIGGERS, ACTIONS, ruleActions, type RuleCondition } from "@/lib/automations";
import { saveAutomationsSwitch, toggleAutomation, duplicateAutomation, deleteAutomation } from "@/lib/actions";
import { dateTime, fullName } from "@/lib/format";
import { hasDb } from "@/db";

export const dynamic = "force-dynamic";

const delayLabel = (m: number) => !m ? "одразу" : m % 1440 === 0 ? `через ${m / 1440} дн` : m % 60 === 0 ? `через ${m / 60} год` : `через ${m} хв`;

/** Автоматизації «тригер → дії»: загальний вимикач, правила, журнал спрацювань. */
export default async function Automations({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const [counts, list, pick, enabled, stats] = await Promise.all([navCounts(), automationList(), automationPickers(), hasDb() ? automationsEnabled().catch(() => false) : false, hasDb() ? automationStats().catch(() => null) : null]);
  const planName = (id?: number) => pick.plans.find((p) => p.id === id)?.name;
  const funnelName = (id?: number) => pick.funnels.find((f) => f.id === id)?.name;
  const whenLabel = (r: (typeof list)[number]) => {
    const t = TRIGGERS.find((x) => x.key === r.trigger); const c = (r.condition ?? {}) as RuleCondition;
    const f = t?.filter === "offer" ? (c.planId ? ` · «${planName(c.planId) ?? `#${c.planId}`}»` : " · будь-який оффер") : t?.filter === "funnel" ? (c.funnelId ? ` · «${funnelName(c.funnelId) ?? `#${c.funnelId}`}»` : " · будь-яка воронка") : t?.filter === "tag" ? ` · «${c.tag ?? ""}»` : "";
    return `${t?.label ?? r.trigger}${f}`;
  };
  const doLabel = (a: ReturnType<typeof ruleActions>[number]) => {
    const l = ACTIONS.find((x) => x.key === a.type)?.label ?? a.type;
    return a.funnelId ? `${l} «${funnelName(a.funnelId) ?? `#${a.funnelId}`}»` : a.tag ? `${l} «${a.tag}»` : a.text ? `${l}: ${a.text.slice(0, 60)}${a.text.length > 60 ? "…" : ""}` : l;
  };
  return (
    <Shell title="Автоматизації" counts={counts}>
      {sp.ok && <Alert tone="ok">{sp.ok}</Alert>}
      {sp.err && <Alert tone="bad">{sp.err}</Alert>}
      <div className="grid g21">
        <div className="form">
          <Section title="Стан автоматизацій">
            <form action={saveAutomationsSwitch}>
              {!enabled && <input type="hidden" name="enabled" value="on" />}
              <Row tone={enabled ? "on" : "off"} title={enabled ? "Автоматизації увімкнено" : "Автоматизації вимкнено"}
                sub={enabled ? "Активні правила спрацьовують на нові події щохвилини." : "Жодне правило не виконується, навіть активне. Після вмикання обробляються лише нові події, історія не чіпається."}
                right={<AutoSubmitToggleClient checked={enabled} label="Автоматизації увімкнено" />} />
            </form>
            {!enabled && list.some((r) => r.isActive) && <Alert tone="warn">Є активні правила, але загальний вимикач вимкнено: вони не спрацюють, доки ви його не увімкнете.</Alert>}
          </Section>
          <Section title="Правила" description="Тригер → дії. Кожне правило вмикається окремо; нове правило створюється вимкненим, якщо ви не ввімкнете його в редакторі." className="tbl"
            actions={list.length ? <Link className="btn pri" href="/automations/new"><Plus size={15} /> Нове правило</Link> : undefined}>
            {list.length ? <table><thead><tr><th>Правило</th><th>Що робить</th><th>Коли</th><th className="num">Спрацювало</th><th>Стан</th><th></th></tr></thead><tbody>
              {list.map((r) => { const st = stats?.counts.get(r.id); return <tr key={r.id}>
                <td><Link href={`/automations/${r.id}`} className="lnk-ink">{r.name}</Link><div className="fld-h">{whenLabel(r)}{r.oncePerPerson ? " · один раз на людину" : ""}</div></td>
                <td>{ruleActions(r).map((a, i) => <div key={i} className={i ? "fld-h" : undefined}>{doLabel(a)}</div>)}</td>
                <td>{delayLabel(r.delayMinutes)}</td>
                <td className="num">{st?.n ?? 0}{st?.last ? <div className="fld-h">{dateTime(st.last)}</div> : null}</td>
                <td><form action={toggleAutomation}><input type="hidden" name="id" value={r.id} /><AutoSubmitToggleClient checked={r.isActive} label={r.isActive ? "Активне" : "Вимкнене"} /></form></td>
                <td><Kebab>
                  <MenuLink href={`/automations/${r.id}`} icon={<Pencil />}>Редагувати</MenuLink>
                  <MenuAction action={duplicateAutomation} fields={{ id: r.id }} icon={<Copy />}>Дублювати</MenuAction>
                  <MenuSep />
                  <MenuAction action={deleteAutomation} fields={{ id: r.id }} icon={<Trash2 />} danger confirm={`Видалити правило «${r.name}»? Заплановані спрацювання цього правила не виконаються.`}>Видалити</MenuAction>
                </Kebab></td>
              </tr>; })}
            </tbody></table>
              : <EmptyState icon={<Zap size={20} />} title="Правил ще немає" text="Наприклад: «Оплата оффера → додати у воронку онбордингу», «Підписку не продовжено → через 1 день додати у воронку повернення», «Воронку завершено → додати тег»." action={<Link className="btn pri" href="/automations/new"><Plus size={15} /> Створити перше правило</Link>} />}
          </Section>
          <Section title="Журнал" description={`Останні спрацювання${stats?.pending ? ` · заплановано: ${stats.pending}` : ""}`}>
            {stats?.recent.length ? stats.recent.map(({ e, first, last, username }) => {
              const p = (e.payload ?? {}) as { name?: string; ruleId?: number; results?: { ok: boolean; note?: string }[]; reason?: string };
              const bad = (p.results ?? []).filter((x) => !x.ok);
              return <Row key={e.id} tone={e.type === "automation.skipped" || bad.length ? "warn" : "on"}
                title={<>{p.name ?? `Правило #${p.ruleId ?? ""}`}{e.personId ? <> · <Link href={`/people/${e.personId}`}>{fullName({ firstName: first, lastName: last, username })}</Link></> : null}</>}
                sub={`${dateTime(e.createdAt)} · ${e.type === "automation.skipped" ? `пропущено: ${p.reason ?? ""}` : `${(p.results ?? []).length} дій${bad.length ? ` · не виконано: ${bad.map((x) => x.note ?? "помилка").join("; ")}` : ""}`}`}
                right={e.type === "automation.skipped" ? <Pill tone="warn">пропущено</Pill> : bad.length ? <Pill tone="warn">частково</Pill> : <Pill tone="good">виконано</Pill>} />;
            }) : <p className="fld-h" style={{ margin: 0 }}>Спрацювань ще не було.</p>}
          </Section>
        </div>
        <div className="form aside-sticky">
          <Section title="Як це працює">
            <ol className="steps-how">
              <li>Hub щохвилини переглядає нові події: оплати, підписки, входи у воронки й завершення, теги, запуск бота.</li>
              <li>Для кожної події виконуються активні правила з таким тригером і фільтром.</li>
              <li>Затримка «через N днів» відкладає дії; якщо правило за цей час вимкнути, вони не виконаються.</li>
              <li>Не більше 30 спрацювань на людину за годину: ланцюжки правил не зациклюються.</li>
              <li>Оплати в ZenEdu тригерами не є: імпорт приносить історію, а не нові дії.</li>
            </ol>
          </Section>
          <Section title="Що вже працює автоматично">
            <Row title="Щоденний імпорт із ZenEdu" sub="о 04:00 за Києвом: нові підписники, замовлення, перерахунок підписок" />
            <Row title="Вебхуки ZenEdu" sub="оплати, скасування, повідомлення потрапляють в історію людини одразу, якщо вебхук налаштовано" />
            <Row title="Доступ до каналів і груп" sub="щохвилини: посилання тим, хто отримав право, виключення тих, у кого право закінчилось" />
            <Row title="Воронки й розсилки" sub="щохвилинний тік надсилає кроки за розкладом і доставляє розсилки порціями" />
          </Section>
        </div>
      </div>
    </Shell>
  );
}
