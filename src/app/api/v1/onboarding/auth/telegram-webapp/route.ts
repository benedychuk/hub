import { json, preflight, notReady, body } from "../../_lib";
import { loginByTelegramUser, sessionTokenFor, profilePayload } from "@/lib/onboarding";
import { verifyWebAppInitData } from "@/lib/streams";
export const dynamic = "force-dynamic";
export const OPTIONS = (req: Request) => preflight(req);
/**
 * POST { init_data } — сайт відкрито всередині Telegram (Mini App): підпис перевіряється ключем Hub-бота → session_token, user, next.
 * next — сторінка, яку відкрити після входу: start_param «efir» або «ev_<код>» → efir.html, інакше cabinet.html.
 */
export async function POST(req: Request) {
  const nr = notReady(req); if (nr) return nr;
  const b = await body<{ init_data?: string }>(req);
  const v = process.env.TELEGRAM_BOT_TOKEN ? verifyWebAppInitData(String(b?.init_data ?? ""), process.env.TELEGRAM_BOT_TOKEN) : null;
  if (!v) return json(req, { success: false, error: "bad_signature" }, 401);
  const r = await loginByTelegramUser(v.user, "telegram_webapp");
  const next = /^(efir|ev_[A-Za-z0-9]+)$/.test(v.startParam) ? "efir.html" : "cabinet.html";
  return json(req, { success: true, next, session_token: sessionTokenFor(r.account.id, { telegram: true }), user: await profilePayload(r.account) });
}
