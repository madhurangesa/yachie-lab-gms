import { NextResponse } from "next/server";

export function middleware(req) {
  const { pathname } = req.nextUrl;

  // Always allow the login page and login API through
  if (pathname === "/login" || pathname === "/api/login") {
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
