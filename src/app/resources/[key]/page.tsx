import Link from "next/link";
import { notFound } from "next/navigation";
import { RefreshCw, Pause, Play, Trash2, Radio, Save } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { PageHeader, Section, Field, FormRow, Stat, Row, Alert, EmptyState } from "@/components/ui/layout";
import { Kebab, MenuAction, MenuSep, Switch } from "@/components/ui/controls";
import { navCounts, resourceList, planList } from "@/lib/queries";
import { saveResource, saveChannelResource, refreshChatInfo, toggleResource, deleteResource } from "@/lib/actions";
import { botRightsIn, channelStats, type ChannelConfig } from "@/lib/telegram-access";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
const KINDS: Record<string, string> = { telegram_channel: "Канал", telegram_group: "Група", bot_feature: "Функція бота", external_url: "Посилання", course: "Курс" };
type Cfg = ChannelConfig & { cover?: string; memberCount?: number; username?: string; syncedAt?: string; url?: string; description?: string; zenedu_grants?: boolean; offer_url?: string; quota_per_day?: number };

export default async function ResourcePage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ saved?: string; new?: string }> }) {
  const { key } = await params; const sp = await searchParams;
  const [counts, res, plans] = await Promise.all([navCounts(), resourceList(), planList()]);
  const r = res.find((x) => x.key === key);
  if (!r) notFound();
  const c = (r.config ?? {}) as Cfg;
  const chat = r.kind === "telegram_channel" || r.kind === "telegram_group";
  const [s, rights] = chat ? await Promise.all([channelStats(r.key).catch(() => null), c.chatId && process.env.TELEGRAM_BOT_TOKEN ? botRightsIn(c.chatId) : Promise.resolve(null)]) : [null, null];
  const inPlans = plans.filter((p) => Object.keys((p.entitlements ?? {}) as Record<string, string>).includes(r.key));
  return (
    <Shell title={chat ? "Канали і групи" : "Цифрові продукти"} counts={counts}>
      <PageHeader back={chat ? "/resources" : "/resources?tab=digital"} backLabel={chat ? "Канали і групи" : "Цифрові продукти"} icon={c.cover ? <span style={{ width: 32, height: 32, borderRadius: 9, backgroundImage: `url(${c.cover})`, backgroundSize: "cover", display: "block" }} /> : <Radio size={16} />} title={r.name}
        status={<><Pill tone="moon">{KINDS[r.kind] ?? r.kind}</Pill>{!r.isActive ? <Pill tone="mute">Вимкнено</Pill> : chat && !c.chatId ? <Pill tone="warn">Не підключено</Pill> : chat && rights && !rights.ok ? <Pill tone="crit">Бот без прав</Pill> : <Pill tone="good">Active</Pill>}</>}
        actions={<>{chat && c.chatId && <form action={refreshChatInfo}><input type="hidden" name="key" value={r.key} /><button className="btn sm" type="submit"><RefreshCw size={15} /> Оновити з Telegram</button></form>}
          <Kebab><MenuAction action={toggleResource} fields={{ key: r.key }} icon={r.isActive ? <Pause /> : <Play />}>{r.isActive ? "Вимкнути" : "Увімкнути"}</MenuAction><MenuSep /><MenuAction action={deleteResource} fields={{ key: r.key }} icon={<Trash2 />} danger confirm={`Видалити «${r.name}» з Hub?`}>Видалити</MenuAction></Kebab></>} />
      {sp.new && <Alert tone="ok">{chat ? "Канал підключено. Перевірте режим вступу й тексти, а право доступу додайте в тарифі." : "Продукт створено. Додайте його до тарифу, щоб видавати доступ."}</Alert>}
      {sp.saved && <Alert tone="ok">Збережено.</Alert>}
      {chat && c.enforce !== true && <Alert tone="info">Автоматика доступу для цього чату вимкнена: Hub нікого не запрошує й не виключає. Увімкніть перемикач у налаштуваннях нижче, коли будете готові (для бойового каналу лише після тестів).</Alert>}
      {chat && rights && !rights.ok && <Alert tone="bad">Hub-бот не має потрібних прав у цьому чаті: {(rights as { error?: string }).error ?? `статус ${(rights as { status?: string }).status}`}. Зробіть бота адміністратором із правами «Додавати учасників» і «Блокувати користувачів».</Alert>}
      {chat && s && <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="З правом" value={s.withRight} hint="за тарифом чи вручну" />
        <Stat label="У чаті" value={s.joined} hint={c.memberCount != null ? `усього в Telegram ${c.memberCount}` : undefined} tone="good" />
        <Stat label="Запрошені" value={s.invited} hint="отримали посилання, ще не зайшли" />
        <Stat label="Без права в чаті" value={s.withoutRight} hint="виключить найближчий тік" tone={s.withoutRight ? "crit" : undefined} />
      </div>}
      <div className="grid g21">
        {chat ? (
          <form action={saveChannelResource}><input type="hidden" name="key" value={r.key} />
            <Section title="Налаштування" description={`Код ${r.key}${c.syncedAt ? ` · оновлено ${dateTime(c.syncedAt)}` : ""}`}>
              <Switch name="enforce" defaultChecked={c.enforce === true} label="Автоматика доступу увімкнена" hint="посилання тим, хто має право, виключення тих, хто не має, схвалення заявок. Вимкнено = Hub лише спостерігає і нікого не чіпає" />
              <FormRow><Field label="Назва"><input name="name" defaultValue={r.name} /></Field><Field label="ID чату" hint="заповнюється автоматично при підключенні"><input name="chatId" defaultValue={c.chatId ?? ""} placeholder="-1001234567890" /></Field></FormRow>
              <FormRow><Field label="Режим вступу"><select name="joinMode" defaultValue={c.joinMode ?? "invite"}><option value="invite">Одноразове посилання (як у ZenEdu)</option><option value="request">За заявкою: бот схвалює лише з правом</option></select></Field><Field label="Посилання діє, годин"><input name="inviteTtlHours" type="number" defaultValue={c.inviteTtlHours ?? 24} /></Field></FormRow>
              <FormRow><Field label="Grace після кінця підписки, днів" hint="скільки днів лишати в чаті після закінчення права"><input name="graceDays" type="number" defaultValue={c.graceDays ?? 0} /></Field><Field label="Нотатка"><input name="note" defaultValue={c.note ?? ""} /></Field></FormRow>
              <Field label="Текст із посиланням"><textarea name="inviteText" rows={2} defaultValue={c.inviteText ?? ""} placeholder={`Доступ відкрито: ${r.name}. Посилання одноразове і діє 24 год.`} /></Field>
              <Field label="Текст при виключенні"><textarea name="kickText" rows={2} defaultValue={c.kickText ?? ""} placeholder={`Термін доступу до «${r.name}» завершився. Щоб повернутись, поновіть підписку: /plans`} /></Field>
              <div className="row-actions" style={{ marginTop: 14 }}><button className="btn pri" type="submit"><Save size={15} /> Зберегти</button></div>
            </Section>
          </form>
        ) : (
          <form action={saveResource}><input type="hidden" name="key" value={r.key} /><input type="hidden" name="kind" value={r.kind} />
            <Section title="Налаштування" description={`Код ${r.key}`}>
              <Field label="Назва"><input name="name" defaultValue={r.name} /></Field>
              {(r.kind === "external_url" || r.kind === "course") && <Field label="Посилання, яке отримує людина з правом"><input name="url" defaultValue={c.url ?? ""} placeholder="https://…" /></Field>}
              <Field label="Опис для людини"><textarea name="description" rows={2} defaultValue={c.description ?? ""} /></Field>
              {r.kind === "bot_feature" && <>
                <Switch name="zenedu_grants" defaultChecked={c.zenedu_grants ?? false} label="Доступ усім активним підпискам ZenEdu" hint="перехідний режим, як зараз у «Щиро»" />
                <FormRow><Field label="Квота на день" hint="0 = без ліміту"><input name="quota_per_day" type="number" defaultValue={c.quota_per_day ?? ""} /></Field><Field label="Посилання на оффер для тих, хто без доступу"><input name="offer_url" defaultValue={c.offer_url ?? ""} placeholder="https://t.me/…" /></Field></FormRow>
              </>}
              <Field label="Нотатка"><input name="note" defaultValue={c.note ?? ""} /></Field>
              <div className="row-actions" style={{ marginTop: 14 }}><button className="btn pri" type="submit"><Save size={15} /> Зберегти</button></div>
            </Section>
          </form>
        )}
        <div className="form aside-sticky">
          <Section title="В офферах">{inPlans.length ? inPlans.map((p) => <Row key={p.id} title={<Link href={`/offers/${p.id}`}>{p.name}</Link>} sub={`${p.price} ${p.currency} / ${p.period}`} />) : <EmptyState title="Поки не входить у жоден тариф" text="Додайте у Тарифах, щоб доступ видавався автоматично." action={<Link href="/plans" className="btn sm">Тарифи</Link>} />}</Section>
          {chat && <Section title="Як це працює"><p className="fld-h" style={{ margin: 0 }}>Людина з правом отримує в Hub-боті одноразове посилання, що діє {c.inviteTtlHours ?? 24} год. Коли право закінчується{c.graceDays ? ` і минає ${c.graceDays} дн. grace` : ""}, щохвилинний тік виключає її з чату з можливістю повернутись і надсилає текст при виключенні.</p></Section>}
          {r.kind === "bot_feature" && <Section title="Як це працює"><p className="fld-h" style={{ margin: 0 }}>Зовнішній бот питає в Hub через API, чи має людина право «{r.key}». Ключ для бота створюється в розділі «Боти й меню».</p></Section>}
        </div>
      </div>
    </Shell>
  );
}
