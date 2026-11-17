import Link from "next/link";
import { ClipboardList, Link2, Send, KeyRound } from "lucide-react";
import { Pill } from "@/components/ui";
import { Section, KV, EmptyState, FilterGroup } from "@/components/ui/layout";
import { CopyBox } from "@/app/settings/copy-box";
import { cabinetLink, resetCabinetPassword } from "@/lib/actions";
import { Kebab, MenuAction } from "@/components/ui/controls";
import { accountForPerson, onboardingConfigured, SCENARIOS, TAG_LABELS } from "@/lib/onboarding";
import { clubAccess } from "@/lib/club";
import { date, dateTime } from "@/lib/format";

/** Блок «Онбординг» у картці людини: кабінет, доступ за підпискою клубу, квіз і тести, анкета, посилання в кабінет. */
export default async function OnboardingPerson({ personId, link }: { personId: number; link?: string }) {
  const a = await accountForPerson(personId).catch(() => null);
  const configured = onboardingConfigured();
  const actions = <div className="row-actions">
    <form action={cabinetLink}><input type="hidden" name="personId" value={personId} /><button className="btn sm" type="submit" disabled={!configured}><Link2 size={14} /> Посилання в кабінет</button></form>
    <form action={cabinetLink}><input type="hidden" name="personId" value={personId} /><input type="hidden" name="send" value="1" /><button className="btn sm" type="submit" disabled={!configured}><Send size={14} /> Надіслати в бот</button></form>
    {a && <Kebab><MenuAction action={resetCabinetPassword} fields={{ personId }} icon={<KeyRound />} danger confirm="Скинути пароль кабінету? Людина не зможе увійти за старим паролем: вона входить через Telegram (кнопка на сайті) і одразу створює новий.">Скинути пароль кабінету</MenuAction></Kebab>}
  </div>;
  if (!a) return <Section title="Онбординг" actions={actions}><EmptyState icon={<ClipboardList size={18} />} title="Кабінету ще немає" text={configured ? "Надішліть посилання: кабінет створиться автоматично, Telegram уже буде підтверджено." : <>Задайте ONBOARDING_URL, щоб видавати посилання в кабінет. <Link href="/onboarding">Онбординг</Link></>} />{link && <div style={{ marginTop: 10 }}><CopyBox text={link} /></div>}</Section>;
  // доступ до платформи — лише за чинною підпискою клубу (lib/club)
  const club = await clubAccess(a.personId).catch(() => null);
  const VIA: Record<string, string> = { zenedu: "підписка ZenEdu", hub: "підписка Hub", grant: "право на канал", team: "команда" };
  const trial = club?.member ? <Pill tone="good">доступ: {VIA[club.via ?? ""] ?? "учасниця"}</Pill> : club?.hadClub ? <Pill tone="mute">підписка закінчилась</Pill> : <Pill tone="mute">немає підписки клубу</Pill>;
  const sc = a.quizResultId ? SCENARIOS[a.quizResultId] : null; const dq = a.deepQuiz ?? {}; const fb = (a.feedback ?? {}) as Record<string, unknown>;
  return (
    <Section title="Онбординг" actions={<>{trial}{a.confirmedAt ? <Pill tone="good">Telegram підтверджено</Pill> : <Pill tone="mute">без Telegram</Pill>}</>}>
      <KV items={[
        { k: "Кабінет", v: `${a.name ?? "—"} · ${a.contact ?? "без контакту"} · з ${date(a.registeredAt)}`, mono: true },
        { k: "Пароль", v: a.passwordHash ? "створено — вхід за логіном і паролем" : "ще немає — перший вхід через Telegram", mono: true },
        { k: "Доступ до платформи", v: club?.member ? `${VIA[club.via ?? ""] ?? "учасниця"}${club.until ? ` · до ${dateTime(club.until)}` : " · безстроково"}` : club?.hadClub ? "закрито: підписка клубу закінчилась" : "немає: підписки клубу не було", mono: true },
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
