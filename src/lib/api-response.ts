import { NextResponse } from "next/server";
import { z } from "zod";
import { NotFoundError, ConflictError, ValidationError, ServiceUnavailableError } from "./errors";

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export function apiSuccess<T extends Record<string, unknown>>(
  body: T,
  status = 200
) {
  return NextResponse.json({ success: true, ...body }, { status });
}

export function apiError(message: string, status = 500, details?: unknown) {
  return NextResponse.json(
    { success: false, error: message, ...(details !== undefined ? { details } : {}) },
    { status }
  );
}

/**
 * Maps errors thrown by the Service layer to the API's standard error envelope.
 * Controllers should route unexpected errors through this instead of
 * hand-rolling status codes per route.
 */
export function handleApiError(error: unknown) {
  if (error instanceof z.ZodError) {
    return apiError("Validation error", 400, error.issues);
  }
  if (error instanceof ValidationError) {
    return apiError(error.message, 400);
  }
  if (error instanceof NotFoundError) {
    return apiError(error.message, 404);
  }
  if (error instanceof ConflictError) {
    return apiError(error.message, 409);
  }
  if (error instanceof ServiceUnavailableError) {
    return apiError(error.message, 503);
  }
  return apiError(getErrorMessage(error), 500);
}
