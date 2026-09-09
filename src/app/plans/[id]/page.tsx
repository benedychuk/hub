import Link from "next/link";
import Shell from "@/components/shell";
import { PageHeader, Section, Field, FormRow } from "@/components/ui/layout";
import { Checkbox, Switch } from "@/components/ui/controls";
import { navCounts, planById, resourceList } from "@/lib/queries";
import { savePlan } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function PlanForm({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isNew = id === "new";
  const [counts, pl, res] = await Promise.all([navCounts(), isNew ? Promise.resolve(null) : planById(Number(id)), resourceList()]);
  const e = pl?.entitlements ?? {};
  return (
    <Shell title="Тарифи й оффери" counts={counts}>
      <PageHeader back="/plans" backLabel="Тарифи" title={isNew ? "Новий тариф" : pl?.name ?? ""} />
      <form action={savePlan} className="grid g21">
        {!isNew && <input type="hidden" name="id" value={pl?.id} />}
        <div className="form">
          <Section title="Основне">
            <FormRow><Field label="Назва"><input name="name" defaultValue={pl?.name ?? ""} required /></Field><Field label="Внутрішній код" hint="латиниця, для API і звітів"><input name="key" defaultValue={pl?.key ?? ""} placeholder="club_ai" /></Field></FormRow>
            <FormRow cols={3}><Field label="Ціна"><input name="price" type="number" step="0.01" defaultValue={pl?.price ?? "999"} required /></Field><Field label="Валюта"><select name="currency" defaultValue={pl?.currency ?? "UAH"}><option>UAH</option><option>USD</option><option>EUR</option></select></Field><Field label="Період"><select name="period" defaultValue={pl?.period ?? "month"}><option value="month">Місяць</option><option value="quarter">3 місяці</option><option value="year">Рік</option></select></Field></FormRow>
            <FormRow><Field label="Пробний період, днів" hint="0 = без пробного періоду"><input name="trialDays" type="number" defaultValue={pl?.trialDays ?? 0} /></Field><Field label="Ціна пробного періоду" hint="порожньо = безкоштовно"><input name="trialPrice" type="number" step="0.01" defaultValue={pl?.trialPrice ?? ""} placeholder="99" /></Field></FormRow>
          </Section>
          <Section title="Що дає тариф" description="Позначте продукти; для функцій бота можна задати квоту, наприклад 40/день.">
            {res.length ? res.map((r) => <div key={r.key} className="row-actions" style={{ justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line)" }}><Checkbox name={`ent:${r.key}`} defaultChecked={e[r.key] !== undefined} label={r.name} hint={r.key} /><input name={`quota:${r.key}`} defaultValue={e[r.key] ?? ""} placeholder="квота" className="input" style={{ width: 150 }} /></div>)
              : <p className="fld-h">Продуктів ще немає: підключіть канал або створіть цифровий продукт у розділі <Link href="/resources">Канали і групи</Link>.</p>}
          </Section>
        </div>
        <div className="form aside-sticky">
          <Section title="Показ">
            <Switch name="isActive" defaultChecked={pl?.isActive ?? true} label="Тариф активний" hint="показується в боті за /plans" />
            <Switch name="isFeatured" defaultChecked={pl?.isFeatured ?? false} label="Рекомендований" hint="виділяється в списку" />
            <Field label="Порядок показу"><input name="sortOrder" type="number" defaultValue={pl?.sortOrder ?? 0} /></Field>
          </Section>
          <Section>
            <div className="form"><button className="btn pri" type="submit">Зберегти тариф</button><Link className="btn ghost" href="/plans">Скасувати</Link></div>
            <p className="fld-h" style={{ marginTop: 10 }}>Зміна ціни не торкається чинних підписок: у кожної своя ціна.</p>
          </Section>
        </div>
      </form>
    </Shell>
  );
}
