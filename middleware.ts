/**
 * Code Guide:
 * Next.js middleware for request-time guards and redirects.
 * This code runs before a route handler or page and is typically used for auth-aware routing decisions.
 */

import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // Public routes that don't require authentication
  const publicRoutes = ["/auth/signin", "/auth/signup", "/auth/error", "/api/auth"];
  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route));
  const isAuthPage =
    pathname.startsWith("/auth/signin") || pathname.startsWith("/auth/signup");

  // If authenticated and visiting auth pages, go to the app instead
  if (token && isAuthPage) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // If not authenticated and trying to access protected route
  if (!token && !isPublicRoute) {
    const signInUrl = new URL("/auth/signin", req.url);
    signInUrl.searchParams.set(
      "callbackUrl",
      `${pathname}${req.nextUrl.search || ""}`
    );
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*|api/auth).*)",
  ],
};
