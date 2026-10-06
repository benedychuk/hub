import Link from "next/link";
import { Bot, ExternalLink, KeyRound, Send } from "lucide-react";
import { Pill } from "@/components/ui";
import { Section, Field, FormRow, KV, EmptyState, FilterGroup } from "@/components/ui/layout";
import { grantEntitlement, shchyroNotifyPerson } from "@/lib/actions";
import { shchyroConfigured, shchyroSettings, shchyroClient, shchyroEntitledFor, shchyroPanelClientUrl } from "@/lib/shchyro";
import { date, dateTime } from "@/lib/format";

const SRC: Record<string, string> = { manual: "ручне право", plan: "тариф", zenedu: "підписка ZenEdu" };
const PROFILE_LABELS: Record<string, string> = { facts: "Факти", main_request: "Запит", key_themes: "Теми", emotional_state: "Стан", discussed: "Уже обговорили", recommendations: "Що вже радили", sensitive: "Чутливе", communication_prefs: "Як зручно спілкуватись" };
const txt = (v: unknown) => Array.isArray(v) ? v.map(String).join("; ") : typeof v === "object" && v ? JSON.stringify(v) : String(v ?? "");

/** Блок «Бот „Щиро“» у картці людини: доступ, пам'ять бота, останні репліки, дії. */
export default async function ShchyroPerson({ personId, telegramUserId }: { personId: number; telegramUserId: number }) {
  const configured = shchyroConfigured();
  const st = await shchyroSettings().catch(() => null);
  const ent = await shchyroEntitledFor(personId).catch(() => null);
  const r = configured ? await shchyroClient(telegramUserId, 10) : null;
  const c = r?.ok ? r.data : null;
  const grant = (
    <form action={grantEntitlement} style={{ marginTop: 10 }}><input type="hidden" name="personId" value={personId} /><input type="hidden" name="resourceKey" value={st?.resourceKey ?? "shchyro.access"} />
      <FormRow><Field label="Відкрити доступ на, днів" hint="ручне право поверх підписки"><input name="days" type="number" min={1} defaultValue={30} /></Field><div className="fld"><span className="fld-l">&nbsp;</span><button className="btn" type="submit"><KeyRound size={15} /> Відкрити «Щиро»</button></div></FormRow></form>);
  const header = <>{ent ? <Pill tone="good">право в Hub: {SRC[ent.source] ?? ent.source}</Pill> : <Pill tone="mute">права в Hub немає</Pill>}{c ? (c.access.is_admin ? <Pill tone="moon">адмін бота</Pill> : c.access.is_active ? <Pill tone="good">бот відкрито</Pill> : <Pill tone="mute">бот закрито</Pill>) : null}</>;
  if (!configured) return <Section title="Бот «Щиро»" actions={header}><EmptyState icon={<Bot size={18} />} title="«Щиро» не підключено до Hub" text={<>Додайте змінні оточення й перевірте зв'язок на сторінці <Link href="/shchyro">Бот «Щиро»</Link>.</>} />{!ent && grant}</Section>;
  if (r && !r.ok) return <Section title="Бот «Щиро»" actions={header}><p className="fld-h">«Щиро» не відповідає: {r.error}</p>{!ent && grant}</Section>;
  if (!c?.found || !c.client) return <Section title="Бот «Щиро»" actions={header}><EmptyState icon={<Bot size={18} />} title="Ще не писала боту «Щиро»" text={ent ? "Право є: щойно людина напише боту, тут з'явиться її картка пам'яті." : "Щоб відкрити бота, видайте право нижче або додайте тариф із ресурсом «Бот Щиро»."} />{!ent && grant}</Section>;
  const profile = c.profile; const data = (profile?.data ?? {}) as Record<string, unknown>;
  const fields = Object.entries(PROFILE_LABELS).filter(([k]) => data[k] && txt(data[k]).trim());
  const panel = shchyroPanelClientUrl(telegramUserId);
  return (
    <Section title="Бот «Щиро»" actions={header} description={ent ? `${SRC[ent.source] ?? ent.source}${ent.validUntil ? ` · до ${date(ent.validUntil)}` : " · безстроково"}` : undefined}>
      <KV items={[
        { k: "Повідомлень", v: `${c.client.total_messages.toLocaleString("uk-UA")} · сесій ${c.client.sessions_count}`, mono: true },
        { k: "Перший контакт", v: date(c.client.created_at), mono: true },
        { k: "Остання активність", v: dateTime(c.client.last_seen_at), mono: true },
        { k: "Доступ у боті", v: c.access.is_admin ? "адміністратор" : c.access.is_active ? `відкрито${c.access.source ? ` · ${c.access.source === "hub" ? "з Hub" : c.access.source}` : ""}${c.access.added_at ? ` · з ${date(c.access.added_at)}` : ""}` : `закрито${c.access.removed_at ? ` · ${date(c.access.removed_at)}` : ""}`, mono: true },
        { k: "Картка пам'яті", v: profile && profile.version ? `версія ${profile.version} · оновлено ${date(profile.updated_at)} · стиснень ${c.summaries_count}` : "ще не сформована", mono: true },
      ]} />
      {profile?.summary_text && <div style={{ marginTop: 12 }}><FilterGroup title="Що бот пам'ятає про людину" open>
        <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 13.5 }}>{profile.summary_text}</p>
        {fields.length > 0 && <KV items={fields.map(([k, label]) => ({ k: label, v: txt(data[k]) }))} />}
      </FilterGroup></div>}
      {c.messages.length > 0 && <div style={{ marginTop: 8 }}><FilterGroup title={`Останні репліки · ${c.messages.length}`}>
        <div className="msgs">{c.messages.map((m) => <div key={m.id} className={`msg ${m.role === "user" ? "user" : "assistant"}`}>{m.content}<small>{m.role === "user" ? "клієнтка" : "бот"} · {dateTime(m.created_at)}</small></div>)}</div>
        {panel && <a href={panel} target="_blank" rel="noreferrer" className="btn sm ghost"><ExternalLink size={13} /> Уся переписка в панелі «Щиро»</a>}
      </FilterGroup></div>}
      {!ent && grant}
      {c.access.has_access && <form action={shchyroNotifyPerson} style={{ marginTop: 12 }}><input type="hidden" name="personId" value={personId} />
        <Field label="Написати від імені бота «Щиро»" hint="системне повідомлення: нагадування, подяка, посилання на продовження"><textarea name="text" rows={2} maxLength={4096} placeholder="Привіт! Твоя підписка на клуб закінчується через 2 дні…" required /></Field>
        <div className="row-actions" style={{ marginTop: 8 }}><button className="btn" type="submit"><Send size={15} /> Надіслати через «Щиро»</button></div></form>}
    </Section>
  );
}
