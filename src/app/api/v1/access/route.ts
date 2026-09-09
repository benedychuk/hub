import { authBot, checkAccess } from "@/lib/access";
import { hasDb } from "@/db";

export const dynamic = "force-dynamic";

// GET /api/v1/access?telegram_user_id=…&resource=shchyro.access
export async function GET(req: Request) {
  if (!hasDb()) return Response.json({ error: "not configured" }, { status: 503 });
  const bot = await authBot(req);
  if (!bot) return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const tg = Number(url.searchParams.get("telegram_user_id"));
  const resource = url.searchParams.get("resource") || bot.resourceKey || "";
  if (!tg || !resource) return Response.json({ error: "telegram_user_id and resource are required" }, { status: 400 });
  try { return Response.json(await checkAccess(tg, resource), { headers: { "cache-control": "no-store" } }); }
  catch (e) { return Response.json({ error: String(e) }, { status: 500 }); }
}
