import { json, preflight, notReady, body } from "../../_lib";
import { telegramLogin, sessionTokenFor, profilePayload } from "@/lib/onboarding";
export const dynamic = "force-dynamic";
export const OPTIONS = (req: Request) => preflight(req);
/**
 * POST — дані з Telegram Login Widget ({ id, first_name, last_name?, username?, photo_url?, auth_date, hash }) → session_token, user.
 * Підпис перевіряється ключем Hub-бота; кабінет знаходиться за Telegram ID або створюється. user.must_set_password — показати форму пароля.
 */
export async function POST(req: Request) {
  const nr = notReady(req); if (nr) return nr;
  const b = await body<Record<string, string | number>>(req);
  if (!b?.hash) return json(req, { success: false, error: "telegram data is required" }, 400);
  const r = await telegramLogin(b);
  if (!r.ok) return json(req, { success: false, error: r.error }, 401);
  return json(req, { success: true, session_token: sessionTokenFor(r.account.id, { telegram: true }), user: await profilePayload(r.account) });
}
