import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db, hasDb, schema } from "@/db";
import { Pill } from "@/components/ui";
import { ROLE_LABEL, MIN_PASSWORD, type User } from "@/lib/auth";
import { updateProfile, changePassword, revokeMySession, logout } from "@/lib/users";
import { dateTime } from "@/lib/format";

export default async function AccountTab({ me }: { me: (User & { sessionId: number }) | null }) {
  if (!hasDb() || !me) return <div className="card"><p className="muted">Ви увійшли за спільним паролем. Створіть акаунт власника на сторінці <a href="/login">/login</a>, щоб мати особистий профіль.</p></div>;
  const sessions = await db().select().from(schema.userSessions).where(and(eq(schema.userSessions.userId, me.id), isNull(schema.userSessions.revokedAt), gt(schema.userSessions.expiresAt, new Date()))).orderBy(desc(schema.userSessions.lastSeenAt));
  return (
    <div className="grid g2">
      <form action={updateProfile} className="card form"><h3>Профіль <Pill tone={me.role === "owner" ? "acc" : "moon"}>{ROLE_LABEL[me.role] ?? me.role}</Pill></h3>
        <label className="field">Ім’я<input name="name" defaultValue={me.name} required maxLength={80} /></label>
        <label className="field">Email (логін)<input type="email" name="email" defaultValue={me.email} required /></label>
        <div className="row-actions"><button className="btn pri" type="submit">Зберегти</button><form action={logout}><button className="btn ghost" type="submit">Вийти</button></form></div>
      </form>
      <form action={changePassword} className="card form"><h3>Зміна пароля</h3>
        <label className="field">Поточний пароль<input type="password" name="current" autoComplete="current-password" required /></label>
        <div className="form two"><label className="field">Новий пароль (від {MIN_PASSWORD} знаків)<input type="password" name="password" autoComplete="new-password" required minLength={MIN_PASSWORD} /></label><label className="field">Ще раз<input type="password" name="password2" autoComplete="new-password" required /></label></div>
        <div><button className="btn" type="submit">Змінити пароль</button></div>
        <p className="note">Після зміни всі інші пристрої вийдуть з акаунта.</p>
      </form>
      <div className="card tbl" style={{ gridColumn: "1 / -1" }}><h3>Активні сесії <span className="sub">{sessions.length}</span></h3>
        <table><thead><tr><th>Пристрій</th><th>IP</th><th>Вхід</th><th>Остання активність</th><th></th></tr></thead><tbody>
          {sessions.map((s) => <tr key={s.id}><td style={{ maxWidth: 380, whiteSpace: "normal", fontSize: 12.5 }}>{s.userAgent ?? "—"}{s.id === me.sessionId && <Pill tone="good">цей пристрій</Pill>}</td><td className="mono">{s.ip ?? "—"}</td><td className="mono">{dateTime(s.createdAt)}</td><td className="mono">{dateTime(s.lastSeenAt)}</td><td>{s.id !== me.sessionId && <form action={revokeMySession}><input type="hidden" name="id" value={s.id} /><button className="btn sm ghost" type="submit">Завершити</button></form>}</td></tr>)}
        </tbody></table></div>
    </div>
  );
}
