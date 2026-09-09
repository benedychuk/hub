import { createHmac } from "crypto";

export const COOKIE = "hub_session";

export function authEnabled() { return Boolean(process.env.ADMIN_PASSWORD); }

export function sessionToken() {
  const pw = process.env.ADMIN_PASSWORD ?? "";
  const secret = process.env.SESSION_SECRET ?? process.env.TELEGRAM_BOT_TOKEN ?? "hub";
  return createHmac("sha256", secret).update("session:" + pw).digest("hex");
}

export function checkPassword(input: string) {
  return authEnabled() && input === process.env.ADMIN_PASSWORD;
}

/** Числовий Telegram id адміністратора зі змінної ADMIN_TELEGRAM_ID; літери й пробіли відкидаються. */
export function adminTelegramId(): number {
  return Number(String(process.env.ADMIN_TELEGRAM_ID ?? "").replace(/\D/g, "")) || 0;
}
