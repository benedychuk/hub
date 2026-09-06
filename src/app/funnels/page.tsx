import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { navCounts, funnelList } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Funnels() {
  const [counts, list] = await Promise.all([navCounts(), funnelList()]);
  return (
    <Shell title="Воронки" counts={counts}>
      <div className="alert">Це список воронок ZenEdu лише для читання. Редактор кроків, як у прототипі, з'явиться разом із власним ботом на етапі 2. Кроки ZenEdu API не віддає, тому їхній зміст переноситься вручну.</div>
      <div className="card tbl"><table><thead><tr><th>Воронка</th><th className="num">Людей</th><th className="num">Кроків</th><th>Стан</th></tr></thead><tbody>
        {list.map((f) => <tr key={f.id}><td>{f.name}</td><td className="num">{f.subscribersCount.toLocaleString("uk-UA")}</td><td className="num">{f.stepsCount}</td><td><Pill tone={f.isActive ? "good" : "mute"}>{f.isActive ? "активна" : "вимкнена"}</Pill></td></tr>)}
        {!list.length && <tr><td colSpan={4} className="muted">Ще не імпортовано.</td></tr>}
      </tbody></table></div>
    </Shell>
  );
}
