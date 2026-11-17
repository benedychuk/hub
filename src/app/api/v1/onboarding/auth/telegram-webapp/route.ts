import { json, preflight, notReady, body } from "../../_lib";
import { loginByTelegramUser, sessionTokenFor, profilePayload } from "@/lib/onboarding";
import { verifyWebAppInitData } from "@/lib/streams";
export const dynamic = "force-dynamic";
export const OPTIONS = (req: Request) => preflight(req);
/** POST { init_data } — сайт відкрито всередині Telegram (Mini App): підпис перевіряється ключем Hub-бота → session_token, user. */
export async function POST(req: Request) {
  const nr = notReady(req); if (nr) return nr;
  const b = await body<{ init_data?: string }>(req);
  const v = process.env.TELEGRAM_BOT_TOKEN ? verifyWebAppInitData(String(b?.init_data ?? ""), process.env.TELEGRAM_BOT_TOKEN) : null;
  if (!v) return json(req, { success: false, error: "bad_signature" }, 401);
  const r = await loginByTelegramUser(v.user, "telegram_webapp");
  return json(req, { success: true, session_token: sessionTokenFor(r.account.id), user: await profilePayload(r.account) });
}
