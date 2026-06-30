import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { isAdminLikeRole } from "@/components/layout/navigation-config";
import { logAudit, getIp } from "@/lib/audit";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> }
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

    if (userId === session.user.id) {
      return NextResponse.json(
        { success: false, error: "Cannot change your own active status" },
        { status: 400 }
      );
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, isActive: true, role: true },
    });

    if (!target) {
      return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    }

    const nextActive = !target.isActive;

    // Guard: cannot deactivate the last active admin
    if (!nextActive && isAdminLikeRole(target.role)) {
      const activeAdminCount = await prisma.user.count({
        where: { isActive: true, role: { in: ["admin", "dev"] } },
      });
      if (activeAdminCount <= 1) {
        return NextResponse.json(
          { success: false, error: "Cannot deactivate the last active admin account" },
          { status: 400 }
        );
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { isActive: nextActive },
      select: { id: true, isActive: true, updatedAt: true },
    });

    void logAudit({
      entityType: "user_role",
      entityId: userId,
      entityLabel: target.email ?? target.name ?? userId,
      userId: session.user.id,
      userName: session.user.name ?? null,
      userEmail: session.user.email ?? null,
      action: "status_change",
      before: { isActive: target.isActive },
      after: { isActive: nextActive },
      ip: getIp(request.headers),
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
