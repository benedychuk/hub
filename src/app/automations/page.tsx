import { Zap } from "lucide-react";
import Shell from "@/components/shell";
import { Section, Row, EmptyState } from "@/components/ui/layout";
import { navCounts, automationList } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Automations() {
  const [counts, list] = await Promise.all([navCounts(), automationList()]);
  return (
    <Shell title="Автоматизації" counts={counts}>
      <div className="grid g21">
        <Section title="Правила" description="Тригер → умова → дія. Редактор правил з’явиться разом із власними подіями оплат.">
          <EmptyState icon={<Zap size={20} />} title={list.length ? `${list.length} правил` : "Правил ще немає"} text="Скоро: «після оплати → додати у воронку», «за 3 дні до кінця доступу → нагадати», «тег додано → надіслати повідомлення»." />
        </Section>
        <Section title="Що вже працює автоматично">
          <Row title="Щоденний імпорт із ZenEdu" sub="о 04:00 за Києвом: нові підписники, замовлення, перерахунок підписок" />
          <Row title="Вебхуки ZenEdu" sub="оплати, скасування, повідомлення потрапляють в історію людини одразу, якщо вебхук налаштовано" />
          <Row title="Доступ до каналів і груп" sub="щохвилини: посилання тим, хто отримав право, виключення тих, у кого право закінчилось" />
          <Row title="Воронки й розсилки" sub="щохвилинний тік надсилає кроки за розкладом і доставляє розсилки порціями" />
        </Section>
      </div>
    </Shell>
  );
}
