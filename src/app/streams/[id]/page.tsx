import Link from "next/link";
import { notFound } from "next/navigation";
import { Radio, Download, Trash2, Save } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { PageHeader, Section, Field, Alert, EmptyState, Stat } from "@/components/ui/layout";
import { Kebab, MenuAction, MenuLink, MenuSep } from "@/components/ui/controls";
import { CopyField } from "@/components/ui/copy-field";
import { navCounts, safe } from "@/lib/queries";
import { streamDetail, streamLinks, hubBotUsername } from "@/lib/streams";
import { saveStream, deleteStream } from "@/lib/actions";

export const dynamic = "force-dynamic";

const kyivInput = (d: Date) => { const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d); const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00"; return `${g("year")}-${g("month")}-${g("day")}T${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}`; };
const when = (d: Date | string) => new Date(d).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default async function StreamPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; saved?: string; err?: string }> }) {
  const { id } = await params; const sp = await searchParams;
  const [counts, d, botUser] = await Promise.all([navCounts(), safe(() => streamDetail(Number(id)), null), safe(() => hubBotUsername(), null)]);
  if (!d) notFound();
  const { s, visitors, members } = d;
  const links = streamLinks(s.code, botUser); const main = links.miniapp ?? links.bot;
  const club = visitors.filter((v) => v.zen || v.hub).length;
  return (
    <Shell title="Етери" counts={counts}>
      <PageHeader back="/streams" backLabel="Етери" icon={<Radio size={16} />} title={s.title} status={<Pill tone="moon">{when(s.startsAt)}</Pill>}
        actions={<Kebab><MenuLink href={`/api/export/streams?id=${s.id}`} icon={<Download />}>Завантажити список (CSV)</MenuLink><MenuSep /><MenuAction action={deleteStream} fields={{ id: s.id }} icon={<Trash2 />} danger confirm={`Видалити «${s.title}» разом зі списком тих, хто перейшов? Теги в людей лишаться.`}>Видалити етер</MenuAction></Kebab>} />
      {sp.created && <Alert tone="ok">Етер створено. Скопіюйте посилання нижче й опублікуйте в каналі (текстом або кнопкою під постом). Кожен, хто перейде, з'явиться в списку.</Alert>}
      {sp.saved && <Alert tone="ok">Збережено.</Alert>}
      {sp.err && <Alert tone="bad">{sp.err}</Alert>}
      {!s.youtubeUrl && <Alert tone="warn">Посилання на YouTube ще не додано: ті, хто перейде, побачать «посилання з'явиться ближче до початку» і все одно потраплять у список. Додайте його праворуч, коли трансляція буде готова.</Alert>}
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Перейшли" value={visitors.length} hint="унікальні люди за Telegram ID" />
        <Stat label="З них учасниць клубу" value={club} hint="чинна підписка ZenEdu чи Hub зараз" />
        <Stat label="Охоплення клубу" value={members ? `${Math.round((club / members) * 100)}%` : "—"} hint={`з ${members} учасниць клубу`} />
        <Stat label="Не з клубу" value={visitors.length - club} hint="без чинної підписки: переслане посилання чи колишні учасниці" />
      </div>
      <div className="grid g21">
        <div>
          <Section title="Посилання для каналу" description={links.miniapp ? "Відкриває етер одним дотиком (Mini App): Telegram передає, хто перейшов, і одразу відкриває YouTube." : "Відкриває Hub-бот: людина натискає «Старт», бот записує її і дає кнопку «Дивитись етер»."}>
            {main ? <CopyField value={main} open ariaLabel="Посилання на етер" /> : <EmptyState title="Hub-бот не підключено" text="Підключіть бота в «Система → Боти й меню»." />}
            {links.miniapp && links.bot && <div style={{ marginTop: 10 }}><div className="fld-h" style={{ marginBottom: 6 }}>Запасне, через бота (якщо Mini App не відкривається):</div><CopyField value={links.bot} compact ariaLabel="Запасне посилання через бота" /></div>}
          </Section>
          <Section title="Хто перейшов" description={visitors.length ? `Отримали тег «${s.tag ?? "—"}». Статус учасниці — на зараз.` : undefined} className="tbl">
            {visitors.length ? <table><thead><tr><th>Людина</th><th>Telegram ID</th><th>Учасниця</th><th>Перейшла</th><th className="num">Переходів</th></tr></thead><tbody>
              {visitors.map((v) => <tr key={v.personId}><td><Link href={`/people/${v.personId}`}>{v.name}</Link>{v.username && <div className="fld-h">@{v.username}</div>}</td><td className="mono">{v.telegramUserId}</td>
                <td>{v.zen && <Pill tone="moon">ZenEdu</Pill>}{v.hub && <Pill tone="acc">Hub</Pill>}{!v.zen && !v.hub && <Pill tone="mute">не з клубу</Pill>}</td>
                <td className="mono">{when(v.firstAt)}</td><td className="num">{v.clicks}</td></tr>)}
            </tbody></table> : <EmptyState icon={<Radio size={20} />} title="Ще ніхто не перейшов" text="Опублікуйте посилання в каналі: список оновлюється одразу після кожного переходу." />}
          </Section>
        </div>
        <form action={saveStream} className="form aside-sticky"><input type="hidden" name="id" value={s.id} />
          <Section title="Налаштування">
            <Field label="Назва"><input name="title" defaultValue={s.title} /></Field>
            <Field label="Дата і час" hint="за київським часом"><input type="datetime-local" name="startsAt" defaultValue={kyivInput(s.startsAt)} /></Field>
            <Field label="Посилання на трансляцію YouTube" hint="Можна змінити будь-коли: посилання для каналу лишається тим самим."><input name="youtubeUrl" defaultValue={s.youtubeUrl ?? ""} placeholder="https://youtube.com/live/…" /></Field>
            <Field label="Тег для тих, хто перейде" hint="додається людині в картку при першому переході"><input name="tag" defaultValue={s.tag ?? ""} /></Field>
            <div className="row-actions" style={{ marginTop: 14 }}><button className="btn pri" type="submit"><Save size={15} /> Зберегти</button></div>
          </Section>
        </form>
      </div>
    </Shell>
  );
}
