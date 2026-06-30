/**
 * Code Guide:
 * Returns the 10 most recent login records for a user.
 * Used by the user management detail panel to display login history.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { isAdminLikeRole } from "@/components/layout/navigation-config";
import { canDo } from "@/lib/permissions";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ userId: string }> }
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
      "read"
    );
    if (!isAdminLikeRole(session.user.role) && !canReadUsers) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const { userId } = await context.params;

    const logs = await prisma.userLoginLog.findMany({
      where: { userId },
      orderBy: { loggedInAt: "desc" },
      take: 10,
      select: { id: true, loggedInAt: true, ip: true, userAgent: true },
    });

    return NextResponse.json({ success: true, data: logs });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
