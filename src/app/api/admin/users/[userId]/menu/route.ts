// Code Guide: PATCH /api/admin/users/[userId]/menu — sets a user's custom
// menu visibility (subject to their role's permission-gated defaults).
// The actor needs isAdminLikeRole OR live "user-permissions" edit+status
// permissions — computed once via getEffectivePermissions and reused for
// both the early gate and the original route's second (redundant, now
// deduplicated) check, so behavior is unchanged but the permissions lookup
// no longer re-implements getEffectivePermissions by hand via raw SQL.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isAdminLikeRole } from "@/components/layout/navigation-config";
import { getEffectivePermissions } from "@/lib/permissions";
import { getIp } from "@/lib/audit";
import { UsersService } from "@/lib/users/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

const UpdateUserMenuSchema = z.object({
  visibleMenuIds: z.array(z.string()),
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

    const permissions = await getEffectivePermissions(session.user.id, (session.user.role as string) ?? "user");

    if (!isAdminLikeRole(session.user.role) && (!permissions["user-permissions"].edit || !permissions["user-permissions"].status)) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }
    if (!session.user.role) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const { userId } = await context.params;
    const body = await request.json();
    const parsed = UpdateUserMenuSchema.parse(body);

    if (!permissions["user-permissions"].edit || !permissions["user-permissions"].status) {
      return NextResponse.json(
        { success: false, error: "User Permissions edit and status permissions are required to update menu access." },
        { status: 403 },
      );
    }

    const data = await UsersService.updateUserMenu(
      userId,
      parsed.visibleMenuIds,
      { userId: session.user.id, userName: session.user.name ?? null, userEmail: session.user.email ?? null },
      getIp(request.headers),
    );

    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
