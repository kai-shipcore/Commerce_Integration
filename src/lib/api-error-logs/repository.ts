import { getPrimaryPool } from "@/lib/db/primary-db";

export interface CreateApiErrorLogInput {
  requestId: string;
  method: string | null;
  pathname: string | null;
  statusCode: number;
  errorCode: string;
  errorName: string;
  message: string;
  stack: string | null;
  userId: string | null;
  durationMs: number;
  metadata: Record<string, unknown>;
}

export const ApiErrorLogRepository = {
  async create(input: CreateApiErrorLogInput): Promise<void> {
    await getPrimaryPool().query(
      `INSERT INTO shipcore.fc_api_error_logs
         (request_id, method, pathname, status_code, error_code, error_name,
          message, stack, user_id, duration_ms, metadata, occurred_at)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW())`,
      [
        input.requestId,
        input.method,
        input.pathname,
        input.statusCode,
        input.errorCode,
        input.errorName,
        input.message,
        input.stack,
        input.userId,
        input.durationMs,
        JSON.stringify(input.metadata),
      ],
    );
  },
};
