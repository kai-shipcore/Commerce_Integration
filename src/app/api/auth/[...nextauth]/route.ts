/**
 * Code Guide:
 * This API route owns the auth / [...nextauth] backend workflow.
 * It validates request data, reads or writes database records, and returns JSON to the UI.
 * Cache invalidation and service calls usually happen here because this layer coordinates side effects.
 */

import { handlers } from "@/lib/auth";
import { basePath } from "@/lib/api-path";
import { NextRequest } from "next/server";

export function GET(request: NextRequest) {
  return handlers.GET(withAuthBasePath(request));
}

export function POST(request: NextRequest) {
  return handlers.POST(withAuthBasePath(request));
}

function withAuthBasePath(request: NextRequest) {
  if (!basePath) return request;

  const url = request.nextUrl.clone();
  if (url.pathname.startsWith(`${basePath}/api/auth`)) return request;
  if (!url.pathname.startsWith("/api/auth")) return request;

  url.pathname = `${basePath}${url.pathname}`;
  return new NextRequest(url, request);
}
