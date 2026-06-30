import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import {
  getDefaultVisibleMenuIds,
  isAdminLikeRole,
  mergeVisibleMenuIdsWithPermissions,
} from "@/components/layout/navigation-config";
import { canDo, getEffectivePermissions } from "@/lib/permissions";
import { getPrimaryPool } from "@/lib/db/primary-db";

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
    const statusFilter = searchParams.get("status")?.trim() ?? "";

    const SORT_FIELDS = ["email", "name", "role", "createdAt", "lastLoginAt", "authProvider"] as const;
    type SortField = typeof SORT_FIELDS[number];
    const rawSortBy = searchParams.get("sortBy") ?? "role";
    const safeSortBy: SortField = (SORT_FIELDS as readonly string[]).includes(rawSortBy)
      ? (rawSortBy as SortField)
      : "role";
    const sortDir = searchParams.get("sortDir") === "desc" ? ("desc" as const) : ("asc" as const);

    // Login activity filter: "30d" | "90d" | "never"
    const loginFilter = searchParams.get("loginFilter")?.trim() ?? "";
    const now = new Date();
    const loginFilterClause = loginFilter === "30d"
      ? { OR: [{ lastLoginAt: { lt: new Date(now.getTime() - 30 * 86400_000) } }, { lastLoginAt: null }] }
      : loginFilter === "90d"
      ? { OR: [{ lastLoginAt: { lt: new Date(now.getTime() - 90 * 86400_000) } }, { lastLoginAt: null }] }
      : loginFilter === "never"
      ? { lastLoginAt: null }
      : undefined;

    const searchClause = search
      ? {
          OR: [
            { id: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
            { name: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : undefined;

    const andClauses = [
      ...(searchClause ? [searchClause] : []),
      ...(roleFilter ? [{ role: roleFilter }] : []),
      ...(statusFilter === "active" ? [{ isActive: true }] : []),
      ...(statusFilter === "inactive" ? [{ isActive: false }] : []),
      ...(loginFilterClause ? [loginFilterClause] : []),
    ];
    const where = andClauses.length > 0 ? { AND: andClauses } : undefined;

    const [total, users] = await prisma.$transaction([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: safeSortBy === "authProvider"
          ? [{ accounts: { _count: sortDir } }, { createdAt: "asc" as const }]
          : [
              { [safeSortBy]: sortDir },
              ...(safeSortBy !== "createdAt" ? [{ createdAt: "asc" as const }] : []),
            ],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
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

    const exCountMap = new Map<string, number>();
    if (users.length > 0) {
      const pool = getPrimaryPool();
      const exCountResult = await pool.query<{ user_id: string; count: string }>(
        `SELECT user_id, COUNT(*)::text AS count
         FROM shipcore.fc_user_permission_overrides
         WHERE user_id = ANY($1)
         GROUP BY user_id`,
        [users.map((u) => u.id)]
      );
      for (const row of exCountResult.rows) {
        exCountMap.set(row.user_id, parseInt(row.count, 10));
      }
    }

    const usersWithEffectiveMenus = await Promise.all(
      users.map(async (user: typeof users[number]) => {
        const permissions = await getEffectivePermissions(user.id, user.role);
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          menuVisibility: mergeVisibleMenuIdsWithPermissions(user.menuVisibility, user.role, permissions),
          isActive: user.isActive,
          lastLoginAt: user.lastLoginAt,
          authProviders: [...new Set(user.accounts.map((account) => account.provider))],
          hasGoogleAccount: user.accounts.some((account) => account.provider === "google"),
          exceptionCount: exCountMap.get(user.id) ?? 0,
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
