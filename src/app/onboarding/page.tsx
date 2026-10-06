import Link from "next/link";
import { ClipboardList, ExternalLink } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { Section, Stat, Alert, EmptyState, Toolbar, Pager, KV } from "@/components/ui/layout";
import { AutoSubmitSelect } from "@/components/ui/controls";
import { navCounts, safe } from "@/lib/queries";
import { onboardingConfigured, onboardingUrl, onboardingStats, onboardingList, SCENARIOS, TAG_LABELS, TRIAL_DAYS, EXTENSION_DAYS } from "@/lib/onboarding";
import { date, dateTime, fullName } from "@/lib/format";

export const dynamic = "force-dynamic";
type SP = { q?: string; scenario?: string; state?: string; p?: string };
const n = (v: number | null | undefined) => (v ?? 0).toLocaleString("uk-UA");

/** Платформа онбордингу: воронка кандидаток, тріали, сценарії кризи, список акаунтів кабінету. */
export default async function Onboarding({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams; const configured = onboardingConfigured();
  const [counts, st, list] = await Promise.all([navCounts(), safe(() => onboardingStats(), null), safe(() => onboardingList({ q: sp.q, scenario: Number(sp.scenario) || undefined, state: sp.state, page: Number(sp.p) || 1 }), { rows: [], total: 0, page: 1, per: 50 })]);
  const link = (p: Partial<SP>) => { const u = new URLSearchParams(); const all = { ...sp, ...p }; for (const [k, v] of Object.entries(all)) if (v) u.set(k, String(v)); const s = u.toString(); return "/onboarding" + (s ? "?" + s : ""); };
  const pct = (a: number, b: number) => b ? `${Math.round((a / b) * 100)}%` : "—";
  const trialState = (ends: Date, ext: number) => { const ms = ends.getTime() - Date.now(); return ms > 0 ? (ms < 3 * 86400_000 ? <Pill tone="warn">закінчується {date(ends)}</Pill> : <Pill tone="good">до {date(ends)}</Pill>) : ext > 0 ? <Pill tone="mute">завершено</Pill> : <Pill tone="warn">14 днів минули</Pill>; };
  return (
    <Shell title="Онбординг" counts={counts}>
      <div className="ph" style={{ marginBottom: 6 }}><span className="ph-ico"><ClipboardList size={16} /></span><h2 className="ph-title">Платформа онбордингу</h2>{configured ? <Pill tone="good">підключено</Pill> : <Pill tone="crit">ONBOARDING_URL не задано</Pill>}<span className="spacer" />
        <div className="row-actions">{configured && <a href={onboardingUrl()} target="_blank" rel="noreferrer" className="btn sm ghost"><ExternalLink size={14} /> Відкрити платформу</a>}</div></div>
      {!configured && <Alert tone="warn">Додайте ONBOARDING_URL у Vercel: адресу, де розгорнуто кабінет. Без неї бот і картка людини не можуть видавати посилання в кабінет; API для платформи працює й так.</Alert>}
      {st && <>
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <Stat label="Акаунтів кабінету" value={n(st.total)} hint={`нових за 7 днів ${n(st.new7)}`} />
          <Stat label="Підтвердили Telegram" value={n(st.linked)} hint={pct(st.linked, st.total)} tone={st.total && st.linked / st.total < 0.5 ? "warn" : undefined} />
          <Stat label="Пройшли квіз" value={n(st.quiz)} hint={`глибинний ${n(st.deep)} · усі 3 тести ${n(st.diagnostic)}`} />
          <Stat label="Заповнили анкету" value={n(st.feedback)} hint={`бонус +${EXTENSION_DAYS} днів`} />
        </div>
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <Stat label="Тріал активний" value={n(st.trial_active)} hint={`${TRIAL_DAYS} днів після реєстрації`} tone="good" />
          <Stat label="Закінчується за 3 дні" value={n(st.expiring)} hint="нагадати в боті" tone={st.expiring ? "warn" : undefined} />
          <Stat label="Доступ завершено" value={n(st.expired)} hint="оффер клубу" />
          <Stat label="Клікали «Клуб» / «Щиро»" value={`${n(st.cta_club)} / ${n(st.cta_schyro)}`} hint={`у «Щиро» передано ${n(st.shchyro)} карток`} />
        </div>
      </>}
      <div className="grid g21">
        <div className="form">
          <Section title="Кандидатки" description="Усі, хто зареєструвалась у кабінеті. Кожна подія на платформі стає тегом у картці людини.">
            <Toolbar>
              <form className="search" method="get"><input name="q" defaultValue={sp.q ?? ""} placeholder="Ім'я, контакт, @username, Telegram ID" />{sp.state && <input type="hidden" name="state" value={sp.state} />}{sp.scenario && <input type="hidden" name="scenario" value={sp.scenario} />}</form>
              <form method="get" className="row-actions">{sp.q && <input type="hidden" name="q" value={sp.q} />}
                <AutoSubmitSelect name="state" defaultValue={sp.state ?? ""} ariaLabel="Стан"><option value="">Усі стани</option><option value="active">Тріал активний</option><option value="expiring">Закінчується</option><option value="expired">Завершено</option><option value="unlinked">Без Telegram</option><option value="noquiz">Без квізу</option></AutoSubmitSelect>
                <AutoSubmitSelect name="scenario" defaultValue={sp.scenario ?? ""} ariaLabel="Сценарій"><option value="">Усі сценарії</option>{Object.entries(SCENARIOS).map(([id, s]) => <option key={id} value={id}>{s.name}</option>)}</AutoSubmitSelect>
              </form>
            </Toolbar>
            {!list.rows.length ? <EmptyState icon={<ClipboardList size={20} />} title={sp.q || sp.state || sp.scenario ? "Нічого не знайдено" : "Акаунтів ще немає"} text="З'являться після першої реєстрації на платформі або після /cabinet у Hub-боті." /> : <div className="tbl"><table>
              <thead><tr><th>Кандидатка</th><th>Telegram</th><th>Квіз</th><th>Тести</th><th>Анкета</th><th>Тріал</th><th>Остання дія</th></tr></thead>
              <tbody>{list.rows.map(({ a, p }) => <tr key={a.id}>
                <td>{p ? <Link href={`/people/${p.id}`}>{a.name ?? fullName({ ...p, telegramUserId: p.telegramUserId })}</Link> : <span>{a.name ?? "без імені"}</span>}<div className="fld-h">{a.contact ?? "—"} · з {date(a.registeredAt)}</div></td>
                <td>{p ? <Pill tone="good">{p.username ? "@" + p.username : p.telegramUserId}</Pill> : <Pill tone="mute">не підтверджено</Pill>}</td>
                <td>{a.quizResultId ? <Pill tone="moon">{SCENARIOS[a.quizResultId]?.name ?? a.quizResultId}</Pill> : <span className="fld-h">—</span>}</td>
                <td className="mono">{[a.quizCompletedAt, a.deepQuiz?.test1, a.deepQuiz?.test2].filter(Boolean).length} з 3</td>
                <td>{a.feedbackAt ? <Pill tone="good">є</Pill> : <span className="fld-h">—</span>}</td>
                <td>{trialState(a.trialEndsAt, a.extensionCount)}</td>
                <td className="mono">{dateTime(a.lastSeenAt)}</td>
              </tr>)}</tbody></table>
              <Pager page={list.page} total={list.total} per={list.per} href={(p) => link({ p: String(p) })} />
            </div>}
          </Section>
        </div>
        <div className="form aside-sticky">
          {st && st.byScenario.length > 0 && <Section title="Сценарії кризи" description="Результати базового квізу"><KV items={st.byScenario.sort((a, b) => b.c - a.c).map((s) => ({ k: <Link href={link({ scenario: String(s.id), p: undefined })}>{s.name}</Link>, v: n(s.c), mono: true }))} /></Section>}
          <Section title="Як це працює">
            <ol className="fld-h" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
              <li>Реєстрація на платформі створює акаунт у Hub; кнопка «Підтвердити через Telegram» веде в Hub-бот і прив'язує акаунт до людини.</li>
              <li>З бота кабінет відкривається командою /cabinet за одноразовим посиланням без пароля.</li>
              <li>Квіз, тести, відео, анкета, кліки на клуб і «Щиро» стають тегами й подіями в картці людини.</li>
              <li>Результат квізу записується в пам'ять «Щиро»: бот знає ситуацію з першого повідомлення.</li>
              <li>Щодня Hub ставить теги станів тріалу: закінчується, 14 днів минули, доступ завершено.</li>
            </ol>
          </Section>
          <Section title="Теги матриці"><div className="tags">{Object.entries(TAG_LABELS).map(([t, l]) => <Link key={t} href={`/people?tag=${encodeURIComponent(t)}`} className="tagbtn" title={l}>{t}</Link>)}</div><p className="fld-h" style={{ marginTop: 8 }}>Натисніть тег, щоб побачити людей із ним у розділі «Люди».</p></Section>
        </div>
      </div>
    </Shell>
  );
}
