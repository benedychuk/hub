import Link from "next/link";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { ConfirmSubmit, MenuCloser } from "@/components/funnel-ui";
import { Modal } from "@/components/modal";
import { navCounts, funnelList, funnelFolders, botList } from "@/lib/queries";
import { createFunnel, createFolder, renameFolder, deleteFolder, setFunnelStatus, moveFunnel, duplicateFunnel, deleteFunnel } from "@/lib/actions";
import { date } from "@/lib/format";

export const dynamic = "force-dynamic";
type SP = { folder?: string; q?: string; sort?: string; view?: string; new?: string };

export default async function Funnels({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [counts, list, folders, bl] = await Promise.all([navCounts(), funnelList(), funnelFolders(), botList()]);
  const botUser = bl.find((b) => b.key === "hub")?.username;
  const folderId = sp.folder === "zen" ? "zen" : sp.folder === "none" ? "none" : Number(sp.folder) || 0;
  const q = (sp.q ?? "").trim().toLowerCase();
  const sort = sp.sort ?? "updated"; const view = sp.view === "list" ? "list" : "grid";
  const cur = typeof folderId === "number" && folderId ? folders.find((f) => f.id === folderId) : null;
  let rows = list.filter((f) => folderId === "zen" ? f.source !== "hub" : folderId === "none" ? f.source === "hub" && !f.folderId : folderId ? f.folderId === folderId : f.source === "hub");
  if (q) rows = rows.filter((f) => f.name.toLowerCase().includes(q));
  rows = [...rows].sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "uk") : sort === "subs" ? b.subscribersCount - a.subscribersCount : sort === "created" ? +new Date(b.createdAt) - +new Date(a.createdAt) : +new Date(b.updatedAt) - +new Date(a.updatedAt));
  const link = (p: Partial<SP>) => { const u = new URLSearchParams(); const all = { ...sp, ...p }; for (const [k, v] of Object.entries(all)) if (v) u.set(k, String(v)); const s = u.toString(); return "/funnels" + (s ? "?" + s : ""); };
  const zenCount = list.filter((f) => f.source !== "hub").length, noneCount = list.filter((f) => f.source === "hub" && !f.folderId).length, hubCount = list.filter((f) => f.source === "hub").length;
  return (
    <Shell title="Воронки" counts={counts}>
      <MenuCloser />
      <div className="folders">
        <Link href={link({ folder: "" })} className={`folder ${!folderId ? "on" : ""}`}>Усі <span className="n">{hubCount}</span></Link>
        {folders.map((f) => <Link key={f.id} href={link({ folder: String(f.id) })} className={`folder ${folderId === f.id ? "on" : ""}`}>📁 {f.name} <span className="n">{f.n}</span></Link>)}
        {noneCount > 0 && folders.length > 0 && <Link href={link({ folder: "none" })} className={`folder ${folderId === "none" ? "on" : ""}`}>Без папки <span className="n">{noneCount}</span></Link>}
        {zenCount > 0 && <Link href={link({ folder: "zen" })} className={`folder ${folderId === "zen" ? "on" : ""}`}>ZenEdu <span className="n">{zenCount}</span></Link>}
        <Modal title="Нова папка" width={420} trigger={<button type="button" className="folder" title="Нова папка">+ Папка</button>}><form action={createFolder} className="form"><label className="field">Назва папки<input name="name" placeholder="Онбординг" required /></label><div className="modal-f"><button className="btn pri" type="submit">Створити папку</button></div></form></Modal>
      </div>
      {cur && <div className="card" style={{ marginBottom: 14, padding: "10px 16px" }}><div className="row-actions">
        <form action={renameFolder} className="row-actions"><input type="hidden" name="id" value={cur.id} /><input name="name" defaultValue={cur.name} className="btn sm" style={{ width: 240 }} /><button className="btn sm" type="submit">Перейменувати</button></form>
        <form action={deleteFolder}><input type="hidden" name="id" value={cur.id} /><ConfirmSubmit className="btn sm danger ghost" message={`Видалити папку «${cur.name}»? Воронки в ній залишаться без папки.`}>Видалити папку</ConfirmSubmit></form>
      </div></div>}
      <div className="toolbar">
        <form className="search" method="get"><span className="muted">⌕</span><input name="q" defaultValue={sp.q ?? ""} placeholder="Пошук воронки" />{sp.folder && <input type="hidden" name="folder" value={sp.folder} />}{sp.sort && <input type="hidden" name="sort" value={sp.sort} />}{sp.view && <input type="hidden" name="view" value={sp.view} />}</form>
        <div className="seg">{[["updated", "Змінені"], ["created", "Нові"], ["name", "За назвою"], ["subs", "За людьми"]].map(([k, l]) => <Link key={k} href={link({ sort: k })} className={sort === k ? "on" : ""}>{l}</Link>)}</div>
        <div className="seg"><Link href={link({ view: "grid" })} className={view === "grid" ? "on" : ""} title="Сітка">▦</Link><Link href={link({ view: "list" })} className={view === "list" ? "on" : ""} title="Список">☰</Link></div>
        <span className="spacer" />
        <Modal title="Нова воронка" width={460} trigger={<button type="button" className="btn pri">+ Воронка</button>}><form action={createFunnel} className="form"><label className="field">Назва<input name="name" placeholder="Онбординг після оплати" required /></label>
            <label className="field">Папка<select name="folderId" defaultValue={cur?.id ?? ""}><option value="">Без папки</option>{folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
            <div className="modal-f"><button className="btn pri" type="submit">Створити воронку</button></div></form></Modal>
      </div>
      {!rows.length && <div className="card" style={{ textAlign: "center", padding: 40 }}><p className="muted">{q ? "Нічого не знайдено." : folderId === "zen" ? "Воронки ZenEdu ще не імпортовано (Налаштування → Синхронізація)." : "У цій папці ще немає воронок. Натисніть «+ Воронка»."}</p></div>}
      <div className={view === "grid" ? "fgrid" : "grid flist"}>
        {rows.map((f) => { const zen = f.source !== "hub"; const href = zen ? "#" : `/funnels/${f.id}`; return (
          <div key={f.id} className="fcard">
            <Link href={href} className={`cover ${zen ? "zen" : ""}`} style={f.cover ? { backgroundImage: `url(${f.cover})` } : undefined} aria-label={f.name} />
            <div className="body">
              <b><Link href={href}>{f.name}</Link></b>
              <div className="row-actions"><Pill tone={f.isActive ? "good" : f.status === "stopped" ? "warn" : "mute"}>{f.isActive ? "активна" : f.status === "stopped" ? "зупинена" : "чернетка"}</Pill>{zen && <Pill tone="moon">ZenEdu</Pill>}</div>
              <div className="meta"><span>👥 {f.subscribersCount.toLocaleString("uk-UA")}</span><span>⚡ {f.activeNow} зараз</span><span>▤ {f.stepsCount} кроків</span><span>{date(f.updatedAt)}</span></div>
            </div>
            {!zen && <details className="menu"><summary>⋮</summary><div className="dd">
              <Link href={`/funnels/${f.id}?tab=settings#links`}>🔗 Посилання</Link>
              <a href={`/f/${f.id}`} target="_blank" rel="noreferrer">👁 Перегляд</a>
              <form action={setFunnelStatus}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="status" value={f.isActive ? "stopped" : "active"} /><button type="submit">{f.isActive ? "⏸ Зупинити" : "▶ Активувати"}</button></form>
              <span className="item dis" title="З'явиться разом із продуктами й офферами">🛍 Перетворити на продукт · скоро</span>
              <Link href={`/funnels/${f.id}?tab=settings`}>⚙ Налаштування</Link>
              <div className="sep" />
              <form action={moveFunnel}><input type="hidden" name="id" value={f.id} /><span className="item" style={{ paddingBottom: 0 }}>📁 Перемістити в папку</span><select name="folderId" defaultValue={f.folderId ?? ""}><option value="">Без папки</option>{folders.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select><button type="submit">Перемістити</button></form>
              <form action={duplicateFunnel}><input type="hidden" name="id" value={f.id} /><button type="submit">⧉ Дублювати</button></form>
              <div className="sep" />
              <form action={deleteFunnel}><input type="hidden" name="id" value={f.id} /><ConfirmSubmit className="danger" message={`Видалити воронку «${f.name}» разом із кроками й статистикою?`}>🗑 Видалити</ConfirmSubmit></form>
            </div></details>}
          </div>); })}
      </div>
      <p className="note" style={{ marginTop: 18 }}>Посилання на воронку: t.me/{botUser ?? "<hub-бот>"}?start=f_ID. Воронки ZenEdu показано для довідки; їхні кроки через API не віддаються, зміст переноситься в воронки Hub вручну.</p>
    </Shell>
  );
}
