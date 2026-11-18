import { json, preflight, notReady } from "../../_lib";
import { accountBySession } from "@/lib/onboarding";
import { cabinetArchive, cabinetStream, isClubMember, ARCHIVE_DAYS, ARCHIVE_MAX } from "@/lib/streams";
export const dynamic = "force-dynamic";
export const OPTIONS = (req: Request) => preflight(req);
/**
 * GET, Authorization: Bearer <session_token> (необов'язково) → { current, archive, member, logged_in, days, max }.
 * current — найближчий етер або той, що йде (як streams/current, але без уже завершених); archive — записи завершених етерів
 * за 30 днів, не більше 4, найновіші спершу. Посилань YouTube немає: перегляд — POST streams/watch з { code }.
 */
export async function GET(req: Request) {
  const nr = notReady(req); if (nr) return nr;
  const a = await accountBySession(req);
  const [current, archive] = await Promise.all([cabinetStream(), cabinetArchive()]);
  return json(req, { success: true, current: current && current.state !== "recent" ? current : null, archive, member: a ? await isClubMember(a.personId) : false, logged_in: Boolean(a), days: ARCHIVE_DAYS, max: ARCHIVE_MAX });
}
