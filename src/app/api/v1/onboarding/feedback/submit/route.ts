import { json, preflight, notReady, body } from "../../_lib";
import { accountBySession, submitFeedback, registerAccount, sessionTokenFor } from "@/lib/onboarding";
export const dynamic = "force-dynamic";
export const OPTIONS = (req: Request) => preflight(req);
/** POST { answers, guest?: { name, contact } } → +7 днів один раз. Гість без сесії реєструється тут же (feedback.html відкрито за прямим посиланням). */
export async function POST(req: Request) {
  const nr = notReady(req); if (nr) return nr;
  const b = await body<{ answers?: Record<string, unknown>; guest?: { name?: string; contact?: string } }>(req);
  if (!b?.answers || typeof b.answers !== "object") return json(req, { success: false, error: "answers are required" }, 400);
  let a = await accountBySession(req); let token: string | null = null;
  if (!a) {
    if (!b.guest?.name || !b.guest?.contact) return json(req, { success: false, error: "unauthorized" }, 401);
    const r = await registerAccount({ name: b.guest.name, contact: b.guest.contact, source: "feedback" });
    if (!r.ok) { if (r.error === "account_exists" && r.account) a = r.account; else return json(req, { success: false, error: r.error }, 400); } else a = r.account;
    token = sessionTokenFor(a.id);
  }
  const r = await submitFeedback(a, b.answers);
  return json(req, { success: true, extended: r.extended, trial_expires_at: r.account.trialEndsAt.toISOString(), extended_end_time: r.account.trialEndsAt.getTime(), extension_count: r.account.extensionCount, tags: r.account.tags, ...(token ? { session_token: token } : {}) });
}
