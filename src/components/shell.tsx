import Link from "next/link";
import { Search } from "lucide-react";
import { Suspense } from "react";
import NavLinks from "./nav-links";
import { ConfirmProvider } from "./ui/confirm";
import { hasDb } from "@/db";
import { currentUser, ROLE_LABEL } from "@/lib/auth";
import { logout } from "@/lib/users";

export default async function Shell({ title, children, counts }: { title: string; children: React.ReactNode; counts?: Record<string, number> }) {
  const ready = hasDb() && Boolean(process.env.ZENEDU_API_TOKEN);
  const me = await currentUser();
  return (
    <div className="app">
      <aside className="side">
        <Link className="brand" href="/"><i /><span>Hub</span> <small>клуб Марії</small></Link>
        <Suspense fallback={null}><NavLinks counts={counts ?? {}} /></Suspense>
        <div className="foot">{me ? <><b>{me.name}</b><span className="row-actions" style={{ justifyContent: "space-between" }}><span>{ROLE_LABEL[me.role] ?? me.role}</span><form action={logout}><button type="submit" className="lnk">Вийти</button></form></span></> : <><b>Адміністратор</b>{process.env.ADMIN_PASSWORD ? "спільний пароль · " : "пароль не заданий · "}<Link href="/settings?tab=users" style={{ color: "var(--orange-2)" }}>створити акаунт</Link></>}</div>
      </aside>
      <div className="main">
        <div className="top">
          <h1>{title}</h1>
          <form className="search" action="/people"><Search size={15} className="muted" /><input name="q" placeholder="Знайти людину: ім’я, @username, telegram id, телефон" aria-label="Пошук людини" /></form>
          {!ready && <Link href="/settings" className="badge">Налаштування не завершено</Link>}
        </div>
        <div className="page"><ConfirmProvider>{children}</ConfirmProvider></div>
      </div>
    </div>
  );
}
