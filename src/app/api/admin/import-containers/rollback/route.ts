import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { guardPermission } from "@/lib/permissions";
import { ContainerImportService } from "@/lib/container-import/service";

export async function POST() {
  const denied = await guardPermission("container-import", "create");
  if (denied) return denied;

  const session = await auth();
  try {
    const result = await ContainerImportService.rollbackLatest({
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
    });
    if (result.conflict) {
      return NextResponse.json({ error: "Cannot roll back while an import is running" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, dateSuffix: result.dateSuffix, tables: result.tables });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to restore container import backup";
    return NextResponse.json({ error: message }, { status: message.includes("No complete container import backup") ? 404 : 500 });
  }
}
