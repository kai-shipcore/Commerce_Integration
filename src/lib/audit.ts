import { getPrimaryPool } from "@/lib/db/primary-db";

export type AuditEntityType =
  | "factory"
  | "warehouse"
  | "sku"
  | "user_permission"
  | "user_role"
  | "user_name"
  | "integration"
  | "production_part"
  | "production_code"
  | "designer_initial"
  | "part_sku";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "status_change"
  | "permission_grant"
  | "permission_revoke"
  | "role_change"
  | "config_update";

export interface AuditParams {
  entityType: AuditEntityType;
  entityId: string;
  entityLabel?: string | null;
  userId?: string | null;
  userName?: string | null;
  userEmail?: string | null;
  action: AuditAction;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  note?: string | null;
  ip?: string | null;
}

export async function logAudit(params: AuditParams): Promise<void> {
  try {
    await getPrimaryPool().query(
      `INSERT INTO shipcore.fc_audit_log
         (entity_type, entity_id, entity_label, user_id, user_name, user_email,
          action, before, after, note, ip, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, NOW())`,
      [
        params.entityType,
        params.entityId,
        params.entityLabel ?? null,
        params.userId ?? null,
        params.userName ?? null,
        params.userEmail ?? null,
        params.action,
        params.before != null ? JSON.stringify(params.before) : null,
        params.after != null ? JSON.stringify(params.after) : null,
        params.note ?? null,
        params.ip ?? null,
      ],
    );
  } catch (err) {
    console.error("[Audit] Failed to log:", err);
  }
}

export function getIp(headers: Headers): string | null {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}
