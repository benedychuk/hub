import Link from "next/link";
import { Magnet, Search, Inbox } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { Section, Field, FormRow, Stat, Alert, EmptyState } from "@/components/ui/layout";
import { navCounts, safe } from "@/lib/queries";
import { tagConversion, tagBuyers, knownTags, type TagQuery } from "@/lib/tag-stats";
import { money, dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
type SP = { tag?: string; from?: string; to?: string; h?: string };
const WINDOWS = [[24, "24 години"], [48, "48 годин"], [72, "3 дні"], [168, "7 днів"]] as const;
const SRC: Record<string, string> = { funnel: "воронка", funnel_link: "посилання", broadcast: "розсилка", automation: "автоматизація", stream: "етер", manual: "вручну", onboarding: "платформа", zenedu: "ZenEdu" };
const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(d);
/** Північ дати за Києвом (з урахуванням літнього часу). */
const kyivStart = (s: string) => { const u = new Date(`${s}T00:00:00Z`); const k = new Date(u.toLocaleString("en-US", { timeZone: "Europe/Kyiv" })); const z = new Date(u.toLocaleString("en-US", { timeZone: "UTC" })); return new Date(u.getTime() - (k.getTime() - z.getTime())); };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%`.replace(".", ",") : "—");
const after = (m: number) => (m < 60 ? `${m} хв` : `${Math.floor(m / 60)} год ${m % 60 ? `${m % 60} хв` : ""}`.trim());

/** Маркетинг → «Лід-магніти і статті»: хто купив протягом N годин після отримання тегу (без тих, хто вже був у клубі). */
export default async function LeadMagnetsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const now = new Date();
  const fromS = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : ymd(new Date(now.getTime() - 30 * 86400_000));
  const toS = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : ymd(now);
  const hours = WINDOWS.some(([h]) => String(h) === sp.h) ? Number(sp.h) : 24;
  const tag = (sp.tag ?? "").trim() || null;
  const q: TagQuery = { from: kyivStart(fromS), to: new Date(kyivStart(toS).getTime() + 86400_000), hours, tag };
  const [counts, tags, rows, buyers] = await Promise.all([
    navCounts(), safe(() => knownTags(), []), safe(() => tagConversion(q), null), tag ? safe(() => tagBuyers({ ...q, tag }), []) : Promise.resolve([]),
  ]);
  const one = tag ? rows?.find((r) => r.tag === tag) : null;
  const winLabel = WINDOWS.find(([h]) => h === hours)?.[1] ?? `${hours} год`;
  const qs = (t: string) => `/lead-magnets?${new URLSearchParams({ tag: t, from: fromS, to: toS, h: String(hours) })}`;
  return (
    <Shell title="Лід-магніти і статті" counts={counts}>
      <div className="ph"><span className="ph-ico"><Magnet size={16} /></span><h2 className="ph-title">Хто купує після лід-магніту чи статті</h2></div>
      <form method="get">
        <Section title="Що рахуємо" description={`Беремо людей, які вперше отримали тег у вибраний період, і дивимось, чи була в них оплата протягом ${winLabel} після цього. Ті, хто на момент тегу вже мав чинну підписку на клуб, у конверсію не потрапляють; команда й тестувальники теж.`}>
          <FormRow>
            <Field label="Тег" hint="порожньо — усі теги за період"><input name="tag" defaultValue={tag ?? ""} list="lm-tags" placeholder="наприклад, стаття_тривога" /></Field>
            <Field label="Покупка протягом"><select name="h" defaultValue={String(hours)}>{WINDOWS.map(([h, l]) => <option key={h} value={h}>{l}</option>)}</select></Field>
          </FormRow>
          <FormRow>
            <Field label="Отримали тег з"><input name="from" type="date" defaultValue={fromS} /></Field>
            <Field label="по (включно)"><input name="to" type="date" defaultValue={toS} /></Field>
          </FormRow>
          <datalist id="lm-tags">{tags.map((t) => <option key={t.tag} value={t.tag}>{t.n}</option>)}</datalist>
          <div className="row-actions" style={{ marginTop: 14 }}><button className="btn pri" type="submit"><Search size={15} /> Показати</button>{tag && <Link className="btn ghost" href={`/lead-magnets?${new URLSearchParams({ from: fromS, to: toS, h: String(hours) })}`}>Усі теги</Link>}</div>
        </Section>
      </form>
      {rows === null && <Alert tone="bad">Не вдалося порахувати. Оновіть сторінку; якщо не допоможе, напишіть розробнику.</Alert>}

      {tag && rows && (one ? <>
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <Stat label="Отримали тег" value={one.got} hint={`уперше з ${fromS.split("-").reverse().join(".")} по ${toS.split("-").reverse().join(".")}`} />
          <Stat label="Вже були в клубі" value={one.members} hint="мали чинну підписку на момент тегу — не рахуються" />
          <Stat label={`Купили за ${winLabel}`} value={one.buyers} hint={`з ${one.base} нових${one.revenue ? ` · ${money(Math.round(one.revenue), "UAH")}` : ""}`} />
          <Stat label="Конверсія" value={pct(one.buyers, one.base)} tone={one.buyers ? "good" : undefined} hint="купили / нові (без учасниць клубу)" />
        </div>
        <Section title="Хто купив" description="Перша оплата кожної людини після тегу. Сума — у валюті оплати." className="tbl">
          {buyers.length ? <table><thead><tr><th>Людина</th><th>Отримала тег</th><th>Оплатила</th><th>Через</th><th>Що купила</th><th className="num">Сума</th></tr></thead><tbody>
            {buyers.map((b) => <tr key={b.person_id}><td><Link href={`/people/${b.person_id}`}>{b.name}</Link>{b.username && <div className="fld-h">@{b.username}</div>}</td>
              <td className="mono">{dateTime(b.tag_at)}{b.approx && <div className="fld-h">ZenEdu, ±1 год</div>}</td><td className="mono">{dateTime(b.paid_at)}</td><td className="mono">{after(b.mins)}</td>
              <td>{b.offer ?? "—"}</td><td className="num">{money(Number(b.price), b.currency)}</td></tr>)}
          </tbody></table> : <EmptyState icon={<Inbox size={20} />} title="Покупок після цього тегу немає" text={`Ніхто з ${one.base} нових людей не оплатив протягом ${winLabel}.`} />}
        </Section>
      </> : <div className="card"><EmptyState icon={<Magnet size={20} />} title={`Тег «${tag}» за цей період ніхто не отримав`} text="Перевірте написання тегу (підказки з'являються під час введення) або розширте період." /></div>)}

      {!tag && rows && <Section title="Усі теги за період" description={`Відсортовано за кількістю нових людей. Натисніть тег, щоб побачити, хто купив.`} className="tbl">
        {rows.length ? <table><thead><tr><th>Тег</th><th className="num">Отримали</th><th className="num">Вже в клубі</th><th className="num">Нові</th><th className="num">Купили</th><th className="num">Конверсія</th><th className="num">Сума, грн</th><th>Звідки тег</th></tr></thead><tbody>
          {rows.map((r) => <tr key={r.tag}><td><Link href={qs(r.tag)}>{r.tag}</Link></td><td className="num">{r.got}</td><td className="num">{r.members}</td><td className="num">{r.base}</td>
            <td className="num">{r.buyers}</td><td className="num">{r.buyers ? <Pill tone="good">{pct(r.buyers, r.base)}</Pill> : pct(r.buyers, r.base)}</td><td className="num">{r.revenue ? money(Math.round(r.revenue), "UAH") : "—"}</td>
            <td className="fld-h">{r.sources.split(",").map((s) => SRC[s] ?? s).join(", ")}</td></tr>)}
        </tbody></table> : <EmptyState icon={<Inbox size={20} />} title="За цей період тегів не було" text="Розширте період." />}
      </Section>}
      <p className="fld-h" style={{ marginTop: 10 }}>Час тегу з воронок, посилань, кнопок розсилок, автоматизацій і етерів записується з самого початку. Теги, поставлені вручну, на платформі та в ZenEdu, рахуються з 27.11.2026; для ZenEdu час відомий з точністю до години (синхронізація щогодини).</p>
    </Shell>
  );
}
