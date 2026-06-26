// Code Guide: GET /api/user/permissions
// Returns the current user's full effective permission matrix (role defaults merged with DB overrides).
// Used by client components to enforce permissions before making mutation API calls.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { PERM_SECTIONS, PERM_ACTIONS, type PermSection, type PermAction } from "@/lib/permissions-config";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const role = (session.user.role as string) ?? "user";

  const checks = PERM_SECTIONS.flatMap((sec) =>
    PERM_ACTIONS.map((act) => ({
      section: sec.id as PermSection,
      action: act.id as PermAction,
    }))
  );

  const results = await Promise.all(
    checks.map(async ({ section, action }) => ({
      section,
      action,
      allowed: await canDo(userId, role, section, action),
    }))
  );

  const permissions: Record<string, Record<string, boolean>> = {};
  for (const { section, action, allowed } of results) {
    if (!permissions[section]) permissions[section] = {};
    permissions[section][action] = allowed;
  }

  return NextResponse.json({ success: true, data: permissions });
}
