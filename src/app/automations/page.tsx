import Shell from "@/components/shell";
import { navCounts, automationList } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Automations() {
  const [counts, list] = await Promise.all([navCounts(), automationList()]);
  return (
    <Shell title="Автоматизації" counts={counts}>
      <div className="alert">Движок правил «тригер → умова → дія» вмикається на етапі 2 разом із власними подіями оплат. Зараз тут порожньо: {list.length} правил.</div>
      <div className="card"><h3>Що вже працює автоматично</h3>
        <div className="ent"><span className="dot" /><div><b>Щоденний імпорт із ZenEdu</b><small>о 04:00 за Києвом: нові підписники, замовлення, перерахунок підписок</small></div></div>
        <div className="ent"><span className="dot" /><div><b>Вебхуки ZenEdu</b><small>оплати, скасування, повідомлення потрапляють в історію людини одразу, якщо вебхук налаштовано</small></div></div>
        <div className="ent"><span className="dot" /><div><b>Hub-бот</b><small>/start розпізнає учасницю за telegram id і показує її підписку з ZenEdu</small></div></div>
      </div>
    </Shell>
  );
}
