/**
 * Code Guide:
 * Returns the 10 most recent login records for a user.
 * Used by the user management detail panel to display login history.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminLikeRole } from "@/components/layout/navigation-config";
import { canDo } from "@/lib/permissions";
import { UsersService } from "@/lib/users/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const canReadUsers = await canDo(
      session.user.id,
      (session.user.role as string) ?? "user",
      "user-permissions",
      "read",
    );
    if (!isAdminLikeRole(session.user.role) && !canReadUsers) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const { userId } = await context.params;
    const data = await UsersService.getLoginHistory(userId);

    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
