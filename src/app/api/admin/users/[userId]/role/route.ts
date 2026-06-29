import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import {
  getDefaultVisibleMenuIds,
  isAdminLikeRole,
} from "@/components/layout/navigation-config";
import { z } from "zod";
import { logAudit, getIp } from "@/lib/audit";

const UpdateUserRoleSchema = z.object({
  role: z.enum(["user", "admin", "dev", "planner", "operation", "production"]),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    if (!isAdminLikeRole(session.user.role)) {
      return NextResponse.json(
        { success: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const { userId } = await context.params;
    const body = await request.json();
    const parsed = UpdateUserRoleSchema.parse(body);

    if (userId === session.user.id) {
      return NextResponse.json(
        { success: false, error: "You cannot change your own role" },
        { status: 400 }
      );
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, email: true, name: true },
    });

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        role: parsed.role,
        menuVisibility: getDefaultVisibleMenuIds(parsed.role),
      },
      select: {
        id: true,
        role: true,
        menuVisibility: true,
        updatedAt: true,
      },
    });

    void logAudit({
      entityType: "user_role",
      entityId: userId,
      entityLabel: targetUser?.email ?? targetUser?.name ?? userId,
      userId: session.user.id,
      userName: session.user.name ?? null,
      userEmail: session.user.email ?? null,
      action: "role_change",
      before: { role: targetUser?.role ?? null },
      after: { role: parsed.role },
      ip: getIp(request.headers),
    });

    return NextResponse.json({
      success: true,
      data: updatedUser,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
