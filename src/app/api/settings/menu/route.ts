import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import {
  getDefaultVisibleMenuIds,
  isAdminLikeRole,
  mergeVisibleMenuIdsWithPermissions,
  sanitizeVisibleMenuIds,
} from "@/components/layout/navigation-config";
import { getEffectivePermissions } from "@/lib/permissions";
import { z } from "zod";

const UpdateMenuVisibilitySchema = z.object({
  visibleMenuIds: z.array(z.string()),
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { menuVisibility: true },
    });

    const permissions = await getEffectivePermissions(
      session.user.id,
      (session.user.role as string) ?? "user"
    );
    const visibleMenuIds = mergeVisibleMenuIdsWithPermissions(
      user?.menuVisibility,
      session.user.role,
      permissions
    );

    return NextResponse.json({
      success: true,
      data: {
        role: session.user.role,
        visibleMenuIds,
        defaults: getDefaultVisibleMenuIds(session.user.role),
        permissions,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
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

    const body = await request.json();
    const parsed = UpdateMenuVisibilitySchema.parse(body);
    const visibleMenuIds = sanitizeVisibleMenuIds(parsed.visibleMenuIds, session.user.role);

    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        menuVisibility: visibleMenuIds,
      },
    });

    return NextResponse.json({
      success: true,
      data: { visibleMenuIds },
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
