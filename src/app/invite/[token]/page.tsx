import { eq } from "drizzle-orm";
import { db, hasDb, schema } from "@/db";
import { sha256, MIN_PASSWORD, ROLE_LABEL } from "@/lib/auth";
import { acceptInvite } from "@/lib/users";

export const dynamic = "force-dynamic";

/** Публічна сторінка запрошення або скидання пароля. */
export default async function InvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params; const sp = await searchParams;
  const [u] = hasDb() ? await db().select().from(schema.users).where(eq(schema.users.inviteTokenHash, sha256(token))) : [];
  const valid = u && u.inviteExpiresAt && u.inviteExpiresAt.getTime() > Date.now() && u.status !== "disabled";
  const reset = u?.invitePurpose === "reset";
  return (
    <div className="login">
      <div className="card" style={{ width: "min(440px, 94vw)" }}>
        <div className="brand" style={{ color: "var(--ink)", padding: "0 0 14px" }}><i /><span>Hub</span> <small>клуб Марії</small></div>
        {sp.error && <div className="alert bad">{sp.error}</div>}
        {!valid ? <p className="muted">Посилання недійсне або прострочене. Попросіть власника Hub надіслати нове.</p> : (
          <form action={acceptInvite} className="form">
            <input type="hidden" name="token" value={token} />
            <h3 style={{ margin: 0 }}>{reset ? "Новий пароль" : "Вас запрошено до Hub"}</h3>
            <p className="note" style={{ margin: 0 }}>{u.email} · {ROLE_LABEL[u.role] ?? u.role}</p>
            {!reset && <label className="field">Ваше ім’я<input name="name" defaultValue={u.name} required maxLength={80} /></label>}
            <label className="field">Пароль (від {MIN_PASSWORD} знаків, літери й цифри)<input type="password" name="password" autoComplete="new-password" autoFocus required minLength={MIN_PASSWORD} /></label>
            <label className="field">Ще раз<input type="password" name="password2" autoComplete="new-password" required /></label>
            <button className="btn pri" type="submit">{reset ? "Зберегти пароль і увійти" : "Активувати акаунт і увійти"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
