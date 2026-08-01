import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { UserActivityService } from "@/lib/user-activity/service";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let path: unknown;
  try {
    const body = await request.json() as { path?: unknown };
    path = body.path;
  } catch {
    // A missing request body should not prevent the activity heartbeat.
  }

  await UserActivityService.recordHeartbeat(session.user.id, path);

  return NextResponse.json({ success: true });
}
