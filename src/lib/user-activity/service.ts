/**
 * Business logic for user activity tracking: normalizes/validates the daily
 * heartbeat path and the batched event log before writing.
 */

import { activityDateToUtc, getActivityDate } from "@/lib/activity-date";
import { UserActivityRepository, type ActivityEventInput } from "@/lib/user-activity/repository";

const MAX_PATH_LENGTH = 500;
const EVENT_TYPES = new Set(["page_view", "button_click", "link_click", "form_submit", "action_failed"]);
const MAX_BATCH_SIZE = 50;

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, max);
  return normalized || null;
}

export const UserActivityService = {
  async recordHeartbeat(userId: string, rawPath: unknown): Promise<void> {
    const path = typeof rawPath === "string" ? (rawPath.trim().slice(0, MAX_PATH_LENGTH) || null) : null;
    const now = new Date();
    const activityDate = activityDateToUtc(getActivityDate());

    await UserActivityRepository.upsertDailyActivity(userId, activityDate, now, path);
  },

  async recordEvents(userId: string, rawEvents: unknown[], ip: string | null, rawUserAgent: string | null): Promise<number> {
    const userAgent = clean(rawUserAgent, 500);

    const events: ActivityEventInput[] = rawEvents.slice(0, MAX_BATCH_SIZE).flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const item = raw as Record<string, unknown>;
      const eventType = clean(item.eventType, 40);
      if (!eventType || !EVENT_TYPES.has(eventType)) return [];
      const parsedTime = typeof item.occurredAt === "string" ? new Date(item.occurredAt) : new Date();
      const occurredAt = Number.isNaN(parsedTime.getTime()) ? new Date() : parsedTime;
      return [{
        userId,
        occurredAt,
        eventType,
        path: clean(item.path, 500),
        label: clean(item.label, 160),
        target: clean(item.target, 120),
        ip,
        userAgent,
      }];
    });

    await UserActivityRepository.insertActivityEvents(events);
    return events.length;
  },
};
