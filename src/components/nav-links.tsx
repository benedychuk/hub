"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

type Item = { href: string; label: string; cnt?: string };
type Group = { key: string; label: string; icon: string; href?: string; items?: Item[] };
const ICON: Record<string, React.ReactNode> = {
  home: <svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>,
  box: <svg viewBox="0 0 24 24"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5 12 12l8-4.5M12 12v9" /></svg>,
  trend: <svg viewBox="0 0 24 24"><path d="M3 17 9 11l4 4 8-8" /><path d="M14 7h7v7" /></svg>,
  dollar: <svg viewBox="0 0 24 24"><path d="M12 2v20M17 6.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.5 5 3 5 1.3 5 3.5-2.2 3.5-5 3.5-5-1.5-5-3.5" /></svg>,
  user: <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></svg>,
  cog: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>,
};
const GROUPS: Group[] = [
  { key: "home", label: "Дашборд", icon: "home", href: "/" },
  { key: "products", label: "Продукти", icon: "box", items: [{ href: "/products", label: "Цифрові продукти", cnt: "products" }, { href: "/resources", label: "Канали і групи" }, { href: "/resources?tab=digital", label: "Функції бота й посилання" }] },
  { key: "marketing", label: "Маркетинг", icon: "trend", items: [{ href: "/funnels", label: "Воронки", cnt: "funnels" }, { href: "/broadcasts", label: "Розсилки" }, { href: "/automations", label: "Автоматизації" }, { href: "/library", label: "Бібліотека" }] },
  { key: "sales", label: "Продажі", icon: "dollar", items: [{ href: "/payments", label: "Платежі" }, { href: "/offers", label: "Оффери" }, { href: "/subscriptions", label: "Підписки", cnt: "subs" }] },
  { key: "audience", label: "Аудиторія", icon: "user", items: [{ href: "/people", label: "Люди", cnt: "people" }, { href: "/chats", label: "Чати", cnt: "chats" }] },
  { key: "system", label: "Система", icon: "cog", items: [{ href: "/bots", label: "Боти й меню" }, { href: "/migration", label: "Міграція з ZenEdu" }, { href: "/settings", label: "Налаштування" }] },
];

export default function NavLinks({ counts }: { counts: Record<string, number> }) {
  const path = usePathname(); const sp = useSearchParams();
  const current = path + (sp.get("tab") ? `?tab=${sp.get("tab")}` : "");
  const isOn = (href: string) => href === "/" ? path === "/" : href.includes("?") ? current === href : path === href || (path.startsWith(href + "/")) || (path === "/resources" && href === "/resources" && !sp.get("tab"));
  const activeGroup = GROUPS.find((g) => g.items?.some((i) => isOn(i.href)))?.key;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [compact, setCompact] = useState(false);
  useEffect(() => { try { const o = JSON.parse(localStorage.getItem("nav.open") ?? "{}"); setOpen(o); setCompact(localStorage.getItem("nav.compact") === "1"); } catch { /* ignore */ } }, []);
  useEffect(() => { document.documentElement.dataset.nav = compact ? "compact" : ""; try { localStorage.setItem("nav.compact", compact ? "1" : "0"); } catch { /* ignore */ } }, [compact]);
  // акордеон: відкрита лише одна група, решта згортаються
  const toggle = (k: string) => setOpen((o) => { const wasOpen = o[k] ?? k === activeGroup; const n: Record<string, boolean> = Object.fromEntries(GROUPS.map((g) => [g.key, false])); n[k] = !wasOpen; try { localStorage.setItem("nav.open", JSON.stringify(n)); } catch { /* ignore */ } return n; });
  const cnt = (k?: string) => k && counts[k] != null ? <span className="cnt">{counts[k]}</span> : null;
  return (
    <nav className="nav">
      {GROUPS.map((g) => {
        if (g.href) return <Link key={g.key} href={g.href} className={`top ${isOn(g.href) ? "on" : ""}`} title={g.label}><span className="ico">{ICON[g.icon]}</span><span className="lbl">{g.label}</span></Link>;
        const expanded = !compact && (open[g.key] ?? g.key === activeGroup);
        return (
          <div key={g.key} className={`grpx ${activeGroup === g.key ? "act" : ""}`}>
            <button type="button" className={`top ${activeGroup === g.key && !expanded ? "on" : ""}`} onClick={() => (compact ? setCompact(false) : toggle(g.key))} title={g.label}><span className="ico">{ICON[g.icon]}</span><span className="lbl">{g.label}</span><span className={`chev ${expanded ? "up" : ""}`}>›</span></button>
            {expanded && <div className="sub">{g.items!.map((i) => <Link key={i.href} href={i.href} className={isOn(i.href) ? "on" : ""}>{i.label}{cnt(i.cnt)}</Link>)}</div>}
            {compact && <div className="fly">{g.items!.map((i) => <Link key={i.href} href={i.href} className={isOn(i.href) ? "on" : ""}>{i.label}{cnt(i.cnt)}</Link>)}</div>}
          </div>);
      })}
      <button type="button" className="collapse" onClick={() => setCompact((c) => !c)} title={compact ? "Розгорнути меню" : "Згорнути меню"}>{compact ? "»" : "«"}<span className="lbl"> Згорнути</span></button>
    </nav>
  );
}
