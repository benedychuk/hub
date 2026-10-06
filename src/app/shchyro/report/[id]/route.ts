import { currentUser, usersExist } from "@/lib/auth";
import { shchyroAnalyticsRun } from "@/lib/shchyro";

export const dynamic = "force-dynamic";

/** Звіт аналітики «Щиро» файлом .md (лише для користувачів Hub). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentUser()) && (await usersExist())) return new Response("Потрібен вхід", { status: 401 });
  const { id } = await params;
  const r = await shchyroAnalyticsRun(Number(id));
  if (!r.ok || !r.data.report_md) return new Response("Звіт не знайдено", { status: 404 });
  const day = (r.data.finished_at ?? r.data.started_at ?? "").slice(0, 10) || "report";
  return new Response(r.data.report_md, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="shchyro-zvit-${day}.md"` } });
}
