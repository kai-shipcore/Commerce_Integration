// Code Guide: Org-wide user activity dashboard (DAU/WAU/MAU summary, trend,
// per-user activity rollup) for the User Activity tab.
// Controller layer only: delegates to UsersService.

import { NextRequest } from "next/server";
import { guardPermission } from "@/lib/permissions";
import { UsersService } from "@/lib/users/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  const denied = await guardPermission("user-permissions", "read");
  if (denied) return denied;

  try {
    const data = await UsersService.getUserActivitySummary(request.nextUrl.searchParams.get("days"));
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
