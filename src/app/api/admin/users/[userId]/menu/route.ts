import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import {
  filterToValidMenuIds,
  getDefaultVisibleMenuIds,
  isAdminLikeRole,
  mergeVisibleMenuIdsWithPermissions,
} from "@/components/layout/navigation-config";
import { z } from "zod";
import { getPrimaryPool } from "@/lib/db/primary-db";
import {
  DEFAULT_ROLE_PERMISSIONS,
  blendRolePermissions,
  type ManagedRole,
  type PermAction,
  type PermSection,
} from "@/lib/permissions-config";
import { getEffectivePermissions } from "@/lib/permissions";

const UpdateUserMenuSchema = z.object({
  visibleMenuIds: z.array(z.string()),
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

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
      const currentPermissions = await getEffectivePermissions(
        session.user.id,
        (session.user.role as string) ?? "user"
      );
      if (!currentPermissions["user-permissions"].edit || !currentPermissions["user-permissions"].status) {
        return NextResponse.json(
          { success: false, error: "Forbidden" },
          { status: 403 }
        );
      }
    }

    if (!session.user.role) {
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

    const pool = getPrimaryPool();
    const [rolePerms, userOverrides] = await Promise.all([
      pool.query<{ section: string; action: string; allowed: boolean }>(
        `SELECT section, action, allowed
         FROM shipcore.fc_role_permissions
         WHERE role = $1`,
        [session.user.role],
      ),
      pool.query<{ section: string; action: string; allowed: boolean }>(
        `SELECT section, action, allowed
         FROM shipcore.fc_user_permission_overrides
         WHERE user_id = $1`,
        [session.user.id],
      ),
    ]);
    const base = DEFAULT_ROLE_PERMISSIONS[session.user.role as ManagedRole] ?? DEFAULT_ROLE_PERMISSIONS.user;
    const effective = blendRolePermissions(base, rolePerms.rows);
    for (const override of userOverrides.rows) {
      const section = override.section as PermSection;
      const action = override.action as PermAction;
      if (effective[section] && action in effective[section]) {
        effective[section][action] = override.allowed;
      }
    }
    if (!effective["user-permissions"].edit || !effective["user-permissions"].status) {
      return NextResponse.json(
        { success: false, error: "User Permissions edit and status permissions are required to update menu access." },
        { status: 403 }
      );
    }

    const visibleMenuIds = filterToValidMenuIds(parsed.visibleMenuIds);

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

    const targetPermissions = await getEffectivePermissions(targetUser.id, targetUser.role);

    return NextResponse.json({
      success: true,
      data: {
        ...updatedUser,
        defaults: getDefaultVisibleMenuIds(targetUser.role),
        menuVisibility: mergeVisibleMenuIdsWithPermissions(
          updatedUser.menuVisibility,
          targetUser.role,
          targetPermissions
        ),
      },
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
