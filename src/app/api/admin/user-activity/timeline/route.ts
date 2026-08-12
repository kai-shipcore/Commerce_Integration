// Code Guide: Per-user daily activity timeline exposed through a static API
// path. Keeping the user id in the query string avoids dynamic-route lookup
// issues in base-path development deployments.

import { NextRequest } from "next/server";
import { apiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { guardPermission } from "@/lib/permissions";
import { UsersService } from "@/lib/users/service";

export async function GET(request: NextRequest) {
  const denied = await guardPermission("user-permissions", "read");
  if (denied) return denied;

  const userId = request.nextUrl.searchParams.get("userId")?.trim();
  if (!userId) return apiError("User id is required", 400);

  try {
    const data = await UsersService.getActivityTimeline(
      userId,
      request.nextUrl.searchParams.get("date"),
    );
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
