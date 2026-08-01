import { NextResponse } from "next/server";
import { z } from "zod";
import {
  NotFoundError,
  ConflictError,
  ValidationError,
  ServiceUnavailableError,
  ForbiddenError,
  GatewayTimeoutError,
} from "./errors";
import { ApiErrorLogService } from "@/lib/api-error-logs/service";

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export function apiSuccess<T extends Record<string, unknown>>(
  body: T,
  status = 200
) {
  return NextResponse.json({ success: true, ...body }, { status });
}

export function apiError(message: string, status = 500, details?: unknown, requestId?: string) {
  const response = NextResponse.json(
    {
      success: false,
      error: message,
      ...(details !== undefined ? { details } : {}),
      ...(requestId ? { requestId } : {}),
    },
    { status }
  );
  if (requestId) response.headers.set("x-request-id", requestId);
  return response;
}

/**
 * Maps errors thrown by the Service layer to the API's standard error envelope.
 * Controllers should route unexpected errors through this instead of
 * hand-rolling status codes per route.
 */
export function handleApiError(error: unknown, requestId?: string) {
  if (error instanceof z.ZodError) {
    return apiError("Validation error", 400, error.issues, requestId);
  }
  if (error instanceof ValidationError) {
    return apiError(error.message, 400, undefined, requestId);
  }
  if (error instanceof NotFoundError) {
    return apiError(error.message, 404, undefined, requestId);
  }
  if (error instanceof ConflictError) {
    return apiError(error.message, 409, undefined, requestId);
  }
  if (error instanceof ForbiddenError) {
    return apiError(error.message, 403, undefined, requestId);
  }
  if (error instanceof ServiceUnavailableError) {
    return apiError(error.message, 503, undefined, requestId);
  }
  if (error instanceof GatewayTimeoutError) {
    return apiError(error.message, 504, undefined, requestId);
  }
  return apiError(getErrorMessage(error), 500, undefined, requestId);
}

type RouteHandlerResult = Response | Promise<Response>;

/**
 * Runs a Route Handler through the shared API error mapper so controllers do
 * not need to repeat the same try/catch block.
 */
export function withErrorHandler<TArgs extends unknown[]>(
  handler: (...args: TArgs) => RouteHandlerResult
) {
  return async (...args: TArgs): Promise<Response> => {
    const startedAt = Date.now();
    try {
      return await handler(...args);
    } catch (error) {
      const request = args[0] instanceof Request ? args[0] : null;
      const route = request ? `${request.method} ${new URL(request.url).pathname}` : "API route";
      const requestId = requestIdFrom(request);
      console.error(`[${route}]`, error);
      const response = handleApiError(error, requestId);

      if (response.status >= 500) {
        await recordApiErrorWithTimeout({
          requestId,
          method: request?.method ?? null,
          pathname: request ? new URL(request.url).pathname : null,
          statusCode: response.status,
          errorCode: response.status === 503
            ? "SERVICE_UNAVAILABLE"
            : response.status === 504
              ? "GATEWAY_TIMEOUT"
              : `HTTP_${response.status}`,
          errorName: error instanceof Error ? error.name : "UnknownError",
          message: getErrorMessage(error),
          stack: error instanceof Error ? error.stack ?? null : null,
          durationMs: Date.now() - startedAt,
        });
      }

      return response;
    }
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_LOG_TIMEOUT_MS = 500;

function requestIdFrom(request: Request | null): string {
  const incoming = request?.headers.get("x-request-id")?.trim();
  return incoming && UUID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
}

async function recordApiErrorWithTimeout(
  input: Parameters<typeof ApiErrorLogService.record>[0]
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      ApiErrorLogService.record(input),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, ERROR_LOG_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    console.error("[ApiErrorLog] Unexpected logging failure:", error);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
