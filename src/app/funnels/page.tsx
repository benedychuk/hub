import Link from "next/link";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { navCounts, funnelList } from "@/lib/queries";
import { createFunnel } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function Funnels() {
  const [counts, list] = await Promise.all([navCounts(), funnelList()]);
  const hub = list.filter((f) => f.source === "hub"), zen = list.filter((f) => f.source !== "hub");
  return (
    <Shell title="Воронки" counts={counts}>
      <div className="grid g12">
        <div>
          <div className="card" style={{ marginBottom: 16 }}><h3>Воронки Hub <span className="sub">працюють у Hub-боті</span></h3>
            {hub.map((f) => { const s = (f.settings ?? {}) as { entryKind?: string; entryValue?: string }; return (
              <div key={f.id} className="ent"><span className={`dot ${f.isActive ? "" : "off"}`} /><div><b><Link href={`/funnels/${f.id}`}>{f.name}</Link></b><small>вхід: {s.entryKind === "start" ? `посилання ?start=${s.entryValue}` : s.entryKind === "keyword" ? `слово «${s.entryValue}»` : "вручну"} · {f.subscribersCount} людей</small></div><Pill tone={f.isActive ? "good" : "mute"}>{f.isActive ? "активна" : "вимкнена"}</Pill></div>); })}
            {!hub.length && <p className="muted">Ще немає. Створіть першу праворуч.</p>}
          </div>
          <form action={createFunnel} className="card form"><h3>Нова воронка</h3><label className="field">Назва<input name="name" placeholder="Онбординг після оплати" required /></label><div><button className="btn pri" type="submit">Створити і перейти до кроків</button></div></form>
        </div>
        <div className="card tbl"><h3>Воронки ZenEdu <span className="sub">лише читання</span></h3><table><thead><tr><th>Воронка</th><th className="num">Людей</th><th className="num">Кроків</th><th>Стан</th></tr></thead><tbody>
          {zen.map((f) => <tr key={f.id}><td>{f.name}</td><td className="num">{f.subscribersCount.toLocaleString("uk-UA")}</td><td className="num">{f.stepsCount}</td><td><Pill tone={f.isActive ? "good" : "mute"}>{f.isActive ? "активна" : "вимкнена"}</Pill></td></tr>)}
          {!zen.length && <tr><td colSpan={4} className="muted">Ще не імпортовано.</td></tr>}
        </tbody></table><p className="note">Кроки воронок ZenEdu через API не віддаються; їх зміст переноситься вручну у воронки Hub.</p></div>
      </div>
    </Shell>
  );
}
