// Code Guide: Per-user, per-day activity timeline merging button-click
// events, logins, and audit-log entries (container/invoice/general tables).
// Controller layer only: delegates to UsersService.

import { NextRequest } from "next/server";
import { guardPermission } from "@/lib/permissions";
import { UsersService } from "@/lib/users/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) {
  const denied = await guardPermission("user-permissions", "read");
  if (denied) return denied;

  try {
    const { userId } = await context.params;
    const data = await UsersService.getActivityTimeline(userId, request.nextUrl.searchParams.get("date"));
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
