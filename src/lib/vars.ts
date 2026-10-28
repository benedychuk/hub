import type { schema } from "@/db";

/**
 * Змінні в текстах, які Hub надсилає людям: кроки воронок, розсилки, повідомлення оффера, текст після покупки,
 * тексти каналу, автоматизації. Формати {first_name} і {{first_name}}; значення за замовчуванням: {first_name|друже}.
 * Крім стандартних, підставляються додаткові поля з картки людини (наприклад, відповідь із кроку «Запитання»: {city}).
 * Невідомі назви лишаються як є, щоб не зіпсувати текст із фігурними дужками.
 */
export const STANDARD_VARS: { key: string; label: string }[] = [
  { key: "first_name", label: "ім’я" },
  { key: "last_name", label: "прізвище" },
  { key: "name", label: "ім’я та прізвище" },
  { key: "username", label: "@username" },
  { key: "telegram_id", label: "Telegram ID" },
  { key: "email", label: "email" },
  { key: "phone", label: "телефон" },
];

type Person = Pick<typeof schema.persons.$inferSelect, "firstName" | "lastName" | "username" | "telegramUserId" | "email" | "phone" | "customFields">;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function personVars(p: Person): Record<string, string> {
  const full = [p.firstName, p.lastName].filter(Boolean).join(" ");
  return {
    first_name: p.firstName ?? "", last_name: p.lastName ?? "", name: full || (p.username ? "@" + p.username : ""),
    full_name: full, username: p.username ? "@" + p.username : "", telegram_id: String(p.telegramUserId ?? ""), user_id: String(p.telegramUserId ?? ""),
    email: p.email ?? "", phone: p.phone ?? "",
  };
}

/** Чи є в тексті хоч одна змінна (щоб не робити зайвих запитів до бази). */
export const hasVars = (text: string | null | undefined) => Boolean(text && /\{\{?\s*[A-Za-z_][\w]*\s*(\|[^{}]*)?\}\}?/.test(text));

/** Підставляє змінні людини. html: значення екрануються для parse_mode HTML (значення за замовчуванням уже з редактора). */
export function fillVars(text: string, p: Person | null | undefined, opts: { html?: boolean; extra?: Record<string, string> } = {}) {
  if (!text || !p) return text;
  const std = { ...personVars(p), ...(opts.extra ?? {}) };
  const custom = (p.customFields ?? {}) as Record<string, unknown>;
  const value = (key: string, def: string | undefined, raw: string) => {
    const k = key.trim();
    const known = k in std ? std[k] : k in custom ? String(custom[k] ?? "") : null;
    if (known === null) return raw; // невідома назва: не чіпаємо
    if (!known && def !== undefined) return def; // порожньо → значення за замовчуванням як є
    return opts.html ? esc(known) : known;
  };
  return text
    .replace(/\{\{\s*([A-Za-z_][\w]*)\s*(?:\|([^{}]*))?\}\}/g, (raw, k: string, d?: string) => value(k, d, raw))
    .replace(/\{\s*([A-Za-z_][\w]*)\s*(?:\|([^{}]*))?\}/g, (raw, k: string, d?: string) => value(k, d, raw));
}
