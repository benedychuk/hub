import { json, preflight, notReady } from "../../_lib";
import { accountBySession } from "@/lib/onboarding";
import { cabinetStream, isClubMember } from "@/lib/streams";
export const dynamic = "force-dynamic";
export const OPTIONS = (req: Request) => preflight(req);
/**
 * GET, Authorization: Bearer <session_token> (необов'язково) → { stream, member }.
 * stream: актуальний етер для банера й сторінки efir.html або null; member: чи має людина доступ до етерів (учасниця клубу).
 * Посилання YouTube тут не віддається — лише через POST streams/watch, щоб кожен перехід було записано.
 */
export async function GET(req: Request) {
  const nr = notReady(req); if (nr) return nr;
  const a = await accountBySession(req);
  return json(req, { success: true, stream: await cabinetStream(), member: a ? await isClubMember(a.personId) : false, logged_in: Boolean(a) });
}
