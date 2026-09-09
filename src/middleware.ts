import { NextResponse, type NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";

const COOKIE = "hub_session";
const PUBLIC = ["/login", "/favicon.ico"];
const PUBLIC_PREFIX = ["/api/", "/_next", "/f/", "/r/", "/invite/", "/pay/"];

async function sha256(s: string) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Перевірка сесії в базі (Neon через HTTP працює в Edge). Повертає true, якщо сесія дійсна або акаунтів ще немає і діє старий спільний пароль. */
async function sessionValid(token: string | undefined) {
  const url = process.env.DATABASE_URL; if (!url) return true; // база ще не підключена: режим налаштування
  const sqlq = neon(url);
  try {
    const [n] = await sqlq`select count(*)::int as c from users`;
    if (Number(n?.c ?? 0) === 0) {
      // акаунтів ще немає: працює старий спільний пароль зі змінної ADMIN_PASSWORD
      if (!process.env.ADMIN_PASSWORD) return true;
      const secret = process.env.SESSION_SECRET ?? process.env.TELEGRAM_BOT_TOKEN ?? "hub";
      return Boolean(token) && token === (await hmac(secret, "session:" + process.env.ADMIN_PASSWORD));
    }
    if (!token) return false;
    const rows = await sqlq`select 1 from user_sessions s join users u on u.id = s.user_id where s.token_hash = ${await sha256(token)} and s.revoked_at is null and s.expires_at > now() and u.status = 'active' limit 1`;
    return rows.length > 0;
  } catch { return false; }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.includes(pathname) || PUBLIC_PREFIX.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (await sessionValid(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  const url = req.nextUrl.clone(); url.pathname = "/login"; url.search = ""; url.searchParams.set("next", pathname + (req.nextUrl.search || ""));
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
