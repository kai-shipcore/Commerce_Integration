// Code Guide: PATCH /api/admin/users/[userId]/name — renames a user.
// Admin-like role only, same as the role/status routes.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isAdminLikeRole } from "@/components/layout/navigation-config";
import { getIp } from "@/lib/audit";
import { UsersService } from "@/lib/users/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

const UpdateUserNameSchema = z.object({
  name: z.string().trim().min(1),
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
    const parsed = UpdateUserNameSchema.parse(body);

    const data = await UsersService.updateUserName(
      userId,
      parsed.name,
      { userId: session.user.id, userName: session.user.name ?? null, userEmail: session.user.email ?? null },
      getIp(request.headers),
    );

    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
