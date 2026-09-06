import Link from "next/link";
import Shell from "@/components/shell";
import { navCounts, planById, resourceList } from "@/lib/queries";
import { savePlan } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function PlanForm({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isNew = id === "new";
  const [counts, pl, res] = await Promise.all([navCounts(), isNew ? Promise.resolve(null) : planById(Number(id)), resourceList()]);
  const e = pl?.entitlements ?? {};
  return (
    <Shell title={isNew ? "Новий тариф" : `Тариф: ${pl?.name ?? ""}`} counts={counts}>
      <form action={savePlan} className="card form" style={{ maxWidth: 720 }}>
        {!isNew && <input type="hidden" name="id" value={pl?.id} />}
        <div className="form two"><label className="field">Назва<input name="name" defaultValue={pl?.name ?? ""} required /></label><label className="field">Внутрішній код<input name="key" defaultValue={pl?.key ?? ""} placeholder="club_ai" /></label></div>
        <div className="form two"><label className="field">Ціна<input name="price" type="number" step="0.01" defaultValue={pl?.price ?? "999"} required /></label><label className="field">Валюта<select name="currency" defaultValue={pl?.currency ?? "UAH"}><option>UAH</option><option>USD</option><option>EUR</option></select></label></div>
        <div className="form two"><label className="field">Період<select name="period" defaultValue={pl?.period ?? "month"}><option value="month">Місяць</option><option value="quarter">3 місяці</option><option value="year">Рік</option></select></label><label className="field">Порядок показу<input name="sortOrder" type="number" defaultValue={pl?.sortOrder ?? 0} /></label></div>
        <div className="form two"><label className="field">Пробний період, днів (0 = немає)<input name="trialDays" type="number" defaultValue={pl?.trialDays ?? 0} /></label><label className="field">Ціна пробного періоду<input name="trialPrice" type="number" step="0.01" defaultValue={pl?.trialPrice ?? ""} placeholder="99" /></label></div>
        <div className="field">Права, які дає тариф</div>
        {res.length ? res.map((r) => (<div className="ck" key={r.key}><input type="checkbox" name={`ent:${r.key}`} defaultChecked={e[r.key] !== undefined} /> {r.name} <code className="mono muted">{r.key}</code><input name={`quota:${r.key}`} defaultValue={e[r.key] ?? ""} placeholder="квота, напр. 40/день" style={{ marginLeft: "auto", width: 160, border: "1px solid var(--line-2)", borderRadius: 6, padding: "3px 8px" }} /></div>))
          : <p className="note">Ресурсів ще немає, створіть їх у розділі <Link href="/resources">Доступи</Link>.</p>}
        <div className="ck"><input type="checkbox" name="isActive" defaultChecked={pl?.isActive ?? true} /> Тариф активний (показується в боті)</div>
        <div className="ck"><input type="checkbox" name="isFeatured" defaultChecked={pl?.isFeatured ?? false} /> Рекомендований</div>
        <div className="row-actions"><button className="btn pri" type="submit">Зберегти</button><Link className="btn" href="/plans">Скасувати</Link></div>
        <p className="note">Зміна ціни не торкається чинних підписок: у кожної своя ціна.</p>
      </form>
    </Shell>
  );
}
