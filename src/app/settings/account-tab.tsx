import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db, hasDb, schema } from "@/db";
import { Pill } from "@/components/ui";
import { Section, Field, FormRow } from "@/components/ui/layout";
import { LogOut, Save, KeyRound } from "lucide-react";
import { ROLE_LABEL, MIN_PASSWORD, type User } from "@/lib/auth";
import { updateProfile, changePassword, revokeMySession, logout } from "@/lib/users";
import { dateTime } from "@/lib/format";

export default async function AccountTab({ me }: { me: (User & { sessionId: number }) | null }) {
  if (!hasDb() || !me) return <div className="card"><p className="muted">Ви увійшли за спільним паролем. Створіть акаунт власника на сторінці <a href="/login">/login</a>, щоб мати особистий профіль.</p></div>;
  const sessions = await db().select().from(schema.userSessions).where(and(eq(schema.userSessions.userId, me.id), isNull(schema.userSessions.revokedAt), gt(schema.userSessions.expiresAt, new Date()))).orderBy(desc(schema.userSessions.lastSeenAt));
  return (
    <div className="grid g2">
      <form action={updateProfile}><Section title="Профіль" actions={<Pill tone={me.role === "owner" ? "acc" : "moon"}>{ROLE_LABEL[me.role] ?? me.role}</Pill>}>
        <Field label="Ім’я"><input name="name" defaultValue={me.name} required maxLength={80} /></Field>
        <Field label="Email (логін)"><input type="email" name="email" defaultValue={me.email} required /></Field>
        <div className="row-actions" style={{ marginTop: 14 }}><button className="btn pri" type="submit"><Save size={15} /> Зберегти</button></div>
      </Section></form>
      <form action={changePassword}><Section title="Зміна пароля" description="Після зміни всі інші пристрої вийдуть з акаунта.">
        <Field label="Поточний пароль"><input type="password" name="current" autoComplete="current-password" required /></Field>
        <FormRow><Field label="Новий пароль" hint={`від ${MIN_PASSWORD} знаків, літери й цифри`}><input type="password" name="password" autoComplete="new-password" required minLength={MIN_PASSWORD} /></Field><Field label="Ще раз"><input type="password" name="password2" autoComplete="new-password" required /></Field></FormRow>
        <div className="row-actions" style={{ marginTop: 14 }}><button className="btn" type="submit"><KeyRound size={15} /> Змінити пароль</button></div>
      </Section></form>
      <div style={{ gridColumn: "1 / -1" }}><Section title="Активні сесії" description={`${sessions.length}`} className="tbl" actions={<form action={logout}><button className="btn sm ghost" type="submit"><LogOut size={14} /> Вийти на цьому пристрої</button></form>}>
        <table><thead><tr><th>Пристрій</th><th>IP</th><th>Вхід</th><th>Остання активність</th><th></th></tr></thead><tbody>
          {sessions.map((s) => <tr key={s.id}><td style={{ maxWidth: 380, whiteSpace: "normal", fontSize: 12.5 }}>{s.userAgent ?? "—"}{s.id === me.sessionId && <Pill tone="good">цей пристрій</Pill>}</td><td className="mono">{s.ip ?? "—"}</td><td className="mono">{dateTime(s.createdAt)}</td><td className="mono">{dateTime(s.lastSeenAt)}</td><td>{s.id !== me.sessionId && <form action={revokeMySession}><input type="hidden" name="id" value={s.id} /><button className="btn sm ghost" type="submit">Завершити</button></form>}</td></tr>)}
        </tbody></table></Section></div>
    </div>
  );
}
