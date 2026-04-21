import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import {
  getDefaultVisibleMenuIds,
  sanitizeVisibleMenuIds,
} from "@/components/layout/navigation-config";
import { z } from "zod";

const UpdateUserMenuSchema = z.object({
  visibleMenuIds: z.array(z.string()),
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

    if (session.user.role !== "admin") {
      return NextResponse.json(
        { success: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const { userId } = await context.params;
    const body = await request.json();
    const parsed = UpdateUserMenuSchema.parse(body);
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    if (!targetUser) {
      return NextResponse.json(
        { success: false, error: "User not found" },
        { status: 404 }
      );
    }

    const visibleMenuIds = sanitizeVisibleMenuIds(parsed.visibleMenuIds, targetUser.role);

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        menuVisibility: visibleMenuIds,
      },
      select: {
        id: true,
        menuVisibility: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        ...updatedUser,
        defaults: getDefaultVisibleMenuIds(targetUser.role),
        menuVisibility: sanitizeVisibleMenuIds(updatedUser.menuVisibility, targetUser.role),
      },
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
