// Code Guide: GET /api/admin/users — paginated/searchable/sortable user list
// for the Users tab, including per-user effective menu visibility and
// permission-override counts.
// Controller layer only: delegates to UsersService. Data access lives in
// src/lib/users/repository.ts.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminLikeRole } from "@/components/layout/navigation-config";
import { canDo } from "@/lib/permissions";
import { UsersService } from "@/lib/users/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const canReadUserPermissions = await canDo(
      session.user.id,
      (session.user.role as string) ?? "user",
      "user-permissions",
      "read",
    );

    if (!isAdminLikeRole(session.user.role) && !canReadUserPermissions) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const data = await UsersService.listUsers({
      pageParam: searchParams.get("page"),
      limitParam: searchParams.get("limit"),
      search: searchParams.get("search")?.trim() ?? "",
      roleFilter: searchParams.get("role")?.trim() ?? "",
      statusFilter: searchParams.get("status")?.trim() ?? "",
      sortByParam: searchParams.get("sortBy"),
      sortDirParam: searchParams.get("sortDir"),
      loginFilter: searchParams.get("loginFilter")?.trim() ?? "",
    });

    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
