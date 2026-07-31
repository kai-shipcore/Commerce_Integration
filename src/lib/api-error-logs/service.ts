import { ApiErrorLogRepository } from "@/lib/api-error-logs/repository";

const MAX_MESSAGE_LENGTH = 4_000;
const MAX_STACK_LENGTH = 32_000;

export interface RecordApiErrorInput {
  requestId: string;
  method: string | null;
  pathname: string | null;
  statusCode: number;
  errorCode: string;
  errorName: string;
  message: string;
  stack: string | null;
  userId?: string | null;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

/** Best-effort technical logging. A logging failure must never replace the original API error. */
export const ApiErrorLogService = {
  async record(input: RecordApiErrorInput): Promise<void> {
    try {
      await ApiErrorLogRepository.create({
        ...input,
        message: input.message.slice(0, MAX_MESSAGE_LENGTH),
        stack: input.stack?.slice(0, MAX_STACK_LENGTH) ?? null,
        userId: input.userId ?? null,
        metadata: input.metadata ?? {},
      });
    } catch (error) {
      console.error("[ApiErrorLog] Failed to persist API error:", error);
    }
  },
};
