import Link from "next/link";
import { Plus, FolderPlus, Play, Pause, Settings, FolderInput, Copy, Trash2, LayoutGrid, List, Users, Zap, Layers, Package, Tag, Pencil } from "lucide-react";
import Shell from "@/components/shell";
import { Pill } from "@/components/ui";
import { Toolbar, EmptyState } from "@/components/ui/layout";
import { Kebab, MenuAction, MenuLink, MenuSep } from "@/components/ui/controls";
import { Modal } from "@/components/modal";
import { ProductCreateFields } from "@/components/offer-ui";
import { navCounts, funnelList, funnelFolders, hubOfferList } from "@/lib/queries";
import { createProduct, createFolder, renameFolder, deleteFolder, setFunnelStatus, moveFunnel, duplicateFunnel, deleteFunnel } from "@/lib/actions";
import { date } from "@/lib/format";

export const dynamic = "force-dynamic";
type SP = { folder?: string; q?: string; sort?: string; view?: string };

/** Цифрові продукти (ZenEdu Digital products): зміст, який отримують покупці офферів у Hub-боті. */
export default async function Products({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [counts, list, folders, offers] = await Promise.all([navCounts(), funnelList("product"), funnelFolders("product"), hubOfferList()]);
  const folderId = sp.folder === "none" ? "none" : Number(sp.folder) || 0;
  const q = (sp.q ?? "").trim().toLowerCase();
  const sort = sp.sort ?? "updated"; const view = sp.view === "list" ? "list" : "grid";
  const cur = typeof folderId === "number" && folderId ? folders.find((f) => f.id === folderId) : null;
  let rows = list.filter((f) => folderId === "none" ? !f.folderId : folderId ? f.folderId === folderId : true);
  if (q) rows = rows.filter((f) => f.name.toLowerCase().includes(q));
  rows = [...rows].sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "uk") : sort === "subs" ? b.subscribersCount - a.subscribersCount : sort === "created" ? +new Date(b.createdAt) - +new Date(a.createdAt) : +new Date(b.updatedAt) - +new Date(a.updatedAt));
  const link = (p: Partial<SP>) => { const u = new URLSearchParams(); const all = { ...sp, ...p }; for (const [k, v] of Object.entries(all)) if (v) u.set(k, String(v)); const s = u.toString(); return "/products" + (s ? "?" + s : ""); };
  const noneCount = list.filter((f) => !f.folderId).length;
  const statusPill = (f: (typeof rows)[number]) => <Pill tone={f.isActive ? "good" : f.status === "stopped" ? "warn" : "mute"}>{f.isActive ? "активний" : f.status === "stopped" ? "зупинений" : "чернетка"}</Pill>;
  const offerOptions = offers.map((o) => ({ id: o.pl.id, name: o.pl.name }));
  return (
    <Shell title="Цифрові продукти" counts={counts}>
      <div className="folders">
        <Link href={link({ folder: "" })} className={`folder ${!folderId ? "on" : ""}`}>Усі <span className="n">{list.length}</span></Link>
        {folders.map((f) => <Link key={f.id} href={link({ folder: String(f.id) })} className={`folder ${folderId === f.id ? "on" : ""}`}>{f.name} <span className="n">{f.n}</span></Link>)}
        {noneCount > 0 && folders.length > 0 && <Link href={link({ folder: "none" })} className={`folder ${folderId === "none" ? "on" : ""}`}>Без папки <span className="n">{noneCount}</span></Link>}
        <Modal title="Нова папка" width={420} trigger={<button type="button" className="folder"><FolderPlus size={14} /> Папка</button>}><form action={createFolder} className="form"><input type="hidden" name="kind" value="product" /><div className="fld"><label className="fld-l">Назва папки</label><input name="name" placeholder="Наприклад, Курси" required /></div><div className="modal-f"><button className="btn pri" type="submit">Створити</button></div></form></Modal>
        {cur && <Kebab label="Папка"><MenuSep /><MenuAction action={deleteFolder} fields={{ id: cur.id }} icon={<Trash2 />} danger confirm={`Видалити папку «${cur.name}»? Продукти в ній залишаться без папки.`}>Видалити папку</MenuAction></Kebab>}
      </div>
      {cur && <form action={renameFolder} className="row-actions" style={{ marginBottom: 14 }}><input type="hidden" name="id" value={cur.id} /><input name="name" defaultValue={cur.name} className="input" style={{ width: 260 }} aria-label="Назва папки" /><button className="btn sm" type="submit">Перейменувати</button></form>}
      <Toolbar actions={<Modal title="Новий продукт" width={520} trigger={<button type="button" className="btn pri"><Plus size={15} /> Продукт</button>}><form action={createProduct}><ProductCreateFields offers={offerOptions} folders={folders} defaultFolder={cur?.id ?? null} /></form></Modal>}>
        <form className="search" method="get"><input name="q" defaultValue={sp.q ?? ""} placeholder="Пошук продукту" />{sp.folder && <input type="hidden" name="folder" value={sp.folder} />}{sp.sort && <input type="hidden" name="sort" value={sp.sort} />}{sp.view && <input type="hidden" name="view" value={sp.view} />}</form>
        <div className="seg">{[["updated", "Змінені"], ["created", "Нові"], ["name", "За назвою"], ["subs", "За людьми"]].map(([k, l]) => <Link key={k} href={link({ sort: k })} className={sort === k ? "on" : ""}>{l}</Link>)}</div>
        <div className="seg"><Link href={link({ view: "grid" })} className={view === "grid" ? "on" : ""} title="Сітка"><LayoutGrid size={15} /></Link><Link href={link({ view: "list" })} className={view === "list" ? "on" : ""} title="Список"><List size={15} /></Link></div>
      </Toolbar>
      {!rows.length && <div className="card"><EmptyState icon={<Package size={20} />} title={q ? "Нічого не знайдено" : "Продуктів ще немає"} text={q ? "Спробуйте іншу назву." : "Продукт — це кроки з уроками й матеріалами, які отримує покупець оффера в Hub-боті. Створіть перший: разом можна одразу створити оффер із ціною."} /></div>}
      <div className={view === "grid" ? "fgrid" : "grid flist"}>
        {rows.map((f) => (
          <div key={f.id} className="fcard">
            <Link href={`/products/${f.id}`} className="cover" style={f.cover ? { backgroundImage: `url(${f.cover})` } : undefined} aria-label={f.name} />
            <div className="body">
              <b><Link href={`/products/${f.id}`}>{f.name}</Link></b>
              <div className="row-actions">{statusPill(f)}{f.offersCount ? <Pill tone="moon">офферів: {f.offersCount}</Pill> : <Pill tone="warn">без оффера</Pill>}</div>
              <div className="meta"><span title="Людей із доступом"><Users size={12} /> {f.subscribersCount.toLocaleString("uk-UA")}</span><span title="Проходять зараз"><Zap size={12} /> {f.activeNow}</span><span title="Кроків"><Layers size={12} /> {f.stepsCount}</span><span>{date(f.updatedAt)}</span></div>
            </div>
            <Kebab>
              <MenuLink href={`/products/${f.id}`} icon={<Pencil />}>Редагувати</MenuLink>
              <MenuLink href={`/products/${f.id}?tab=offers`} icon={<Tag />}>Оффери</MenuLink>
              <MenuLink href={`/products/${f.id}?tab=settings`} icon={<Settings />}>Налаштування</MenuLink>
              <MenuAction action={setFunnelStatus} fields={{ id: f.id, status: f.isActive ? "stopped" : "active" }} icon={f.isActive ? <Pause /> : <Play />}>{f.isActive ? "Зупинити" : "Активувати"}</MenuAction>
              <MenuSep />
              {folders.filter((x) => x.id !== f.folderId).map((x) => <MenuAction key={x.id} action={moveFunnel} fields={{ id: f.id, folderId: x.id }} icon={<FolderInput />}>Перемістити в «{x.name}»</MenuAction>)}
              {f.folderId && <MenuAction action={moveFunnel} fields={{ id: f.id, folderId: "" }} icon={<FolderInput />}>Прибрати з папки</MenuAction>}
              <MenuAction action={duplicateFunnel} fields={{ id: f.id }} icon={<Copy />}>Дублювати</MenuAction>
              <MenuSep />
              <MenuAction action={deleteFunnel} fields={{ id: f.id }} icon={<Trash2 />} danger confirm={`Видалити продукт «${f.name}» разом із кроками й статистикою? Він зникне з офферів.`}>Видалити</MenuAction>
            </Kebab>
          </div>))}
      </div>
      <p className="fld-h" style={{ marginTop: 18 }}>Продукт не має власного посилання: доступ дають оффери (оплата або посилання доступу) і картка людини. Перевірити зміст на собі можна кнопкою «Тест собі» всередині продукту.</p>
    </Shell>
  );
}
