import { NextResponse, type NextRequest } from "next/server";

const COOKIE = "hub_session";

// HMAC-SHA256 через Web Crypto: middleware працює в Edge-середовищі без Node crypto.
async function expected() {
  const pw = process.env.ADMIN_PASSWORD ?? "";
  const secret = process.env.SESSION_SECRET ?? process.env.TELEGRAM_BOT_TOKEN ?? "hub";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("session:" + pw));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/") || pathname.startsWith("/f/") || pathname === "/login" || pathname.startsWith("/_next") || pathname === "/favicon.ico") return NextResponse.next();
  if (!process.env.ADMIN_PASSWORD) return NextResponse.next(); // режим налаштування: пароль ще не заданий
  const c = req.cookies.get(COOKIE)?.value;
  if (c && c === (await expected())) return NextResponse.next();
  const url = req.nextUrl.clone(); url.pathname = "/login"; url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
