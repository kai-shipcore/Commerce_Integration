// Code Guide: GET /api/user/permissions
// Returns the current user's full effective permission matrix (role defaults merged with DB overrides).
// Delegates entirely to src/lib/permissions.ts's getEffectivePermissions, which already implements this
// exact cache-first (role matrix + user overrides) computation for guardPermission()/canDo() — this route
// previously reimplemented the same logic in parallel.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getEffectivePermissions } from "@/lib/permissions";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const permissions = await getEffectivePermissions(session.user.id, (session.user.role as string) ?? "user");
  return NextResponse.json({ success: true, data: permissions });
}
