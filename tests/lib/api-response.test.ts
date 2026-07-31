import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { apiSuccess, withErrorHandler } from "@/lib/api-response";
import { GatewayTimeoutError, NotFoundError } from "@/lib/errors";

const errorLogRecordMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-error-logs/service", () => ({
  ApiErrorLogService: { record: errorLogRecordMock },
}));

afterEach(() => {
  vi.restoreAllMocks();
  errorLogRecordMock.mockReset();
});

describe("withErrorHandler", () => {
  it("returns a successful handler response unchanged", async () => {
    const handler = withErrorHandler(async () => apiSuccess({ data: { id: "1" } }, 201));

    const response = await handler();

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ success: true, data: { id: "1" } });
  });

  it("maps service errors through handleApiError", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withErrorHandler(async () => {
      throw new NotFoundError("Factory not found");
    });

    const response = await handler();
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ success: false, error: "Factory not found" });
    expect(body.requestId).toMatch(UUID_PATTERN_FOR_TEST);
    expect(errorLogRecordMock).not.toHaveBeenCalled();
  });

  it("maps Zod validation errors to a 400 response", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withErrorHandler(async () => {
      z.object({ name: z.string().min(1) }).parse({ name: "" });
      return apiSuccess({});
    });

    const response = await handler();
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ success: false, error: "Validation error" });
    expect(body.details).toHaveLength(1);
    expect(errorLogRecordMock).not.toHaveBeenCalled();
  });

  it("persists unexpected 5xx errors with a request ID", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    errorLogRecordMock.mockResolvedValue(undefined);
    const request = new Request("http://localhost/api/factories", { method: "POST" });
    const handler = withErrorHandler(async (requestArg: Request) => {
      void requestArg;
      throw new Error("Database unavailable");
    });

    const response = await handler(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ success: false, error: "Database unavailable" });
    expect(body.requestId).toMatch(UUID_PATTERN_FOR_TEST);
    expect(response.headers.get("x-request-id")).toBe(body.requestId);
    expect(errorLogRecordMock).toHaveBeenCalledWith(expect.objectContaining({
      requestId: body.requestId,
      method: "POST",
      pathname: "/api/factories",
      statusCode: 500,
      errorCode: "HTTP_500",
      errorName: "Error",
      message: "Database unavailable",
    }));
  });

  it("returns the original 5xx response when error logging fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    errorLogRecordMock.mockRejectedValue(new Error("Log database unavailable"));
    const handler = withErrorHandler(async () => {
      throw new Error("Original failure");
    });

    const response = await handler();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: "Original failure",
    });
  });

  it("maps gateway timeouts to 504 and persists the error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    errorLogRecordMock.mockResolvedValue(undefined);
    const request = new Request("http://localhost/api/test/gateway-timeout", {
      method: "POST",
    });
    const handler = withErrorHandler(async (request: Request) => {
      void request;
      throw new GatewayTimeoutError("Upstream forecast server timed out");
    });

    const response = await handler(request);
    const body = await response.json();

    expect(response.status).toBe(504);
    expect(body).toMatchObject({
      success: false,
      error: "Upstream forecast server timed out",
    });
    expect(body.requestId).toMatch(UUID_PATTERN_FOR_TEST);
    expect(errorLogRecordMock).toHaveBeenCalledWith(expect.objectContaining({
      requestId: body.requestId,
      method: "POST",
      pathname: "/api/test/gateway-timeout",
      statusCode: 504,
      errorCode: "GATEWAY_TIMEOUT",
      errorName: "GatewayTimeoutError",
      message: "Upstream forecast server timed out",
    }));
  });
});

const UUID_PATTERN_FOR_TEST = /^[0-9a-f-]{36}$/i;
