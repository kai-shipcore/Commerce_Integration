import { NextRequest, NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";
import { getActivityDate } from "@/lib/activity-date";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) {
  const denied = await guardPermission("user-permissions", "read");
  if (denied) return denied;

  const { userId } = await context.params;
  const requestedDate = request.nextUrl.searchParams.get("date") ?? getActivityDate();
  const date = DATE_PATTERN.test(requestedDate) ? requestedDate : getActivityDate();
  const pool = getPrimaryPool();

  try {
    const [userResult, eventsResult, loginResult, auditResult] = await Promise.all([
      pool.query(
        `SELECT id, name, email, role FROM shipcore.fc_user WHERE id = $1 LIMIT 1`,
        [userId],
      ),
      pool.query(
        `SELECT id::text, occurred_at, event_type, path, label, target, ip
         FROM shipcore.fc_user_activity_event
         WHERE user_id = $1
           AND (occurred_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date = $2::date
         ORDER BY occurred_at ASC
         LIMIT 500`,
        [userId, date],
      ),
      pool.query(
        `SELECT id, "loggedInAt" AS occurred_at, ip, "userAgent" AS user_agent
         FROM shipcore.fc_user_login_log
         WHERE "userId" = $1
           AND ("loggedInAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date = $2::date
         ORDER BY "loggedInAt" ASC`,
        [userId, date],
      ),
      pool.query(
        `SELECT id, entity_type, entity_id, entity_label, action, before, after, note, ip, created_at
         FROM (
           SELECT 'c:' || id::text AS id, 'container' AS entity_type,
                  container_id::text AS entity_id, COALESCE(container_number, container_id::text) AS entity_label,
                  action, before, after, note, ip, created_at, user_id
           FROM shipcore.fc_container_audit_log
           UNION ALL
           SELECT 'i:' || ial.id::text, 'invoice', ial.invoice_id::text,
                  COALESCE(ial.invoice_number, inv.invoice_number, ial.invoice_id::text),
                  ial.action, ial.before, ial.after, ial.note, ial.ip, ial.created_at, ial.user_id
           FROM shipcore.fc_invoice_audit_log ial
           LEFT JOIN shipcore.fc_invoices inv ON inv.id = ial.invoice_id
           UNION ALL
           SELECT 'a:' || id::text, entity_type, entity_id,
                  COALESCE(entity_label, entity_id), action, before, after, note, ip, created_at, user_id
           FROM shipcore.fc_audit_log
         ) logs
         WHERE user_id = $1
           AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date = $2::date
         ORDER BY created_at ASC
         LIMIT 500`,
        [userId, date],
      ),
    ]);

    if (userResult.rowCount === 0) {
      return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    }

    const events = [
      ...eventsResult.rows.map((row) => ({
        id: `event:${row.id}`,
        source: "activity",
        occurredAt: (row.occurred_at as Date).toISOString(),
        eventType: row.event_type,
        path: row.path,
        label: row.label,
        target: row.target,
        ip: row.ip,
      })),
      ...loginResult.rows.map((row) => ({
        id: `login:${row.id}`,
        source: "login",
        occurredAt: (row.occurred_at as Date).toISOString(),
        eventType: "login",
        path: null,
        label: "Login",
        target: row.user_agent,
        ip: row.ip,
      })),
      ...auditResult.rows.map((row) => ({
        id: `audit:${row.id}`,
        source: "audit",
        occurredAt: (row.created_at as Date).toISOString(),
        eventType: "data_change",
        path: null,
        label: row.entity_label,
        target: row.action,
        ip: row.ip,
        entityType: row.entity_type,
        entityId: row.entity_id,
        before: row.before,
        after: row.after,
        note: row.note,
      })),
    ].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));

    return NextResponse.json({
      success: true,
      data: { user: userResult.rows[0], date, events },
    });
  } catch (error) {
    console.error("[UserActivityTimeline] Failed to load timeline:", error);
    return NextResponse.json({ success: false, error: "Failed to load activity timeline" }, { status: 500 });
  }
}
