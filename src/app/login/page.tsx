import { redirect } from "next/navigation";
import { currentUser, usersExist, authEnabled, MIN_PASSWORD } from "@/lib/auth";
import { login, bootstrapOwner } from "@/lib/users";
import { hasDb } from "@/db";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const sp = await searchParams;
  if (await currentUser()) redirect(sp.next && sp.next.startsWith("/") ? sp.next : "/");
  const exist = await usersExist();
  return (
    <div className="login">
      <div className="card" style={{ width: exist ? undefined : "min(460px, 94vw)" }}>
        <div className="brand" style={{ color: "var(--ink)", padding: "0 0 14px" }}><i /><span>Hub</span> <small>клуб Марії</small></div>
        {sp.error && <div className="alert bad">{sp.error === "1" ? "Пароль не підійшов." : sp.error}</div>}
        {!hasDb() ? <p className="muted">База даних ще не підключена: панель відкрита без пароля.</p> : exist ? (
          <form action={login} className="form">
            <input type="hidden" name="next" value={sp.next ?? "/"} />
            <label className="field">Email<input type="email" name="email" autoComplete="username" autoFocus required /></label>
            <label className="field">Пароль<input type="password" name="password" autoComplete="current-password" required /></label>
            <button className="btn pri" type="submit">Увійти</button>
            <p className="note">Забули пароль? Попросіть власника Hub надіслати посилання для скидання (Налаштування → Користувачі).</p>
          </form>
        ) : (
          <form action={bootstrapOwner} className="form">
            <h3 style={{ margin: 0 }}>Перший вхід: акаунт власника</h3>
            <p className="note" style={{ margin: 0 }}>Замість спільного пароля в Hub тепер особисті акаунти. Створіть акаунт власника: далі ви зможете запрошувати адміністраторів і керувати їхнім доступом.</p>
            <label className="field">Ваше ім’я<input name="name" autoFocus required maxLength={80} /></label>
            <label className="field">Email (логін)<input type="email" name="email" autoComplete="username" required /></label>
            <div className="form two"><label className="field">Пароль (від {MIN_PASSWORD} знаків, літери й цифри)<input type="password" name="password" autoComplete="new-password" required minLength={MIN_PASSWORD} /></label><label className="field">Ще раз<input type="password" name="password2" autoComplete="new-password" required /></label></div>
            {authEnabled() && <label className="field">Поточний пароль ADMIN_PASSWORD (підтвердження, що це ви)<input type="password" name="adminPassword" required /></label>}
            <button className="btn pri" type="submit">Створити акаунт і увійти</button>
          </form>
        )}
      </div>
    </div>
  );
}
