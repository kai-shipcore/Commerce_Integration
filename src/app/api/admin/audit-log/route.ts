import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPrimaryPool } from "@/lib/db/primary-db";

// All valid action values across all audit tables
const ACTIONS = new Set([
  // Container audit actions
  "status_change",
  "details_update",
  "eta_change",
  "items_update",
  "note_added",
  // Invoice audit actions
  "recompare",
  "credit_update",
  "factory_confirm_update",
  "attachment_update",
  "credit_note_create",
  "credit_note_status_change",
  // General audit actions
  "create",
  "update",
  "delete",
  "permission_grant",
  "permission_revoke",
  "role_change",
  "config_update",
]);

const ENTITY_TYPES = new Set([
  "container",
  "invoice",
  "factory",
  "warehouse",
  "sku",
  "user_permission",
  "user_role",
  "integration",
]);

function clean(value: string | null): string {
  return value?.trim() ?? "";
}

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = req.nextUrl.searchParams;
  const user = clean(searchParams.get("user"));
  const entity = clean(searchParams.get("entity"));
  const entityId = clean(searchParams.get("entityId"));
  const entityType = clean(searchParams.get("entityType"));
  const action = clean(searchParams.get("action"));
  const startDate = clean(searchParams.get("startDate"));
  const endDate = clean(searchParams.get("endDate"));
  const exportAll = searchParams.get("export") === "1";
  const page = parsePositiveInt(searchParams.get("page"), 1, 100000);
  const limit = exportAll ? 5000 : parsePositiveInt(searchParams.get("limit"), 20, 100);
  const offset = (page - 1) * limit;

  const filters: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (user) {
    values.push(`%${user}%`);
    filters.push(`(
      COALESCE(user_name, '') ILIKE $${idx}
      OR COALESCE(user_email, '') ILIKE $${idx}
      OR COALESCE(user_id, '') ILIKE $${idx}
    )`);
    idx++;
  }

  if (entity) {
    values.push(`%${entity}%`);
    filters.push(`(
      COALESCE(entity_label, '') ILIKE $${idx}
      OR COALESCE(entity_id, '') ILIKE $${idx}
    )`);
    idx++;
  }

  if (entityId) {
    values.push(entityId);
    filters.push(`entity_id = $${idx++}`);
  }

  if (entityType && ENTITY_TYPES.has(entityType)) {
    values.push(entityType);
    filters.push(`entity_type = $${idx++}`);
  }

  if (action && ACTIONS.has(action)) {
    values.push(action);
    filters.push(`action = $${idx++}`);
  }

  if (startDate) {
    values.push(startDate);
    filters.push(`created_at >= $${idx++}::date`);
  }

  if (endDate) {
    values.push(endDate);
    filters.push(`created_at < ($${idx++}::date + INTERVAL '1 day')`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  // UNION of container-specific table, invoice-specific table, and general audit table
  const unionSql = `
    SELECT
      'c:' || id::text      AS id,
      'container'           AS entity_type,
      container_id::text    AS entity_id,
      COALESCE(container_number, container_id::text) AS entity_label,
      user_id, user_name, user_email,
      action, before, after, note, ip, created_at
    FROM shipcore.fc_container_audit_log

    UNION ALL

    SELECT
      'i:' || id::text      AS id,
      'invoice'             AS entity_type,
      invoice_id::text      AS entity_id,
      COALESCE(invoice_number, invoice_id::text) AS entity_label,
      user_id, user_name, user_email,
      action, before, after, note, ip, created_at
    FROM shipcore.fc_invoice_audit_log

    UNION ALL

    SELECT
      'a:' || id::text      AS id,
      entity_type,
      entity_id,
      COALESCE(entity_label, entity_id) AS entity_label,
      user_id, user_name, user_email,
      action, before, after, note, ip, created_at
    FROM shipcore.fc_audit_log
  `;

  try {
    const pool = getPrimaryPool();

    const countPromise = pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM (${unionSql}) combined
       ${where}`,
      values,
    );

    const dataPromise = pool.query(
      `SELECT id, entity_type, entity_id, entity_label,
              user_id, user_name, user_email,
              action, before, after, note, ip, created_at
       FROM (${unionSql}) combined
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...values, limit, offset],
    );

    const [countResult, dataResult] = await Promise.all([countPromise, dataPromise]);
    const total = Number(countResult.rows[0]?.total ?? 0);

    return NextResponse.json({
      success: true,
      data: dataResult.rows.map((row) => ({
        id: row.id as string,
        entityType: row.entity_type as string,
        entityId: row.entity_id as string,
        entityLabel: row.entity_label as string | null,
        userId: row.user_id as string | null,
        userName: row.user_name as string | null,
        userEmail: row.user_email as string | null,
        action: row.action as string,
        before: row.before as Record<string, unknown> | null,
        after: row.after as Record<string, unknown> | null,
        note: row.note as string | null,
        ip: row.ip as string | null,
        createdAt: (row.created_at as Date).toISOString(),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error("[AdminAuditLog GET]", error);
    return NextResponse.json({ success: false, error: "Failed to fetch audit logs" }, { status: 500 });
  }
}
