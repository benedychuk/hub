import { json, preflight, notReady } from "../../_lib";
import { sessionFrom, profilePayload } from "@/lib/onboarding";
export const dynamic = "force-dynamic";
export const OPTIONS = (req: Request) => preflight(req);
/**
 * Паролів більше немає (вхід лише через Telegram). Запит зі старої версії платформи не зберігає нічого
 * й відповідає успіхом, щоб людина не застрягла на формі пароля.
 */
export async function POST(req: Request) {
  const nr = notReady(req); if (nr) return nr;
  const sess = await sessionFrom(req);
  if (!sess) return json(req, { success: false, error: "unauthorized" }, 401);
  return json(req, { success: true, ignored: true, user: await profilePayload(sess.account) });
}
