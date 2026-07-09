import { getPrimaryPool } from "@/lib/db/primary-db";

export type InvoiceAuditAction =
  | "create"
  | "status_change"
  | "details_update"
  | "items_update"
  | "recompare"
  | "credit_update"
  | "factory_confirm_update"
  | "attachment_update"
  | "credit_note_create"
  | "credit_note_status_change"
  | "delete";

export interface InvoiceAuditParams {
  invoiceId: string | number;
  invoiceNumber?: string | null;
  userId?: string | null;
  userName?: string | null;
  userEmail?: string | null;
  action: InvoiceAuditAction;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  note?: string | null;
  ip?: string | null;
}

export async function logInvoiceAudit(params: InvoiceAuditParams): Promise<void> {
  try {
    await getPrimaryPool().query(
      `INSERT INTO shipcore.fc_invoice_audit_log
         (invoice_id, invoice_number, user_id, user_name, user_email,
          action, before, after, note, ip, created_at)
       VALUES ($1::bigint, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, NOW())`,
      [
        params.invoiceId,
        params.invoiceNumber ?? null,
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
    console.error("[InvoiceAudit] Failed to log:", err);
  }
}
