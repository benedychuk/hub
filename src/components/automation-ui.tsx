"use client";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Section, Field, FormRow } from "@/components/ui/layout";

type Trigger = { key: string; label: string; group: string; filter: "offer" | "funnel" | "tag" | null; hint: string };
type ActionDef = { key: string; label: string; param: "funnel" | "tag" | "text"; hint: string };
type Act = { type: string; funnelId?: number; tag?: string; text?: string };
type Opt = { id: number; name: string; isActive: boolean; kind?: string };

/** Конструктор правила: тригер із фільтром і список дій. Дії йдуть у форму одним полем JSON. */
export function RuleBuilder({ triggers, actions, plans, funnels, initial }: {
  triggers: Trigger[]; actions: ActionDef[]; plans: Opt[]; funnels: Opt[];
  initial: { trigger: string; planId?: number; funnelId?: number; tag?: string; actions: Act[] };
}) {
  const [trigger, setTrigger] = useState(initial.trigger || triggers[0].key);
  const [acts, setActs] = useState<Act[]>(initial.actions.length ? initial.actions : [{ type: "funnel_add" }]);
  const t = triggers.find((x) => x.key === trigger) ?? triggers[0];
  const groups = [...new Set(triggers.map((x) => x.group))];
  const set = (i: number, patch: Partial<Act>) => setActs((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const funnelLabel = (f: Opt) => `${f.kind === "product" ? "Продукт" : "Воронка"} «${f.name}»${f.isActive ? "" : " · не активна"}`;
  return (
    <>
      <Section title="Коли спрацьовує" description="Подія, після якої виконуються дії. Правило реагує лише на нові події після вмикання автоматизацій.">
        <FormRow>
          <Field label="Тригер" hint={t.hint}>
            <select name="trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              {groups.map((g) => <optgroup key={g} label={g}>{triggers.filter((x) => x.group === g).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>)}
            </select>
          </Field>
          {t.filter === "offer" && <Field label="Оффер" hint="лише оффери Hub; оплати в ZenEdu тригерами не є">
            <select name="planId" defaultValue={initial.planId ?? ""}><option value="">Будь-який оффер</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isActive ? "" : " · зупинений"}</option>)}</select>
          </Field>}
          {t.filter === "funnel" && <Field label="Воронка або продукт">
            <select name="funnelId" defaultValue={initial.funnelId ?? ""}><option value="">Будь-яка</option>{funnels.map((f) => <option key={f.id} value={f.id}>{funnelLabel(f)}</option>)}</select>
          </Field>}
          {t.filter === "tag" && <Field label="Тег" hint="точна назва тегу, наприклад quiz_completed">
            <input name="tag" defaultValue={initial.tag ?? ""} required placeholder="назва тегу" />
          </Field>}
          {t.filter === null && <span />}
        </FormRow>
      </Section>

      <Section title="Що зробити" description="Дії виконуються по черзі. Якщо одна не вдалась, решта все одно виконуються, а результат видно в журналі й історії людини."
        actions={<button type="button" className="btn sm" onClick={() => setActs((a) => [...a, { type: "tag_add" }])} disabled={acts.length >= 6}><Plus size={15} /> Додати дію</button>}>
        <input type="hidden" name="actions" value={JSON.stringify(acts)} />
        <div className="auto-acts">
          {acts.map((a, i) => {
            const def = actions.find((x) => x.key === a.type) ?? actions[0];
            return (
              <div key={i} className="auto-act">
                <span className="auto-n">{i + 1}</span>
                <div className="auto-body">
                  <FormRow>
                    <Field label="Дія" hint={def.hint || undefined}>
                      <select value={a.type} onChange={(e) => set(i, { type: e.target.value, funnelId: undefined, tag: undefined, text: undefined })}>
                        {actions.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                      </select>
                    </Field>
                    {def.param === "funnel" && <Field label="Воронка або продукт">
                      <select value={a.funnelId ?? ""} onChange={(e) => set(i, { funnelId: Number(e.target.value) || undefined })}><option value="">Оберіть…</option>{funnels.map((f) => <option key={f.id} value={f.id}>{funnelLabel(f)}</option>)}</select>
                    </Field>}
                    {def.param === "tag" && <Field label="Тег"><input value={a.tag ?? ""} onChange={(e) => set(i, { tag: e.target.value })} placeholder="назва тегу" /></Field>}
                  </FormRow>
                  {def.param === "text" && <Field label={a.type === "notify_team" ? "Текст для власника" : "Текст повідомлення"}>
                    <textarea rows={3} value={a.text ?? ""} onChange={(e) => set(i, { text: e.target.value })} placeholder={a.type === "notify_team" ? "{{name}} оплатила «{{offer}}» · {{link}}" : "Дякуємо, {{name}}! …"} />
                  </Field>}
                </div>
                <button type="button" className="btn sm ghost" aria-label="Прибрати дію" onClick={() => setActs((x) => x.filter((_, j) => j !== i))} disabled={acts.length === 1}><X size={15} /></button>
              </div>
            );
          })}
        </div>
      </Section>
    </>
  );
}
