import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { apiError, apiSuccess, handleApiError } from "@/lib/api-response";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";

const EventSchema = z.object({
  title: z.string().trim().min(1).max(160),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  calendarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
}).strict();

function mapEvent(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    title: String(row.title),
    eventDate: String(row.event_date).slice(0, 10),
    calendarColor: String(row.calendar_color),
  };
}

export async function GET() {
  try {
    const result = await getPrimaryPool().query(
      `SELECT id::text, title, event_date::text, calendar_color
       FROM shipcore.fc_timeline_calendar_events
       ORDER BY event_date, id`,
    );
    return apiSuccess({ data: result.rows.map(mapEvent) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  const denied = await guardPermission("container-timeline", "edit");
  if (denied) return denied;
  try {
    const session = await auth();
    const input = EventSchema.parse(await request.json());
    const result = await getPrimaryPool().query(
      `INSERT INTO shipcore.fc_timeline_calendar_events
         (title, event_date, calendar_color, created_by)
       VALUES ($1, $2::date, $3, $4)
       RETURNING id::text, title, event_date::text, calendar_color`,
      [input.title, input.eventDate, input.calendarColor, session?.user?.id ?? null],
    );
    return apiSuccess({ data: mapEvent(result.rows[0]) }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  const denied = await guardPermission("container-timeline", "edit");
  if (denied) return denied;
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id || !/^\d+$/.test(id)) return apiError("Valid event id is required", 400);
    const input = EventSchema.parse(await request.json());
    const result = await getPrimaryPool().query(
      `UPDATE shipcore.fc_timeline_calendar_events
       SET title = $2, event_date = $3::date, calendar_color = $4, updated_at = NOW()
       WHERE id = $1::bigint
       RETURNING id::text, title, event_date::text, calendar_color`,
      [id, input.title, input.eventDate, input.calendarColor],
    );
    if (result.rowCount === 0) return apiError("Calendar event not found", 404);
    return apiSuccess({ data: mapEvent(result.rows[0]) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await guardPermission("container-timeline", "edit");
  if (denied) return denied;
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id || !/^\d+$/.test(id)) return apiError("Valid event id is required", 400);
    const result = await getPrimaryPool().query(
      `DELETE FROM shipcore.fc_timeline_calendar_events WHERE id = $1::bigint RETURNING id`,
      [id],
    );
    if (result.rowCount === 0) return apiError("Calendar event not found", 404);
    return apiSuccess({ data: { id } });
  } catch (error) {
    return handleApiError(error);
  }
}
