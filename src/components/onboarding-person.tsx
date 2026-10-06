import Link from "next/link";
import { ClipboardList, Link2, Send } from "lucide-react";
import { Pill } from "@/components/ui";
import { Section, KV, EmptyState, FilterGroup } from "@/components/ui/layout";
import { CopyBox } from "@/app/settings/copy-box";
import { cabinetLink } from "@/lib/actions";
import { accountForPerson, onboardingConfigured, SCENARIOS, TAG_LABELS } from "@/lib/onboarding";
import { date, dateTime } from "@/lib/format";

/** Блок «Онбординг» у картці людини: кабінет, тріал, квіз і тести, анкета, посилання в кабінет. */
export default async function OnboardingPerson({ personId, link }: { personId: number; link?: string }) {
  const a = await accountForPerson(personId).catch(() => null);
  const configured = onboardingConfigured();
  const actions = <div className="row-actions">
    <form action={cabinetLink}><input type="hidden" name="personId" value={personId} /><button className="btn sm" type="submit" disabled={!configured}><Link2 size={14} /> Посилання в кабінет</button></form>
    <form action={cabinetLink}><input type="hidden" name="personId" value={personId} /><input type="hidden" name="send" value="1" /><button className="btn sm" type="submit" disabled={!configured}><Send size={14} /> Надіслати в бот</button></form>
  </div>;
  if (!a) return <Section title="Онбординг" actions={actions}><EmptyState icon={<ClipboardList size={18} />} title="Кабінету ще немає" text={configured ? "Надішліть посилання: кабінет створиться автоматично, Telegram уже буде підтверджено." : <>Задайте ONBOARDING_URL, щоб видавати посилання в кабінет. <Link href="/onboarding">Онбординг</Link></>} />{link && <div style={{ marginTop: 10 }}><CopyBox text={link} /></div>}</Section>;
  const ms = a.trialEndsAt.getTime() - Date.now();
  const trial = ms > 0 ? (ms < 3 * 86400_000 ? <Pill tone="warn">закінчується {date(a.trialEndsAt)}</Pill> : <Pill tone="good">тріал до {date(a.trialEndsAt)}</Pill>) : a.extensionCount > 0 ? <Pill tone="mute">доступ завершено</Pill> : <Pill tone="warn">14 днів минули</Pill>;
  const sc = a.quizResultId ? SCENARIOS[a.quizResultId] : null; const dq = a.deepQuiz ?? {}; const fb = (a.feedback ?? {}) as Record<string, unknown>;
  return (
    <Section title="Онбординг" actions={<>{trial}{a.confirmedAt ? <Pill tone="good">Telegram підтверджено</Pill> : <Pill tone="mute">без Telegram</Pill>}</>}>
      <KV items={[
        { k: "Кабінет", v: `${a.name ?? "—"} · ${a.contact ?? "без контакту"} · з ${date(a.registeredAt)}`, mono: true },
        { k: "Тріал", v: `до ${dateTime(a.trialEndsAt)}${a.extensionCount ? ` · бонус +7 днів` : ""}`, mono: true },
        { k: "Квіз", v: sc ? `${sc.name} (сценарій ${a.quizResultId}) · ${date(a.quizCompletedAt)}${a.shchyroSyncedAt ? " · передано в «Щиро»" : a.personId ? " · ще не передано в «Щиро»" : ""}` : a.quizStartedAt ? "почала, не завершила" : "не проходила", mono: true },
        { k: "Додаткові тести", v: `ресурс: ${dq.test1 ? `категорія ${dq.test1.category}, бал ${dq.test1.score}` : "—"} · безпека: ${dq.test2 ? `категорія ${dq.test2.category}, бал ${dq.test2.score}${dq.test2.hasCriticalRedFlag ? " · червоний прапорець" : ""}` : "—"}`, mono: true },
        { k: "Анкета", v: a.feedbackAt ? `${date(a.feedbackAt)} · оцінка ${String(fb.q1 ?? fb.experienceRating ?? fb.nps_rating ?? "—")}` : "не заповнювала", mono: true },
        { k: "Остання дія", v: dateTime(a.lastSeenAt), mono: true },
      ]} />
      {(a.tags ?? []).length > 0 && <div className="tags" style={{ marginTop: 10 }}>{(a.tags ?? []).map((t) => <Link key={t} href={`/people?tag=${encodeURIComponent(t)}`} className="tagbtn" title={TAG_LABELS[t] ?? t}>{t}</Link>)}</div>}
      {a.feedbackAt && Object.keys(fb).length > 0 && <div style={{ marginTop: 8 }}><FilterGroup title="Відповіді анкети"><KV items={Object.entries(fb).filter(([, v]) => v !== "" && v != null).map(([k, v]) => ({ k, v: String(v) }))} /></FilterGroup></div>}
      {link && <div style={{ marginTop: 10 }}><CopyBox text={link} /><p className="fld-h" style={{ marginTop: 6 }}>Одноразове, діє 48 годин, відкриває кабінет без пароля.</p></div>}
      <div style={{ marginTop: 12 }}>{actions}</div>
    </Section>
  );
}
