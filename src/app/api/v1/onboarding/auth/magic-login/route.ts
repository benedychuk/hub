import { json, preflight, notReady, bearerOrBody } from "../../_lib";
import { magicLogin, sessionTokenFor, profilePayload } from "@/lib/onboarding";
export const dynamic = "force-dynamic";
export const OPTIONS = (req: Request) => preflight(req);
/** POST, Authorization: Bearer <auth_token> (або { auth_token }) → session_token, user. Токен одноразовий, 48 годин. */
export async function POST(req: Request) {
  const nr = notReady(req); if (nr) return nr;
  const token = await bearerOrBody(req, "auth_token");
  if (!token) return json(req, { success: false, error: "auth_token is required" }, 400);
  const r = await magicLogin(token);
  if (!r.ok) return json(req, { success: false, error: r.error }, 401);
  return json(req, { success: true, session_token: sessionTokenFor(r.account.id), user: await profilePayload(r.account) });
}
