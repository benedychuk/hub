import { json, preflight, notReady, body } from "../../_lib";
import { accountBySession, trackEvent, type TrackInput } from "@/lib/onboarding";
export const dynamic = "force-dynamic";
export const OPTIONS = (req: Request) => preflight(req);
/** POST { event_type, tag?, page?, payload? } → tag_added, active_tags_count (матриця ТЗ, розділ 3). */
export async function POST(req: Request) {
  const nr = notReady(req); if (nr) return nr;
  const a = await accountBySession(req);
  if (!a) return json(req, { success: false, error: "unauthorized" }, 401);
  const b = await body<TrackInput>(req);
  if (!b?.event_type) return json(req, { success: false, error: "event_type is required" }, 400);
  const r = await trackEvent(a, b);
  if (!r.ok) return json(req, { success: false, error: r.error }, 400);
  return json(req, { success: true, tag_added: r.tag_added, tags_added: r.tags_added, active_tags_count: r.active_tags_count, trial_expires_at: r.account.trialEndsAt.toISOString() });
}
