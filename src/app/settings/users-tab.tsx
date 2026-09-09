import { desc, eq, sql } from "drizzle-orm";
import { db, hasDb, schema } from "@/db";
import { Pill } from "@/components/ui";
import { ConfirmSubmit } from "@/components/funnel-ui";
import { Kebab } from "@/components/kebab";
import { CopyBox } from "./copy-box";
import { ROLE_LABEL, INVITE_HOURS, type User } from "@/lib/auth";
import { createUser, resetUserPassword, toggleUser, changeRole, revokeUserSessions, deleteUser } from "@/lib/users";
import { dateTime } from "@/lib/format";

const STATUS: Record<string, [string, string]> = { active: ["Активний", "good"], invited: ["Запрошено", "moon"], disabled: ["Вимкнено", "mute"] };
const EVENT_UA: Record<string, string> = { "user.login": "вхід", "user.login_failed": "невдалий вхід", "user.logout": "вихід", "user.invited": "запрошення", "user.activated": "акаунт активовано", "user.password_reset_link": "посилання для скидання пароля", "user.password_reset": "пароль скинуто", "user.password_changed": "пароль змінено", "user.disabled": "вимкнено", "user.enabled": "увімкнено", "user.role": "зміна ролі", "user.deleted": "видалено", "user.sessions_revoked": "вихід на всіх пристроях", "user.bootstrap": "створено акаунт власника" };

