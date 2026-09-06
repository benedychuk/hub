import { cookies } from "next/headers";
import { runFullSyncStep, runIncrementalSync, resetSyncCursor } from "@/lib/sync";
import { COOKIE, authEnabled, sessionToken } from "@/lib/auth";
import { hasDb } from "@/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function authorized() {
  if (!authEnabled()) return true;
  const c = (await cookies()).get(COOKIE)?.value;
  return c === sessionToken();
}

export async function POST(req: Request) {
  if (!(await authorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!hasDb()) return Response.json({ error: "DATABASE_URL не задано" }, { status: 500 });
  const { mode } = await req.json().catch(() => ({ mode: "full" }));
  try {
    if (mode === "reset") { await resetSyncCursor(); return Response.json({ done: true, phase: "start" }); }
    if (mode === "incremental") { const stats = await runIncrementalSync(); return Response.json({ done: true, stats }); }
    const r = await runFullSyncStep();
    return Response.json(r);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
