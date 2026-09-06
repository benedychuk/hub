import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, checkPassword, sessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function login(formData: FormData) {
  "use server";
  const pw = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");
  if (!checkPassword(pw)) redirect("/login?error=1&next=" + encodeURIComponent(next));
  (await cookies()).set(COOKIE, sessionToken(), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  redirect(next.startsWith("/") ? next : "/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="login">
      <div className="card">
        <div className="brand" style={{ color: "var(--ink)", padding: "0 0 14px" }}><i />Hub <small>клуб Марії</small></div>
        {sp.error && <div className="alert bad">Пароль не підійшов.</div>}
        <form action={login} className="form">
          <input type="hidden" name="next" value={sp.next ?? "/"} />
          <label className="field">Пароль адміністратора<input type="password" name="password" autoFocus required /></label>
          <button className="btn pri" type="submit">Увійти</button>
        </form>
        <p className="note">Пароль задається змінною оточення ADMIN_PASSWORD на Vercel.</p>
      </div>
    </div>
  );
}
