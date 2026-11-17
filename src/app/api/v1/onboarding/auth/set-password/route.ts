import { json, preflight, notReady, body } from "../../_lib";
import { sessionFrom, setAccountPassword, profilePayload } from "@/lib/onboarding";
export const dynamic = "force-dynamic";
export const OPTIONS = (req: Request) => preflight(req);
/**
 * POST, Authorization: Bearer <session_token>, { password, current_password? } — мінімум 6 символів.
 * Перший пароль — без старого. Новий замість наявного — зі старим, або без нього протягом 30 хв після входу через Telegram.
 * Помилки: password_too_short, current_password_required (попросити старий пароль або увійти через Telegram), bad_password.
 */
export async function POST(req: Request) {
  const nr = notReady(req); if (nr) return nr;
  const sess = await sessionFrom(req);
  if (!sess) return json(req, { success: false, error: "unauthorized" }, 401);
  const a = sess.account;
  const b = await body<{ password?: string; current_password?: string }>(req);
  const r = await setAccountPassword(a, String(b?.password ?? ""), b?.current_password, sess.telegramVerifiedRecently);
  if (!r.ok) return json(req, { success: false, error: r.error }, r.error === "password_too_short" ? 400 : 401);
  return json(req, { success: true, user: await profilePayload({ ...a, passwordHash: "set" }) });
}
