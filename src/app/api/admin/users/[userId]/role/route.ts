// Code Guide: PATCH /api/admin/users/[userId]/role — changes a user's role
// and resets their menu visibility to that role's defaults.
// Admin-like role only (no permission-matrix override can grant this) —
// preserved as-is from the original route, distinct from the
// isAdminLikeRole-OR-canDo pattern used by the list/login-history routes.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isAdminLikeRole } from "@/components/layout/navigation-config";
import { getIp } from "@/lib/audit";
import { UsersService } from "@/lib/users/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

const UpdateUserRoleSchema = z.object({
  role: z.enum(["user", "admin", "dev", "planner", "operation", "production", "guest"]),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!isAdminLikeRole(session.user.role)) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const { userId } = await context.params;
    const body = await request.json();
    const parsed = UpdateUserRoleSchema.parse(body);

    const data = await UsersService.updateUserRole(
      session.user.id,
      userId,
      parsed.role,
      { userId: session.user.id, userName: session.user.name ?? null, userEmail: session.user.email ?? null },
      getIp(request.headers),
    );

    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
