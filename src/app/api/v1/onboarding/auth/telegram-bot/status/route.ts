import { json, preflight, notReady } from "../../../_lib";
import { botLoginStatus, sessionTokenFor, profilePayload } from "@/lib/onboarding";
export const dynamic = "force-dynamic";
export const OPTIONS = (req: Request) => preflight(req);
/** GET ?code= → pending | confirmed (session_token і user — один раз) | expired. */
export async function GET(req: Request) {
  const nr = notReady(req); if (nr) return nr;
  const code = new URL(req.url).searchParams.get("code") ?? "";
  const r = await botLoginStatus(code);
  if (r.status !== "confirmed") return json(req, { success: true, status: r.status });
  return json(req, { success: true, status: "confirmed", session_token: sessionTokenFor(r.account.id), user: await profilePayload(r.account) });
}
