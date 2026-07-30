/**
 * Pure data access for the merged Audit Log viewer. Unions three tables that
 * are each owned/written elsewhere:
 *   - shipcore.fc_container_audit_log  (write side: src/lib/container-audit.ts,
 *     owned by the not-yet-refactored Container Tracking domain — read-only here)
 *   - shipcore.fc_invoice_audit_log    (write side: src/lib/invoice-audit.ts,
 *     owned by the invoice-price-control domain — read-only here)
 *   - shipcore.fc_audit_log            (write side: src/lib/audit.ts, the
 *     shared writer used by factories/warehouses/integrations/sku-master)
 *
 * Business logic (allow-listed filter values, pagination defaults) lives in
 * src/lib/audit-log/service.ts — this file only runs the query.
 */

import { getPrimaryPool } from "@/lib/db/primary-db";

export interface AuditLogFilter {
  user: string;
  entity: string;
  entityId: string;
  entityType: string;
  action: string;
  startDate: string;
  endDate: string;
}

export interface AuditLogRow {
  id: string;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  note: string | null;
  ip: string | null;
  createdAt: string;
}

const UNION_SQL = `
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
    'i:' || ial.id::text  AS id,
    'invoice'             AS entity_type,
    ial.invoice_id::text  AS entity_id,
    COALESCE(ial.invoice_number, inv.invoice_number, ial.invoice_id::text) AS entity_label,
    ial.user_id, ial.user_name, ial.user_email,
    ial.action, ial.before, ial.after, ial.note, ial.ip, ial.created_at
  FROM shipcore.fc_invoice_audit_log ial
  LEFT JOIN shipcore.fc_invoices inv ON inv.id = ial.invoice_id

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

function buildWhere(filter: AuditLogFilter): { where: string; values: unknown[] } {
  const filters: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (filter.user) {
    values.push(`%${filter.user}%`);
    filters.push(`(
      COALESCE(user_name, '') ILIKE $${idx}
      OR COALESCE(user_email, '') ILIKE $${idx}
      OR COALESCE(user_id, '') ILIKE $${idx}
    )`);
    idx++;
  }

  if (filter.entity) {
    values.push(`%${filter.entity}%`);
    filters.push(`(
      COALESCE(entity_label, '') ILIKE $${idx}
      OR COALESCE(entity_id, '') ILIKE $${idx}
      OR COALESCE(before::text, '') ILIKE $${idx}
      OR COALESCE(after::text, '') ILIKE $${idx}
      OR COALESCE(note, '') ILIKE $${idx}
    )`);
    idx++;
  }

  if (filter.entityId) {
    values.push(filter.entityId);
    filters.push(`entity_id = $${idx++}`);
  }

  if (filter.entityType) {
    values.push(filter.entityType);
    filters.push(`entity_type = $${idx++}`);
  }

  if (filter.action) {
    values.push(filter.action);
    filters.push(`action = $${idx++}`);
  }

  if (filter.startDate) {
    values.push(filter.startDate);
    filters.push(`created_at >= $${idx++}::date`);
  }

  if (filter.endDate) {
    values.push(filter.endDate);
    filters.push(`created_at < ($${idx++}::date + INTERVAL '1 day')`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  return { where, values };
}

export const AuditLogRepository = {
  async query(filter: AuditLogFilter, limit: number, offset: number): Promise<{ rows: AuditLogRow[]; total: number }> {
    const { where, values } = buildWhere(filter);
    const pool = getPrimaryPool();
    let idx = values.length + 1;

    const [countResult, dataResult] = await Promise.all([
      pool.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM (${UNION_SQL}) combined
         ${where}`,
        values,
      ),
      pool.query(
        `SELECT id, entity_type, entity_id, entity_label,
                user_id, user_name, user_email,
                action, before, after, note, ip, created_at
         FROM (${UNION_SQL}) combined
         ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT $${idx++} OFFSET $${idx}`,
        [...values, limit, offset],
      ),
    ]);

    return {
      total: Number(countResult.rows[0]?.total ?? 0),
      rows: dataResult.rows.map((row) => ({
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
    };
  },
};
