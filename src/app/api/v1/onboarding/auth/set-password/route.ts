import { json, preflight, notReady, body } from "../../_lib";
import { accountBySession, setAccountPassword, profilePayload } from "@/lib/onboarding";
export const dynamic = "force-dynamic";
export const OPTIONS = (req: Request) => preflight(req);
/** POST, Authorization: Bearer <session_token>, { password, current_password? } — перший пароль (без старого) або зміна (зі старим). Мінімум 6 символів. */
export async function POST(req: Request) {
  const nr = notReady(req); if (nr) return nr;
  const a = await accountBySession(req);
  if (!a) return json(req, { success: false, error: "unauthorized" }, 401);
  const b = await body<{ password?: string; current_password?: string }>(req);
  const r = await setAccountPassword(a, String(b?.password ?? ""), b?.current_password);
  if (!r.ok) return json(req, { success: false, error: r.error }, r.error === "bad_password" ? 401 : 400);
  return json(req, { success: true, user: await profilePayload({ ...a, passwordHash: "set" }) });
}
