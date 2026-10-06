import { json, preflight, notReady, body } from "../../_lib";
import { loginAccount, sessionTokenFor, profilePayload } from "@/lib/onboarding";
export const dynamic = "force-dynamic";
export const OPTIONS = (req: Request) => preflight(req);
/** POST { contact, password } → session_token, user. */
export async function POST(req: Request) {
  const nr = notReady(req); if (nr) return nr;
  const b = await body<{ contact?: string; password?: string }>(req);
  if (!b?.contact) return json(req, { success: false, error: "contact is required" }, 400);
  const r = await loginAccount(b.contact, b.password ?? "");
  if (!r.ok) return json(req, { success: false, error: r.error }, r.error === "not_found" ? 404 : 401);
  return json(req, { success: true, session_token: sessionTokenFor(r.account.id), user: await profilePayload(r.account) });
}
