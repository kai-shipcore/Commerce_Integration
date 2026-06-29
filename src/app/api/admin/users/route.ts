import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import {
  getDefaultVisibleMenuIds,
  isAdminLikeRole,
  mergeVisibleMenuIdsWithPermissions,
} from "@/components/layout/navigation-config";
import { canDo, getEffectivePermissions } from "@/lib/permissions";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const canReadUserPermissions = await canDo(
      session.user.id,
      (session.user.role as string) ?? "user",
      "user-permissions",
      "read"
    );

    if (!isAdminLikeRole(session.user.role) && !canReadUserPermissions) {
      return NextResponse.json(
        { success: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(5, Number.parseInt(searchParams.get("limit") ?? "10", 10) || 10));
    const search = searchParams.get("search")?.trim() ?? "";
    const roleFilter = searchParams.get("role")?.trim() ?? "";
    const searchClause = search
      ? {
          OR: [
            { id: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
            { name: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : undefined;
    const where = searchClause || roleFilter
      ? { AND: [...(searchClause ? [searchClause] : []), ...(roleFilter ? [{ role: roleFilter }] : [])] }
      : undefined;

    const [total, users] = await prisma.$transaction([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          menuVisibility: true,
          accounts: {
            select: {
              provider: true,
            },
          },
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const usersWithEffectiveMenus = await Promise.all(
      users.map(async (user: typeof users[number]) => {
        const permissions = await getEffectivePermissions(user.id, user.role);
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          menuVisibility: mergeVisibleMenuIdsWithPermissions(user.menuVisibility, user.role, permissions),
          authProviders: [...new Set(user.accounts.map((account) => account.provider))],
          hasGoogleAccount: user.accounts.some((account) => account.provider === "google"),
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: {
        defaults: {
          admin: getDefaultVisibleMenuIds("admin"),
          dev: getDefaultVisibleMenuIds("dev"),
          user: getDefaultVisibleMenuIds("user"),
        },
        users: usersWithEffectiveMenus,
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
