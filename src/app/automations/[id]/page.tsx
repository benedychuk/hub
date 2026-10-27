import Link from "next/link";
import { notFound } from "next/navigation";
import { Zap, Copy, Trash2, Save } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { PageHeader, Section, Field, FormRow, Alert } from "@/components/ui/layout";
import { Kebab, MenuAction, MenuSep, Switch } from "@/components/ui/controls";
import { RuleBuilder } from "@/components/automation-ui";
import { navCounts, automationList, automationPickers } from "@/lib/queries";
import { automationsEnabled, TRIGGERS, ACTIONS, ruleActions, type RuleCondition } from "@/lib/automations";
import { saveAutomation, duplicateAutomation, deleteAutomation } from "@/lib/actions";
import { hasDb } from "@/db";

export const dynamic = "force-dynamic";

/** Редактор правила автоматизації: тригер із фільтром, дії, затримка, стан. */
export default async function AutomationEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string }> }) {
  const { id } = await params; const sp = await searchParams;
  const isNew = id === "new";
  const [counts, list, pick, enabled] = await Promise.all([navCounts(), automationList(), automationPickers(), hasDb() ? automationsEnabled().catch(() => false) : false]);
  const r = isNew ? null : list.find((x) => x.id === Number(id)) ?? null;
  if (!isNew && !r) notFound();
  const c = (r?.condition ?? {}) as RuleCondition;
  const delay = r?.delayMinutes ?? 0;
  const unit = delay && delay % 1440 === 0 ? "days" : delay && delay % 60 === 0 ? "hours" : "minutes";
  const dv = !delay ? 0 : unit === "days" ? delay / 1440 : unit === "hours" ? delay / 60 : delay;
  return (
    <Shell title="Автоматизації" counts={counts}>
      <PageHeader back="/automations" backLabel="Автоматизації" icon={<Zap size={16} />} title={isNew ? "Нове правило" : r!.name}
        status={r ? <Pill tone={r.isActive ? "good" : "mute"}>{r.isActive ? "активне" : "вимкнене"}</Pill> : undefined}
        actions={r ? <Kebab>
          <MenuAction action={duplicateAutomation} fields={{ id: r.id }} icon={<Copy />}>Дублювати</MenuAction>
          <MenuSep />
          <MenuAction action={deleteAutomation} fields={{ id: r.id }} icon={<Trash2 />} danger confirm={`Видалити правило «${r.name}»?`}>Видалити правило</MenuAction>
        </Kebab> : undefined} />
      {sp.err && <Alert tone="bad">{sp.err}</Alert>}
      {!enabled && <Alert tone="info">Загальний вимикач автоматизацій зараз вимкнено: правило можна налаштувати, але воно не спрацює, доки ви не увімкнете автоматизації на сторінці <Link href="/automations">Автоматизації</Link>.</Alert>}
      <form action={saveAutomation} className="grid g21">
        {r && <input type="hidden" name="id" value={r.id} />}
        <div className="form">
          <RuleBuilder triggers={TRIGGERS} actions={ACTIONS} plans={pick.plans} funnels={pick.funnels}
            initial={{ trigger: r?.trigger ?? "payment_success", planId: c.planId, funnelId: c.funnelId, tag: c.tag, actions: r ? ruleActions(r) : [] }} />
        </div>
        <div className="form aside-sticky">
          <Section title="Назва і стан">
            <Field label="Назва" hint="для себе, видно в журналі й історії людини"><input name="name" defaultValue={r?.name ?? ""} maxLength={120} placeholder="Наприклад, Оплата клубу → онбординг" /></Field>
            <FormRow>
              <Field label="Затримка"><input name="delayValue" type="number" min={0} max={10000} defaultValue={dv} /></Field>
              <Field label="Одиниця"><select name="delayUnit" defaultValue={unit}><option value="minutes">хвилин</option><option value="hours">годин</option><option value="days">днів</option></select></Field>
            </FormRow>
            <p className="fld-h">0 — одразу після події (протягом хвилини).</p>
            <Switch name="oncePerPerson" defaultChecked={r?.oncePerPerson ?? true} label="Один раз на людину" hint="наступні такі події для цієї людини правило пропускає" />
            <Switch name="isActive" defaultChecked={r?.isActive ?? false} label="Правило активне" hint="спрацьовує лише коли увімкнено й загальний вимикач" />
            <div className="row-actions" style={{ marginTop: 14 }}><button className="btn pri" type="submit"><Save size={15} /> Зберегти правило</button><Link className="btn ghost" href="/automations">Скасувати</Link></div>
          </Section>
        </div>
      </form>
    </Shell>
  );
}
