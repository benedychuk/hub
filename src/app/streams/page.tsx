import Link from "next/link";
import { Plus, Radio } from "lucide-react";
import Shell from "@/components/shell";
import { Modal } from "@/components/modal";
import { PageHeader, Section, Field, FormRow, Alert, EmptyState } from "@/components/ui/layout";
import { CopyField } from "@/components/ui/copy-field";
import { ColumnChart } from "@/components/ui/charts";
import { navCounts, safe } from "@/lib/queries";
import { streamList, streamLinks, hubBotUsername, miniAppName, defaultStreamTitle, defaultStreamTag } from "@/lib/streams";
import { createStream } from "@/lib/actions";
import { appUrl } from "@/lib/bot";

export const dynamic = "force-dynamic";

const kyivInput = (d: Date) => { const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d); const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00"; return `${g("year")}-${g("month")}-${g("day")}T${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}`; };
/** Найближчий вівторок (сьогодні, якщо вівторок) о 19:00 за Києвом. */
function nextTuesday() {
  const now = new Date(); const wd = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Kyiv" })).getDay();
  return kyivInput(new Date(now.getTime() + ((2 - wd + 7) % 7) * 86400_000)).slice(0, 11) + "19:00";
}
const fmt = (s: string) => new Date(s).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function StreamsPage() {
  const [counts, list, botUser] = await Promise.all([navCounts(), safe(() => streamList(), []), safe(() => hubBotUsername(), null)]);
  const app = miniAppName();
  const def = nextTuesday(); const defDate = new Date(def + ":00+02:00");
  const recent = [...list].slice(0, 12).reverse();
  return (
    <Shell title="Етери" counts={counts}>
      <PageHeader title="Етери" icon={<Radio size={16} />} actions={<Modal title="Новий етер" width={520} trigger={<button type="button" className="btn pri"><Plus size={15} /> Новий етер</button>}>
        <form action={createStream} className="form">
          <FormRow><Field label="Дата і час" hint="за київським часом"><input type="datetime-local" name="startsAt" defaultValue={def} required /></Field><Field label="Назва" hint="порожньо — «Етер ДД.ММ»"><input name="title" placeholder={defaultStreamTitle(defDate)} /></Field></FormRow>
          <Field label="Посилання на трансляцію YouTube" hint="Можна додати пізніше: посилання для каналу не зміниться."><input name="youtubeUrl" placeholder="https://youtube.com/live/…" /></Field>
          <Field label="Тег для тих, хто перейде" hint="порожньо — тег за датою"><input name="tag" placeholder={defaultStreamTag(defDate)} /></Field>
          <div className="row-actions" style={{ justifyContent: "flex-end" }}><button className="btn pri" type="submit">Створити посилання</button></div>
        </form>
      </Modal>} />
      {!botUser && <Alert tone="warn">Hub-бот ще не підключено: посилання на етер працюють через нього. Підключіть бота в «Система → Боти й меню».</Alert>}
      {botUser && !app && <Alert tone="info">Зараз посилання веде в Hub-бот: людина натискає «Старт», бот записує її і дає кнопку на етер. Щоб етер відкривався одним дотиком, налаштуйте Mini App: у @BotFather → /newapp → бот @{botUser}, адреса <span className="mono">{appUrl()}/live</span>, коротка назва, напр. <span className="mono">live</span>; потім додайте у Vercel змінну TELEGRAM_MINIAPP_NAME з цією назвою.</Alert>}
      {recent.length > 1 && <Section title="Відвідуваність" description="Скільки людей перейшло на кожен етер; з них учасниць клубу (чинна підписка ZenEdu чи Hub зараз)">
        <ColumnChart ariaLabel="Відвідуваність етерів" format="int" height={200} cats={recent.map((s) => ({ key: String(s.id), label: new Date(s.starts_at).toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit" }) }))}
          values={Object.fromEntries(recent.map((s) => [String(s.id), { members: s.members, other: s.visitors - s.members }]))}
          series={[{ key: "members", name: "Учасниці клубу", color: "var(--c1)" }, { key: "other", name: "Не з клубу", color: "var(--c-muted)" }]} />
      </Section>}
      <Section title="Усі етери" className="tbl">
        {list.length ? <table><thead><tr><th>Дата</th><th>Назва</th><th className="num">Перейшли</th><th className="num">Учасниць</th><th style={{ width: "40%" }}>Посилання для каналу</th></tr></thead><tbody>
          {list.map((s) => { const l = streamLinks(s.code, botUser); return <tr key={s.id}><td className="mono">{fmt(s.starts_at)}</td><td><Link href={`/streams/${s.id}`}>{s.title}</Link>{!s.youtube_url && <div className="fld-h">без посилання YouTube</div>}</td><td className="num">{s.visitors}</td><td className="num">{s.members}</td><td>{l.miniapp ?? l.bot ? <CopyField value={(l.miniapp ?? l.bot)!} compact ariaLabel={`Посилання на ${s.title}`} /> : "—"}</td></tr>; })}
        </tbody></table> : <EmptyState icon={<Radio size={20} />} title="Етерів ще немає" text="Створіть етер, опублікуйте посилання в каналі — і тут з'явиться список тих, хто перейшов." />}
      </Section>
    </Shell>
  );
}
