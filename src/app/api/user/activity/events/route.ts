import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getIp } from "@/lib/audit";
import { UserActivityService } from "@/lib/user-activity/service";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json() as { events?: unknown };
    const rawEvents = Array.isArray(body.events) ? body.events : [];
    const ip = getIp(request.headers);
    const userAgent = request.headers.get("user-agent");

    const recorded = await UserActivityService.recordEvents(session.user.id, rawEvents, ip, userAgent);

    return NextResponse.json({ success: true, recorded });
  } catch (error) {
    console.error("[UserActivityEvents] Failed to record events:", error);
    return NextResponse.json({ success: false, error: "Failed to record activity events" }, { status: 500 });
  }
}
