import { json, preflight, notReady, body } from "../../_lib";
import { registerAccount, sessionTokenFor, profilePayload } from "@/lib/onboarding";
export const dynamic = "force-dynamic";
export const OPTIONS = (req: Request) => preflight(req);
/** POST { name, contact, password?, utm? } → session_token, user (з telegram_link для підтвердження через Hub-бот). */
export async function POST(req: Request) {
  const nr = notReady(req); if (nr) return nr;
  const b = await body<{ name?: string; contact?: string; password?: string; utm?: Record<string, string>; force?: boolean }>(req);
  if (!b?.name || !b?.contact) return json(req, { success: false, error: "name and contact are required" }, 400);
  if (b.password && b.password.length < 4) return json(req, { success: false, error: "password too short" }, 400);
  const r = await registerAccount({ name: b.name, contact: b.contact, password: b.password, utm: b.utm, source: "web" });
  if (!r.ok) return json(req, { success: false, error: r.error, exists: r.error === "account_exists" }, r.error === "account_exists" ? 409 : 400);
  return json(req, { success: true, session_token: sessionTokenFor(r.account.id), user: await profilePayload(r.account) });
}
