import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { activityDateToUtc, getActivityDate } from "@/lib/activity-date";

const MAX_PATH_LENGTH = 500;

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let path: string | null = null;
  try {
    const body = await request.json() as { path?: unknown };
    if (typeof body.path === "string") {
      path = body.path.trim().slice(0, MAX_PATH_LENGTH) || null;
    }
  } catch {
    // A missing request body should not prevent the activity heartbeat.
  }

  const now = new Date();
  const activityDate = activityDateToUtc(getActivityDate());

  await prisma.userDailyActivity.upsert({
    where: {
      userId_activityDate: {
        userId: session.user.id,
        activityDate,
      },
    },
    create: {
      userId: session.user.id,
      activityDate,
      firstSeenAt: now,
      lastSeenAt: now,
      activityCount: 1,
      lastPath: path,
    },
    update: {
      lastSeenAt: now,
      activityCount: { increment: 1 },
      ...(path ? { lastPath: path } : {}),
    },
  });

  return NextResponse.json({ success: true });
}
