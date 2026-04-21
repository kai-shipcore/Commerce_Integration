import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import {
  getDefaultVisibleMenuIds,
  sanitizeVisibleMenuIds,
} from "@/components/layout/navigation-config";
import { z } from "zod";

const UpdateMenuVisibilitySchema = z.object({
  visibleMenuIds: z.array(z.string()),
});

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

    return NextResponse.json({
      success: true,
      data: {
        role: session.user.role,
        visibleMenuIds: sanitizeVisibleMenuIds(user?.menuVisibility, session.user.role),
        defaults: getDefaultVisibleMenuIds(session.user.role),
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
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

    if (session.user.role !== "admin") {
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
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
