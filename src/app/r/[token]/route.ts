import { resolveLink } from "@/lib/broadcasts";

export const dynamic = "force-dynamic";

/** Редирект кнопки-посилання розсилки з обліком кліку. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = await resolveLink(token).catch(() => null);
  if (!url) return new Response("Посилання недійсне", { status: 404 });
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
}
