import { hasDb } from "@/db";
import { corsHeaders, bearer } from "@/lib/onboarding";

/** Спільне для маршрутів платформи онбордингу: CORS, JSON, перевірка бази. */
export function json(req: Request, body: unknown, status = 200) { return Response.json(body, { status, headers: corsHeaders(req.headers.get("origin")) }); }
export function preflight(req: Request) { return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) }); }
export function notReady(req: Request) { return hasDb() ? null : json(req, { success: false, error: "not configured" }, 503); }
export async function body<T>(req: Request): Promise<T | null> { try { return (await req.json()) as T; } catch { return null; } }
/** Токен із заголовка Authorization або з тіла запиту (поле name). */
export async function bearerOrBody(req: Request, name: string) {
  const h = bearer(req); if (h) return h;
  const b = await body<Record<string, string>>(req); return b?.[name] ?? null;
}
