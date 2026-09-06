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
