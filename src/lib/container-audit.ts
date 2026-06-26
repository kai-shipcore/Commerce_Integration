import { getPrimaryPool } from "@/lib/db/primary-db";

export type ContainerAuditAction =
  | "status_change"
  | "details_update"
  | "eta_change"
  | "items_update"
  | "note_added"
  | "create"
  | "delete";

export interface ContainerAuditParams {
  containerId: string | number;
  containerNumber?: string | null;
  userId?: string | null;
  userName?: string | null;
  userEmail?: string | null;
  action: ContainerAuditAction;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  note?: string | null;
  ip?: string | null;
}

export async function logContainerAudit(params: ContainerAuditParams): Promise<void> {
  try {
    await getPrimaryPool().query(
      `INSERT INTO shipcore.fc_container_audit_log
         (container_id, container_number, user_id, user_name, user_email,
          action, before, after, note, ip, created_at)
       VALUES ($1::bigint, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, NOW())`,
      [
        params.containerId,
        params.containerNumber ?? null,
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
    console.error("[ContainerAudit] Failed to log:", err);
  }
}
