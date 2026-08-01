import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ForbiddenError } from "@/lib/errors";
import { SettingsService } from "@/lib/settings/service";
import { z } from "zod";

const UpdateMenuVisibilitySchema = z.object({
  visibleMenuIds: z.array(z.string()),
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const data = await SettingsService.getMenuVisibility(session.user.id, session.user.role);

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
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

    const body = await request.json();
    const parsed = UpdateMenuVisibilitySchema.parse(body);

    const data = await SettingsService.updateMenuVisibility(session.user.id, session.user.role, parsed.visibleMenuIds);

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }

    if (error instanceof ForbiddenError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 403 });
    }

    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
