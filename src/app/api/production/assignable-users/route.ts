// Code Guide: lightweight picker source for Project List (Assigned to / Researched by /
// Reviewed by) — production-role users only. Distinct from the heavy admin-gated
// /api/admin/users endpoint, which requires user-permissions access.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { guardPermission } from "@/lib/permissions";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET() {
  const denied = await guardPermission("project-list", "read");
  if (denied) return denied;
  try {
    const users = await prisma.user.findMany({
      where: { role: "production", isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ success: true, data: users });
  } catch (error: unknown) {
    console.error("Error fetching assignable users:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
