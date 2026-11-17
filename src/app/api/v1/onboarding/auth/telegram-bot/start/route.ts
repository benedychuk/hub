import { json, preflight, notReady, body } from "../../../_lib";
import { botLoginStart } from "@/lib/onboarding";
import { hubBotUsername } from "@/lib/streams";
export const dynamic = "force-dynamic";
export const OPTIONS = (req: Request) => preflight(req);
/** POST { next? } → одноразовий код входу через Hub-бота (5 хв) і посилання t.me/<бот>?start=login_<код>. */
export async function POST(req: Request) {
  const nr = notReady(req); if (nr) return nr;
  const bot = await hubBotUsername();
  if (!bot) return json(req, { success: false, error: "bot_not_configured" }, 503);
  const b = await body<{ next?: string }>(req);
  const r = await botLoginStart(b?.next);
  return json(req, { success: true, code: r.code, bot_url: `https://t.me/${bot}?start=login_${r.code}`, expires_in: r.expiresIn });
}
