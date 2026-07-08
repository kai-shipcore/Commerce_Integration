import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { isAdminLikeRole } from "@/components/layout/navigation-config";
import { z } from "zod";
import { logAudit, getIp } from "@/lib/audit";

const UpdateUserNameSchema = z.object({
  name: z.string().trim().min(1),
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
    const parsed = UpdateUserNameSchema.parse(body);

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });

    if (!targetUser) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { name: parsed.name },
      select: { id: true, name: true, updatedAt: true },
    });

    void logAudit({
      entityType: "user_name",
      entityId: userId,
      entityLabel: targetUser.email ?? targetUser.name ?? userId,
      userId: session.user.id,
      userName: session.user.name ?? null,
      userEmail: session.user.email ?? null,
      action: "update",
      before: { name: targetUser.name },
      after: { name: parsed.name },
      ip: getIp(request.headers),
    });

    return NextResponse.json({
      success: true,
      data: updatedUser,
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
