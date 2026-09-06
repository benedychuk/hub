import { NextResponse, type NextRequest } from "next/server";
import { createHmac } from "crypto";

const COOKIE = "hub_session";

function expected() {
  const pw = process.env.ADMIN_PASSWORD ?? "";
  const secret = process.env.SESSION_SECRET ?? process.env.TELEGRAM_BOT_TOKEN ?? "hub";
  return createHmac("sha256", secret).update("session:" + pw).digest("hex");
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/") || pathname === "/login" || pathname.startsWith("/_next") || pathname === "/favicon.ico") return NextResponse.next();
  if (!process.env.ADMIN_PASSWORD) return NextResponse.next(); // режим налаштування: пароль ще не заданий
  const c = req.cookies.get(COOKIE)?.value;
  if (c === expected()) return NextResponse.next();
  const url = req.nextUrl.clone(); url.pathname = "/login"; url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
