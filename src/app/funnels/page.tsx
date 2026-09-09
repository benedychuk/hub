import Link from "next/link";
import { Plus, FolderPlus, Link2, Eye, Play, Pause, Settings, FolderInput, Copy, Trash2, LayoutGrid, List, Users, Zap, Layers, GitBranch, Pencil } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { Toolbar, EmptyState } from "@/components/ui/layout";
import { Kebab, MenuAction, MenuLink, MenuSep } from "@/components/ui/controls";
import { Modal } from "@/components/modal";
import { navCounts, funnelList, funnelFolders, botList } from "@/lib/queries";
import { createFunnel, createFolder, renameFolder, deleteFolder, setFunnelStatus, moveFunnel, duplicateFunnel, deleteFunnel } from "@/lib/actions";
import { date } from "@/lib/format";

export const dynamic = "force-dynamic";
type SP = { folder?: string; q?: string; sort?: string; view?: string };

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
  const statusPill = (f: (typeof rows)[number]) => <Pill tone={f.isActive ? "good" : f.status === "stopped" ? "warn" : "mute"}>{f.isActive ? "активна" : f.status === "stopped" ? "зупинена" : "чернетка"}</Pill>;
  return (
    <Shell title="Воронки" counts={counts}>
      <div className="folders">
        <Link href={link({ folder: "" })} className={`folder ${!folderId ? "on" : ""}`}>Усі <span className="n">{hubCount}</span></Link>
        {folders.map((f) => <Link key={f.id} href={link({ folder: String(f.id) })} className={`folder ${folderId === f.id ? "on" : ""}`}>{f.name} <span className="n">{f.n}</span></Link>)}
        {noneCount > 0 && folders.length > 0 && <Link href={link({ folder: "none" })} className={`folder ${folderId === "none" ? "on" : ""}`}>Без папки <span className="n">{noneCount}</span></Link>}
        {zenCount > 0 && <Link href={link({ folder: "zen" })} className={`folder ${folderId === "zen" ? "on" : ""}`}>ZenEdu <span className="n">{zenCount}</span></Link>}
        <Modal title="Нова папка" width={420} trigger={<button type="button" className="folder"><FolderPlus size={14} /> Папка</button>}><form action={createFolder} className="form"><div className="fld"><label className="fld-l">Назва папки</label><input name="name" placeholder="Онбординг" required /></div><div className="modal-f"><button className="btn pri" type="submit">Створити папку</button></div></form></Modal>
        {cur && <Kebab label="Папка"><MenuSep /><MenuAction action={deleteFolder} fields={{ id: cur.id }} icon={<Trash2 />} danger confirm={`Видалити папку «${cur.name}»? Воронки в ній залишаться без папки.`}>Видалити папку</MenuAction></Kebab>}
      </div>
      {cur && <form action={renameFolder} className="row-actions" style={{ marginBottom: 14 }}><input type="hidden" name="id" value={cur.id} /><input name="name" defaultValue={cur.name} className="input" style={{ width: 260 }} aria-label="Назва папки" /><button className="btn sm" type="submit"><Pencil size={14} /> Перейменувати</button></form>}
      <Toolbar actions={<Modal title="Нова воронка" width={460} trigger={<button type="button" className="btn pri"><Plus size={15} /> Воронка</button>}><form action={createFunnel} className="form"><div className="fld"><label className="fld-l">Назва</label><input name="name" placeholder="Онбординг після оплати" required /></div>
        <div className="fld"><label className="fld-l">Папка</label><select name="folderId" defaultValue={cur?.id ?? ""}><option value="">Без папки</option>{folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
        <div className="modal-f"><button className="btn pri" type="submit">Створити воронку</button></div></form></Modal>}>
        <form className="search" method="get"><input name="q" defaultValue={sp.q ?? ""} placeholder="Пошук воронки" />{sp.folder && <input type="hidden" name="folder" value={sp.folder} />}{sp.sort && <input type="hidden" name="sort" value={sp.sort} />}{sp.view && <input type="hidden" name="view" value={sp.view} />}</form>
        <div className="seg">{[["updated", "Змінені"], ["created", "Нові"], ["name", "За назвою"], ["subs", "За людьми"]].map(([k, l]) => <Link key={k} href={link({ sort: k })} className={sort === k ? "on" : ""}>{l}</Link>)}</div>
        <div className="seg"><Link href={link({ view: "grid" })} className={view === "grid" ? "on" : ""} title="Сітка"><LayoutGrid size={15} /></Link><Link href={link({ view: "list" })} className={view === "list" ? "on" : ""} title="Список"><List size={15} /></Link></div>
      </Toolbar>
      {!rows.length && <div className="card"><EmptyState icon={<GitBranch size={20} />} title={q ? "Нічого не знайдено" : folderId === "zen" ? "Воронки ZenEdu ще не імпортовано" : "У цій папці ще немає воронок"} text={q ? "Спробуйте інший запит." : folderId === "zen" ? "Запустіть імпорт у Налаштуваннях." : "Створіть першу воронку: кроки, кнопки, розклад надсилання."} /></div>}
      <div className={view === "grid" ? "fgrid" : "grid flist"}>
        {rows.map((f) => { const zen = f.source !== "hub"; const href = zen ? "#" : `/funnels/${f.id}`; return (
          <div key={f.id} className="fcard">
            <Link href={href} className={`cover ${zen ? "zen" : ""}`} style={f.cover ? { backgroundImage: `url(${f.cover})` } : undefined} aria-label={f.name} />
            <div className="body">
              <b><Link href={href}>{f.name}</Link></b>
              <div className="row-actions">{statusPill(f)}{zen && <Pill tone="moon">ZenEdu</Pill>}</div>
              <div className="meta"><span title="Людей"><Users size={12} /> {f.subscribersCount.toLocaleString("uk-UA")}</span><span title="Проходять зараз"><Zap size={12} /> {f.activeNow}</span><span title="Кроків"><Layers size={12} /> {f.stepsCount}</span><span>{date(f.updatedAt)}</span></div>
            </div>
            {!zen && <Kebab>
              <MenuLink href={`/funnels/${f.id}?tab=settings#links`} icon={<Link2 />}>Посилання</MenuLink>
              <MenuLink href={`/f/${f.id}`} icon={<Eye />} external>Перегляд лендінгу</MenuLink>
              <MenuAction action={setFunnelStatus} fields={{ id: f.id, status: f.isActive ? "stopped" : "active" }} icon={f.isActive ? <Pause /> : <Play />}>{f.isActive ? "Зупинити" : "Активувати"}</MenuAction>
              <MenuLink href={`/funnels/${f.id}?tab=settings`} icon={<Settings />}>Налаштування</MenuLink>
              <MenuSep />
              {folders.filter((x) => x.id !== f.folderId).map((x) => <MenuAction key={x.id} action={moveFunnel} fields={{ id: f.id, folderId: x.id }} icon={<FolderInput />}>Перемістити в «{x.name}»</MenuAction>)}
              {f.folderId && <MenuAction action={moveFunnel} fields={{ id: f.id, folderId: "" }} icon={<FolderInput />}>Прибрати з папки</MenuAction>}
              <MenuAction action={duplicateFunnel} fields={{ id: f.id }} icon={<Copy />}>Дублювати</MenuAction>
              <MenuSep />
              <MenuAction action={deleteFunnel} fields={{ id: f.id }} icon={<Trash2 />} danger confirm={`Видалити воронку «${f.name}» разом із кроками й статистикою?`}>Видалити</MenuAction>
            </Kebab>}
          </div>); })}
      </div>
      <p className="fld-h" style={{ marginTop: 18 }}>Посилання на воронку має вигляд t.me/{botUser ?? "hub-бот"}?start=f_ID. Воронки ZenEdu показано для довідки; їхні кроки через API не віддаються.</p>
    </Shell>
  );
}
