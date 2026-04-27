import { NextResponse } from "next/server";

export function middleware(req) {
  const { pathname } = req.nextUrl;

  // Always allow these through
  if (
    pathname === "/login" ||
    pathname === "/api/login" ||
    pathname.startsWith("/api/data") ||
    pathname.startsWith("/api/procurement") ||
    pathname === "/procurement" ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.json" ||
    pathname.startsWith("/icon-")
  ) {
    return NextResponse.next();
  }

  // Check for auth cookie
  const auth = req.cookies.get("lab-auth");
  if (auth && auth.value === process.env.LAB_PASSWORD) {
    return NextResponse.next();
  }

  // Not authenticated — redirect to login
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
