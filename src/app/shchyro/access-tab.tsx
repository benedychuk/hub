import Link from "next/link";
import { Bot, RefreshCw, Download, Save, Activity, KeyRound } from "lucide-react";
import { Pill } from "@/components/ui";
import { Section, Field, FormRow, KV, Alert, EmptyState } from "@/components/ui/layout";
import { Switch, Checkbox } from "@/components/ui/controls";
import { saveShchyroSettings, shchyroSyncNow, shchyroCheck, shchyroImport, shchyroQuickGrant } from "@/lib/actions";
import { shchyroConfigured, shchyroBaseUrl, shchyroSettings, shchyroEntitled, type Entitled } from "@/lib/shchyro";
import { date } from "@/lib/format";
import { safe } from "@/lib/queries";
import { dateTime } from "@/lib/format";

/** Вкладка «Доступ»: Hub керує списком доступу бота через його API (push-модель за ТЗ), список тих, хто має право, швидка видача. */
export default async function AccessTab({ resources, people }: { resources: { key: string; name: string; kind: string }[]; people: Record<number, { id: number; name: string }> }) {
  const configured = shchyroConfigured();
  const st = await safe(() => shchyroSettings(), { enabled: false, resourceKey: "shchyro.access", pushedIds: [] as number[], lastSync: null, lastPush: null, lastCheck: null });
  const entitledRows = await safe(() => shchyroEntitled(st.resourceKey), [] as Entitled[]);
  const entitled = entitledRows.length;
  const SRC: Record<string, string> = { manual: "ручне право", plan: "тариф", zenedu: "підписка ZenEdu" };
  const ls = st.lastSync; const lp = st.lastPush as { at?: string; granted?: number; revoked?: number; failed?: number; pending?: number; error?: string | null } | null; const lc = st.lastCheck as { at?: string; ok?: boolean; error?: string; active_count?: number } | null;
  const options = resources.filter((r) => r.kind === "bot_feature" || r.kind === "external_url");
  return (<>
    <Section title="Доступ до «Щиро» з Hub" description="Hub видає доступ після оплати, закриває після завершення підписки і раз на день звіряє повний список із ботом. Бот підхоплює зміни за 5 секунд."
      actions={<Pill tone={!configured ? "crit" : st.enabled ? "good" : "warn"}>{!configured ? "не підключено" : st.enabled ? "автоматика увімкнена" : "лише спостереження"}</Pill>}>
      {!configured && <Alert tone="warn">Додайте SHCHYRO_API_URL і SHCHYRO_API_SECRET у Vercel і зробіть редеплой. Той самий секрет має стояти в «Щиро» як HUB_API_SECRET.</Alert>}
      {configured && !st.enabled && <Alert tone="info">Автоматика вимкнена: Hub нічого не змінює в боті. Можна перевірити зв'язок і подивитись розбіжності, а вмикати після імпорту та перевірки.</Alert>}
      <KV items={[
        { k: "Адреса API", v: configured ? `${shchyroBaseUrl()}/api/v1/hub` : "—", mono: true },
        { k: "Право, яке відкриває бота", v: resources.find((r) => r.key === st.resourceKey)?.name ?? st.resourceKey, mono: true },
        { k: "Мають право зараз", v: entitled, mono: true },
        { k: "Відкрито Hub у боті", v: st.pushedIds.length, mono: true },
        { k: "Останній тік", v: lp?.at ? `${dateTime(lp.at)} · +${lp.granted ?? 0} / −${lp.revoked ?? 0}${lp.failed ? ` · помилок ${lp.failed}` : ""}${lp.pending ? ` · у черзі ${lp.pending}` : ""}` : "ще не було", mono: true },
        { k: "Зв'язок", v: lc?.at ? `${dateTime(lc.at)} · ${lc.ok ? `є, активних у боті ${lc.active_count ?? 0}` : `немає: ${lc.error ?? ""}`}` : "не перевірявся", mono: true },
      ]} />
      {ls && <div style={{ marginTop: 12 }}><Alert tone={ls.ok ? (ls.mode === "preview" ? "info" : "ok") : "bad"}>
        {ls.ok ? `${ls.mode === "preview" ? "Перевірка" : "Звірка"} ${dateTime(ls.at)}: надіслано ${ls.total_received ?? 0}, увімкнено ${ls.activated ?? 0}, вимкнено ${ls.deactivated ?? 0}, захищених ${ls.protected_untouched ?? 0}, без змін ${ls.unchanged ?? 0}.` : `Звірка ${dateTime(ls.at)} не пройшла: ${ls.error}${ls.deactivated ? ` (вимкнулось би ${ls.deactivated}${ls.limit ? ` при ліміті ${ls.limit}` : ""})` : ""}.`}
        {ls.ok && (ls.deactivated_ids?.length ?? 0) > 0 && <div className="mono" style={{ marginTop: 6, fontSize: 11.5 }}>{ls.mode === "preview" ? "Вимкнулись би" : "Вимкнено"}: {ls.deactivated_ids!.join(", ")}</div>}
        {ls.ok && (ls.activated_ids?.length ?? 0) > 0 && <div className="mono" style={{ marginTop: 4, fontSize: 11.5 }}>{ls.mode === "preview" ? "Увімкнулись би" : "Увімкнено"}: {ls.activated_ids!.join(", ")}</div>}
      </Alert></div>}
      <form action={saveShchyroSettings} style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
        <Switch name="enabled" defaultChecked={st.enabled} label="Автоматика доступу «Щиро» увімкнена" hint="Hub відкриває бота тим, хто має право, закриває тим, у кого право зникло, і щодня звіряє повний список. Вимкнено = Hub лише спостерігає." />
        <FormRow>
          <Field label="Право, яке відкриває бота" hint="ресурс із тарифів; людина з чинним правом на нього має доступ до «Щиро»">
            <select name="resourceKey" defaultValue={st.resourceKey}>{options.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}{!options.some((r) => r.key === st.resourceKey) && <option value={st.resourceKey}>{st.resourceKey}</option>}</select>
          </Field>
          <div className="fld"><span className="fld-l">&nbsp;</span><button className="btn" type="submit" disabled={!configured}><Save size={15} /> Зберегти</button></div>
        </FormRow>
      </form>
      <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
        <form action={shchyroSyncNow}>
          <FormRow cols={3}>
            <Field label="Звірка списків" hint="Перевірка нічого не змінює; застосування вмикає всіх, хто має право, і вимикає решту, крім адміністраторів і доданих вручну в панелі «Щиро»">
              <select name="mode" defaultValue="preview"><option value="preview">Лише перевірити розбіжності</option><option value="reconcile">Застосувати в боті</option></select>
            </Field>
            <div className="fld"><span className="fld-l">&nbsp;</span><Checkbox name="force" label="Зняти ліміт масових відключень" hint="інакше «Щиро» зупинить звірку, якщо вимкнулось би понад 50" /></div>
            <div className="fld"><span className="fld-l">&nbsp;</span><button className="btn" type="submit" disabled={!configured}><RefreshCw size={15} /> Звірити зі «Щиро»</button></div>
          </FormRow>
        </form>
        <div className="row-actions" style={{ marginTop: 12 }}>
          <form action={shchyroCheck}><button className="btn" type="submit" disabled={!configured}><Activity size={15} /> Перевірити зв'язок</button></form>
          <form action={shchyroImport} className="row-actions">
            <input name="days" type="number" min={1} max={365} defaultValue={30} style={{ width: 90 }} aria-label="Днів перехідного доступу" />
            <button className="btn" type="submit" disabled={!configured}><Download size={15} /> Імпортувати доступи зі «Щиро» на N днів</button>
          </form>
        </div>
        <p className="fld-h" style={{ marginTop: 10 }}><Bot size={13} style={{ verticalAlign: -2 }} /> Порядок переходу: перевірити зв'язок → імпортувати нинішні доступи як перехідні права → перевірити розбіжності → увімкнути автоматику. Імпорт нічого не дублює: кому право вже є, той пропускається.</p>
      </div>
    </Section>
    <div className="grid g21" style={{ marginTop: 16 }}>
      <Section title="Хто має право зараз" description="Право дає тариф із ресурсом «Щиро», ручна видача в картці людини або перехідний режим ZenEdu. Саме цей список Hub передає боту.">
        {entitledRows.length ? <div className="tbl"><table><thead><tr><th>Людина</th><th>Telegram ID</th><th>Джерело</th><th>Діє до</th><th>У боті</th></tr></thead><tbody>
          {entitledRows.slice(0, 300).map((e) => <tr key={e.personId}><td>{people[e.personId] ? <Link href={`/people/${e.personId}`}>{people[e.personId].name}</Link> : `#${e.personId}`}</td><td className="mono">{e.telegramUserId}</td><td>{SRC[e.source] ?? e.source}{e.planKey && e.source === "plan" ? <span className="fld-h"> {e.planKey}</span> : null}</td><td className="mono">{e.validUntil ? date(e.validUntil) : "безстроково"}</td><td>{st.pushedIds.includes(e.telegramUserId) ? <Pill tone="good">відкрито</Pill> : <Pill tone="warn">у черзі</Pill>}</td></tr>)}
        </tbody></table>{entitledRows.length > 300 && <p className="fld-h">Показано 300 із {entitledRows.length}.</p>}</div> : <EmptyState title="Поки ніхто не має права на «Щиро»" text="Додайте ресурс «Бот Щиро» до тарифу або видайте право вручну нижче." action={<Link href="/offers" className="btn sm">Оффери</Link>} />}
      </Section>
      <div className="form aside-sticky">
        <Section title="Видати доступ вручну" description="Поверх підписки, на обмежений строк. Людина отримає доступ у боті протягом хвилини, якщо автоматика увімкнена.">
          <form action={shchyroQuickGrant}>
            <Field label="Telegram ID або @username" hint="людина має бути в Hub; за числовим ID її буде створено"><input name="who" placeholder="400910781 або @qqdaryya" required /></Field>
            <FormRow><Field label="На скільки днів"><input name="days" type="number" min={1} max={3650} defaultValue={30} /></Field><div className="fld"><span className="fld-l">&nbsp;</span><button className="btn" type="submit"><KeyRound size={15} /> Видати доступ</button></div></FormRow>
          </form>
          <p className="fld-h" style={{ marginTop: 8 }}>Забрати право можна в картці людини, розділ «Права доступу». Доступ за тарифом закривається сам, коли закінчується підписка.</p>
        </Section>
      </div>
    </div>
  </>);
}
