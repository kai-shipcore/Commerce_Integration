/**
 * Data access for user activity tracking: the daily-activity heartbeat
 * (fc_user_daily_activity) and the granular activity-event log
 * (fc_user_activity_event).
 */

import { prisma } from "@/lib/db/prisma";

export interface ActivityEventInput {
  userId: string;
  occurredAt: Date;
  eventType: string;
  path: string | null;
  label: string | null;
  target: string | null;
  ip: string | null;
  userAgent: string | null;
}

export const UserActivityRepository = {
  async upsertDailyActivity(userId: string, activityDate: Date, now: Date, path: string | null): Promise<void> {
    await prisma.userDailyActivity.upsert({
      where: {
        userId_activityDate: {
          userId,
          activityDate,
        },
      },
      create: {
        userId,
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
  },

  async insertActivityEvents(events: ActivityEventInput[]): Promise<void> {
    if (events.length === 0) return;
    await prisma.userActivityEvent.createMany({ data: events });
  },
};
