/**
 * Code Guide:
 * Next.js middleware for request-time guards and redirects.
 * This code runs before a route handler or page and is typically used for auth-aware routing decisions.
 */

import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { authPath, stripBasePath, withBasePath } from "@/lib/api-path";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const isSecureRequest =
    req.nextUrl.protocol === "https:" || forwardedProto === "https";
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
    secureCookie: isSecureRequest,
  });

  // Automation bypass: the weekly forecast cron triggers the velocity sync
  // with a shared secret header instead of a session.
  const syncToken = process.env.VELOCITY_SYNC_TOKEN;
  if (
    syncToken &&
    pathStartsWithBaseAware(pathname, "/api/velocity/sync") &&
    req.headers.get("x-sync-token") === syncToken
  ) {
    return NextResponse.next();
  }

  // Public routes that don't require authentication
  const publicRoutes = ["/auth/signin", "/auth/signup", "/auth/forgot-password", "/auth/reset-password", "/auth/error", "/api/auth"];
  const isPublicRoute = publicRoutes.some((route) => pathStartsWithBaseAware(pathname, route));
  const isAuthPage =
    pathStartsWithBaseAware(pathname, "/auth/signin") || pathStartsWithBaseAware(pathname, "/auth/signup");

  // If authenticated and visiting auth pages, go to the app instead
  if (token && isAuthPage) {
    return NextResponse.redirect(new URL(withBasePath("/"), req.url));
  }

  // If not authenticated and trying to access protected route
  if (!token && !isPublicRoute) {
    const signInUrl = new URL(authPath("/auth/signin"), req.url);
    signInUrl.searchParams.set(
      "callbackUrl",
      withBasePath(stripBasePath(`${pathname}${req.nextUrl.search || ""}`))
    );
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

function pathStartsWithBaseAware(pathname: string, route: string) {
  return pathname.startsWith(route) || pathname.startsWith(withBasePath(route));
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
