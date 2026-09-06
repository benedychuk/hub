import Link from "next/link";
import NavLinks from "./nav-links";
import { hasDb } from "@/db";

export default function Shell({ title, children, counts }: { title: string; children: React.ReactNode; counts?: Record<string, number> }) {
  const ready = hasDb() && Boolean(process.env.ZENEDU_API_TOKEN);
  return (
    <div className="app">
      <aside className="side">
        <Link className="brand" href="/"><i />Hub <small>клуб Марії</small></Link>
        <NavLinks counts={counts ?? {}} />
        <div className="foot"><b>Адміністратор</b>{process.env.ADMIN_PASSWORD ? "вхід за паролем" : "пароль не заданий"}</div>
      </aside>
      <div className="main">
        <div className="top">
          <h1>{title}</h1>
          <form className="search" action="/people"><span className="muted">⌕</span><input name="q" placeholder="Ім'я, username, telegram id, телефон…" aria-label="Пошук людини" /></form>
          <span className={`badge ${ready ? "ok" : ""}`}>{ready ? "дані з ZenEdu · лише читання" : "налаштування не завершено"}</span>
        </div>
        <div className="page">{children}</div>
      </div>
    </div>
  );
}