export default async function UsersTab({ me, link, linkFor, reset }: { me: (User & { sessionId: number }) | null; link?: string; linkFor?: string; reset?: boolean }) {
  if (!hasDb()) return <div className="alert">Підключіть базу даних, щоб створювати акаунти.</div>;
  const list = await db().select({ u: schema.users, sessions: sql<number>`(select count(*)::int from user_sessions s where s.user_id = ${schema.users.id} and s.revoked_at is null and s.expires_at > now())` }).from(schema.users).orderBy(sql`case ${schema.users.role} when 'owner' then 0 else 1 end`, schema.users.createdAt);
  const log = await db().select().from(schema.events).where(eq(schema.events.source, "auth")).orderBy(desc(schema.events.createdAt)).limit(30);
  const canManage = (t: User) => me ? (me.id !== t.id && (me.role === "owner" || t.role !== "owner")) : false;
  if (!me) return <div className="card"><h3>Акаунтів ще немає</h3><p>Зараз у Hub діє спільний пароль зі змінної ADMIN_PASSWORD. Щоб додавати інших людей і бачити, хто що робив, спершу створіть акаунт власника: вийдіть на сторінку <a href="/login">/login</a> і заповніть форму «Перший вхід».</p><p className="note">Після цього спільний пароль перестане діяти для входу, а кожен адміністратор матиме власні email і пароль.</p></div>;
  return (
    <div>
            {link && <div className="card" style={{ marginBottom: 16, borderColor: "var(--orange)" }}><h3>{reset ? "Посилання для нового пароля" : "Запрошення створено"} <span className="sub">для {linkFor}</span></h3>
        <p style={{ margin: "0 0 8px" }}>Надішліть це посилання людині особисто (наприклад, у Telegram). Воно діє {INVITE_HOURS} год і спрацьовує один раз; повторно його побачити не можна, але можна створити нове.</p><CopyBox text={link} /></div>}
      <div className="grid g21">
        <div className="card tbl"><h3>Користувачі <span className="sub">{list.length}</span></h3>
          <table><thead><tr><th>Ім’я</th><th>Роль</th><th>Стан</th><th>Останній вхід</th><th className="num">Сесій</th><th></th></tr></thead><tbody>
            {list.map(({ u, sessions }) => { const [sl, st] = STATUS[u.status] ?? [u.status, ""]; return (
              <tr key={u.id}>
                <td><b style={{ fontWeight: 500 }}>{u.name}</b>{u.id === me.id && <span className="muted"> · це ви</span>}<div className="muted mono" style={{ fontSize: 11.5 }}>{u.email}</div></td>
                <td><Pill tone={u.role === "owner" ? "acc" : "moon"}>{ROLE_LABEL[u.role] ?? u.role}</Pill></td>
                <td><Pill tone={st}>{sl}</Pill>{u.lockedUntil && u.lockedUntil.getTime() > Date.now() && <div className="muted" style={{ fontSize: 11.5 }}>заблоковано до {dateTime(u.lockedUntil)}</div>}</td>
                <td className="mono">{u.lastLoginAt ? dateTime(u.lastLoginAt) : "—"}</td>
                <td className="num">{sessions}</td>
                <td>{canManage(u) && <Kebab>
                  <form action={resetUserPassword}><input type="hidden" name="id" value={u.id} /><ConfirmSubmit message={`Створити посилання для нового пароля для ${u.name}? Поточні сесії цієї людини завершаться.`}>🔑 {u.status === "invited" ? "Нове посилання-запрошення" : "Скинути пароль"}</ConfirmSubmit></form>
                  {sessions > 0 && <form action={revokeUserSessions}><input type="hidden" name="id" value={u.id} /><button type="submit">⏏ Вийти на всіх пристроях</button></form>}
                  {me.role === "owner" && <form action={changeRole}><input type="hidden" name="id" value={u.id} /><input type="hidden" name="role" value={u.role === "owner" ? "admin" : "owner"} /><ConfirmSubmit message={u.role === "owner" ? `Зробити ${u.name} адміністратором?` : `Зробити ${u.name} власником? Власник може керувати всіма акаунтами.`}>{u.role === "owner" ? "↓ Зробити адміністратором" : "↑ Зробити власником"}</ConfirmSubmit></form>}
                  <form action={toggleUser}><input type="hidden" name="id" value={u.id} /><button type="submit">{u.status === "disabled" ? "▶ Увімкнути" : "⏸ Вимкнути доступ"}</button></form>
                  <div className="sep" />
                  <form action={deleteUser}><input type="hidden" name="id" value={u.id} /><ConfirmSubmit className="danger" message={`Видалити акаунт ${u.name} (${u.email})? Історія дій залишиться.`}>🗑 Видалити</ConfirmSubmit></form>
                </Kebab>}</td>
              </tr>); })}
          </tbody></table>
          <p className="note">Власник керує всіма акаунтами й ролями. Адміністратор має повний доступ до Hub і може запрошувати інших адміністраторів, але не змінює власників. Себе кожен редагує у вкладці «Мій акаунт».</p>
        </div>
        <div className="form">
          <form action={createUser} className="card form"><h3>Додати користувача</h3>
            <label className="field">Ім’я<input name="name" required maxLength={80} placeholder="Марія" /></label>
            <label className="field">Email (логін)<input type="email" name="email" required placeholder="maria@example.com" /></label>
            {me.role === "owner" ? <label className="field">Роль<select name="role" defaultValue="admin"><option value="admin">Адміністратор: повний доступ до Hub</option><option value="owner">Власник: плюс керування акаунтами й ролями</option></select></label> : <input type="hidden" name="role" value="admin" />}
            <button className="btn pri" type="submit">Створити посилання-запрошення</button>
            <p className="note">Hub не надсилає email: ви отримаєте посилання, за яким людина сама задасть пароль. Посилання діє {INVITE_HOURS} год.</p>
          </form>
          <div className="card"><h3>Правила безпеки</h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.7 }}>
              <li>Пароль від 10 знаків із літерами й цифрами; зберігається лише як scrypt-хеш.</li>
              <li>5 невдалих спроб входу блокують акаунт на 15 хвилин.</li>
              <li>Сесія живе 30 днів; вимкнення акаунта чи скидання пароля завершує всі його сесії негайно.</li>
              <li>Має лишатися хоча б один активний власник.</li>
              <li>Усі входи й зміни акаунтів записуються в журнал нижче.</li>
            </ul>
          </div>
        </div>
      </div>
      <div className="card tbl" style={{ marginTop: 16 }}><h3>Журнал дій з акаунтами <span className="sub">останні {log.length}</span></h3>
        <table><thead><tr><th>Коли</th><th>Подія</th><th>Хто</th><th>Деталі</th></tr></thead><tbody>
          {log.map((e) => { const p = (e.payload ?? {}) as { actor?: { email: string } | null; email?: string; ip?: string; role?: string; attempts?: number; reason?: string }; return <tr key={e.id}><td className="mono">{dateTime(e.createdAt)}</td><td>{EVENT_UA[e.type] ?? e.type}</td><td className="mono">{p.actor?.email ?? "—"}</td><td className="mono muted" style={{ fontSize: 11.5 }}>{[p.email && p.email !== p.actor?.email ? p.email : null, p.role, p.attempts ? `спроба ${p.attempts}` : null, p.reason, p.ip].filter(Boolean).join(" · ")}</td></tr>; })}
          {!log.length && <tr><td colSpan={4} className="muted">Поки порожньо.</td></tr>}
        </tbody></table></div>
    </div>
  );
}
