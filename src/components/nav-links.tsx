"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: ([string, string] | [string, string, string] | ["grp", string])[] = [
  ["/", "Дашборд"], ["/people", "Аудиторія", "people"], ["/chats", "Чати", "chats"], ["/subscriptions", "Підписки", "subs"], ["/payments", "Платежі"],
  ["grp", "Продукт"], ["/plans", "Тарифи й оффери"], ["/resources", "Доступи"],
  ["grp", "Комунікація"], ["/funnels", "Воронки", "funnels"], ["/broadcasts", "Розсилки"], ["/automations", "Автоматизації"],
  ["grp", "Система"], ["/bots", "Боти й меню"], ["/migration", "Міграція з ZenEdu"], ["/settings", "Налаштування"],
];

export default function NavLinks({ counts }: { counts: Record<string, number> }) {
  const path = usePathname();
  return (
    <nav className="nav">
      {ITEMS.map((it, i) => it[0] === "grp" ? <div className="grp" key={i}>{it[1]}</div> : (
        <Link key={it[0]} href={it[0]} className={path === it[0] || (it[0] !== "/" && path.startsWith(it[0])) ? "on" : ""}>
          {it[1]}{it[2] && counts[it[2]] != null && <span className="cnt">{counts[it[2]]}</span>}
        </Link>
      ))}
    </nav>
  );
}
