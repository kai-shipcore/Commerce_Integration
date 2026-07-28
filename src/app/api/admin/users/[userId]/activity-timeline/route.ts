import { NextRequest, NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";
import { guardPermission } from "@/lib/permissions";
import { getActivityDate } from "@/lib/activity-date";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SKU_LIKE_LABEL_PATTERN = /^(?:CA|CC|CL|ICC)-/i;

function explicitSkuSubject(label: unknown): { type: "sku" | "part_sku"; id: string } | undefined {
  if (typeof label !== "string") return undefined;
  const partSku = label.match(/^(?:Part SKU 선택|Select Part SKU):\s*(.+)$/i)?.[1]?.trim();
  if (partSku) return { type: "part_sku", id: partSku };
  const sku = label.match(/^(?:SKU 선택|Select SKU):\s*(.+)$/i)?.[1]?.trim();
  return sku ? { type: "sku", id: sku } : undefined;
}

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
        `SELECT id::text, occurred_at AT TIME ZONE 'UTC' AS occurred_at,
                event_type, path, label, target, ip
         FROM shipcore.fc_user_activity_event
         WHERE user_id = $1
           AND (occurred_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date = $2::date
         ORDER BY occurred_at ASC`,
        [userId, date],
      ),
      pool.query(
        `SELECT id, "loggedInAt" AT TIME ZONE 'UTC' AS occurred_at,
                ip, "userAgent" AS user_agent
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
           AND (created_at AT TIME ZONE 'America/Los_Angeles')::date = $2::date
         ORDER BY created_at ASC`,
        [userId, date],
      ),
    ]);

    if (userResult.rowCount === 0) {
      return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    }

    // Older selectable SKU rows were logged using the button's concatenated
    // text (SKU + metrics/status). Resolve both master and Part SKUs by their
    // longest prefix so historical activity remains human-readable.
    const legacySelectableLabels = [...new Set(
      eventsResult.rows
        .filter((row) => (
          row.event_type === "button_click"
          && typeof row.label === "string"
          && (row.path === "/planning/sku-forecasts" || SKU_LIKE_LABEL_PATTERN.test(row.label))
        ))
        .map((row) => row.label as string),
    )];
    const legacySubjectByLabel = new Map<string, { type: "sku" | "part_sku"; id: string }>();
    if (legacySelectableLabels.length > 0) {
      const legacySubjectResult = await pool.query(
        `WITH known_sku AS (
           SELECT master_sku AS sku, 'sku'::text AS subject_type
           FROM shipcore.sc_products
           UNION ALL
           SELECT sku, 'part_sku'::text AS subject_type
           FROM shipcore.pd_part_skus
         )
         SELECT candidate.label, matched.sku, matched.subject_type
         FROM unnest($1::text[]) AS candidate(label)
         JOIN LATERAL (
           SELECT sku, subject_type
           FROM known_sku
           WHERE candidate.label LIKE sku || '%'
           ORDER BY length(sku) DESC
           LIMIT 1
         ) matched ON true`,
        [legacySelectableLabels],
      );
      for (const row of legacySubjectResult.rows) {
        legacySubjectByLabel.set(row.label as string, {
          type: row.subject_type as "sku" | "part_sku",
          id: row.sku as string,
        });
      }
    }

    const events = [
      ...eventsResult.rows.map((row) => {
        const legacySubject = explicitSkuSubject(row.label)
          ?? (typeof row.label === "string" ? legacySubjectByLabel.get(row.label) : undefined);
        return {
          id: `event:${row.id}`,
          source: "activity",
          occurredAt: (row.occurred_at as Date).toISOString(),
          eventType: row.event_type,
          path: row.path,
          label: row.label,
          target: row.target,
          ip: row.ip,
          subjectType: legacySubject?.type ?? null,
          subjectId: legacySubject?.id ?? null,
        };
      }),
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
