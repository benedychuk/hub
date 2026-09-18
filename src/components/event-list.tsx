import Link from "next/link";
import { describeEvent, type EventRow, type Names } from "@/lib/event-labels";

const GROUP_LABEL: Record<string, string> = { bot: "бот", funnel: "воронка", payment: "оплата", access: "доступ", tag: "тег", admin: "команда", other: "" };
const time = (d: Date) => d.toLocaleTimeString("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" });
const day = (d: Date) => d.toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv", day: "numeric", month: "long", year: "numeric" });

/** Історія людини: події згруповано за днями, кожна з назвою, деталями й посиланням на воронку, оффер чи розсилку. */
export function EventList({ events, names }: { events: EventRow[]; names: Names }) {
  const groups: { day: string; items: EventRow[] }[] = [];
  for (const e of events) { const k = day(e.createdAt); const g = groups[groups.length - 1]; if (g && g.day === k) g.items.push(e); else groups.push({ day: k, items: [e] }); }
  return (
    <div className="tl">
      {groups.map((g) => <div key={g.day} className="tl-day">
        <div className="tl-dayh">{g.day}</div>
        {g.items.map((e) => { const d = describeEvent(e, names); return (
          <div key={e.id} className={`tl-row ${d.tone ?? ""}`}>
            <span className="tl-time mono">{time(e.createdAt)}</span>
            <span className="tl-dot" aria-hidden />
            <div className="tl-body">
              <div>{d.href ? <Link href={d.href} className="lnk-ink">{d.title}</Link> : d.title}{GROUP_LABEL[d.group] ? <span className="tl-grp">{GROUP_LABEL[d.group]}</span> : null}</div>
              {d.detail && <div className="fld-h">{d.detail}</div>}
            </div>
          </div>); })}
      </div>)}
    </div>
  );
}
