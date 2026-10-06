import { json, preflight, notReady } from "../../_lib";
import { accountBySession, profilePayload } from "@/lib/onboarding";
export const dynamic = "force-dynamic";
export const OPTIONS = (req: Request) => preflight(req);
/** GET, Authorization: Bearer <session_token> → актуальний профіль (тріал, підписка, квіз, теги, чи підтверджено Telegram). */
export async function GET(req: Request) {
  const nr = notReady(req); if (nr) return nr;
  const a = await accountBySession(req);
  if (!a) return json(req, { success: false, error: "unauthorized" }, 401);
  return json(req, { success: true, user: await profilePayload(a) });
}
