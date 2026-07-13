// Code Guide: Shared permission gate for everything served under
// /manual/* (doc pages and their media), so a menu's access rule can't
// drift between the page route and its asset routes.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { guardPermission } from "@/lib/permissions";
import { getPermissionSectionForMenuId } from "@/components/layout/navigation-config";

export async function checkManualAccess(menuId: string): Promise<NextResponse | null> {
  const section = getPermissionSectionForMenuId(menuId);
  if (section) {
    return guardPermission(section, "read");
  }

  // No permission section is registered for this menu (e.g. the command
  // center, which every logged-in role can see) — still require a session.
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
