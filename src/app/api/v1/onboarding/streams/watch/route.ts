import { json, preflight, notReady, body } from "../../_lib";
import { accountBySession } from "@/lib/onboarding";
import { isClubMember, watchFromCabinet } from "@/lib/streams";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
export const dynamic = "force-dynamic";
export const OPTIONS = (req: Request) => preflight(req);
/**
 * POST, Authorization: Bearer <session_token>, { code? } → { url } посилання YouTube; перехід записується в Hub (хто, коли, тег етеру).
 * Помилки: unauthorized (увійти), not_member (етери лише для учасниць клубу), no_telegram (кабінет без Telegram — увійти через Telegram),
 * no_stream (етеру немає), no_link_yet (посилання ще не додано — показати час початку), expired (запис старший за 30 днів).
 * recording: true — відкривається запис (етер уже завершився).
 */
export async function POST(req: Request) {
  const nr = notReady(req); if (nr) return nr;
  const a = await accountBySession(req);
  if (!a) return json(req, { success: false, error: "unauthorized" }, 401);
  if (!a.personId) return json(req, { success: false, error: "no_telegram" }, 403);
  if (!(await isClubMember(a.personId))) return json(req, { success: false, error: "not_member" }, 403);
  const [p] = await db().select({ tg: schema.persons.telegramUserId }).from(schema.persons).where(eq(schema.persons.id, a.personId));
  const b = await body<{ code?: string }>(req);
  const r = await watchFromCabinet(a.personId, p.tg, b?.code || undefined);
  if (!r.ok) return json(req, { success: false, ...r }, r.error === "no_link_yet" ? 409 : r.error === "expired" ? 410 : 404);
  return json(req, { success: true, url: r.url, title: r.title, recording: r.recording });
}
