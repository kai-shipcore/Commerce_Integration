/**
 * Business logic for the merged Audit Log viewer: pagination defaults and
 * the allow-listed entityType/action values (unknown values are silently
 * ignored rather than rejected, so a stale filter never produces a hard
 * error — matches the original route's tolerant behavior). No caching by
 * design: this is a live audit trail, not a cacheable read.
 */

import { AuditLogRepository } from "@/lib/audit-log/repository";

// All valid action values across all three unioned audit tables.
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

export interface AuditLogQuery {
  user: string;
  entity: string;
  entityId: string;
  entityType: string;
  action: string;
  startDate: string;
  endDate: string;
  exportAll: boolean;
  pageParam: string | null;
  limitParam: string | null;
}

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export const AuditLogService = {
  async listAuditLogs(query: AuditLogQuery) {
    const page = parsePositiveInt(query.pageParam, 1, 100000);
    const limit = query.exportAll ? 5000 : parsePositiveInt(query.limitParam, 20, 100);
    const offset = (page - 1) * limit;

    const filter = {
      user: query.user,
      entity: query.entity,
      entityId: query.entityId,
      entityType: ENTITY_TYPES.has(query.entityType) ? query.entityType : "",
      action: ACTIONS.has(query.action) ? query.action : "",
      startDate: query.startDate,
      endDate: query.endDate,
    };

    try {
      const { rows, total } = await AuditLogRepository.query(filter, limit, offset);

      return {
        data: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      };
    } catch (error) {
      console.error("[AdminAuditLog GET]", error);
      throw new Error("Failed to fetch audit logs");
    }
  },
};
