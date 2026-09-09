import { beginPayment, parsePayToken } from "@/lib/payments";

export const dynamic = "force-dynamic";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Створює спробу оплати й перекидає на WayForPay автосабмітом форми. */
export async function GET(req: Request, { params }: { params: Promise<{ plan: string }> }) {
  const { plan } = await params; const url = new URL(req.url);
  const kind = (["first", "card", "migrate"].includes(url.searchParams.get("k") ?? "") ? url.searchParams.get("k") : "first") as "first" | "card" | "migrate";
  const personId = parsePayToken(url.searchParams.get("u") ?? undefined, plan, kind);
  if (!personId) return Response.redirect(`${url.origin}/pay/${encodeURIComponent(plan)}?err=${encodeURIComponent("Посилання недійсне")}`, 302);
  try {
    const { form } = await beginPayment(personId, plan, kind);
    const inputs = Object.entries(form.fields).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => `<input type="hidden" name="${esc(k)}" value="${esc(String(x))}">`)).join("");
    const html = `<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>Перехід до оплати</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;color:#282b2b}p{color:#8a9399}</style></head><body><div><p>Перенаправляємо на захищену сторінку оплати WayForPay…</p><form id="f" method="POST" action="${form.action}" accept-charset="utf-8">${inputs}<noscript><button type="submit">Перейти до оплати</button></noscript></form></div><script>document.getElementById("f").submit()</script></body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  } catch (e) {
    return Response.redirect(`${url.origin}/pay/${encodeURIComponent(plan)}?u=${encodeURIComponent(url.searchParams.get("u") ?? "")}&k=${kind}&err=${encodeURIComponent(String(e).slice(0, 160))}`, 302);
  }
}
