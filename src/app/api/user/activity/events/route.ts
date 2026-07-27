import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { getIp } from "@/lib/audit";

const EVENT_TYPES = new Set(["page_view", "button_click", "link_click", "form_submit"]);
const MAX_BATCH_SIZE = 50;

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, max);
  return normalized || null;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json() as { events?: unknown };
    const rawEvents = Array.isArray(body.events) ? body.events.slice(0, MAX_BATCH_SIZE) : [];
    const ip = getIp(request.headers);
    const userAgent = clean(request.headers.get("user-agent"), 500);
    const events = rawEvents.flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const item = raw as Record<string, unknown>;
      const eventType = clean(item.eventType, 40);
      if (!eventType || !EVENT_TYPES.has(eventType)) return [];
      const parsedTime = typeof item.occurredAt === "string" ? new Date(item.occurredAt) : new Date();
      const occurredAt = Number.isNaN(parsedTime.getTime()) ? new Date() : parsedTime;
      return [{
        userId: session.user.id,
        occurredAt,
        eventType,
        path: clean(item.path, 500),
        label: clean(item.label, 160),
        target: clean(item.target, 120),
        ip,
        userAgent,
      }];
    });

    if (events.length > 0) await prisma.userActivityEvent.createMany({ data: events });
    return NextResponse.json({ success: true, recorded: events.length });
  } catch (error) {
    console.error("[UserActivityEvents] Failed to record events:", error);
    return NextResponse.json({ success: false, error: "Failed to record activity events" }, { status: 500 });
  }
}
