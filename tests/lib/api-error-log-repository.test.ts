import { beforeEach, describe, expect, it, vi } from "vitest";

const poolQueryMock = vi.fn();
vi.mock("@/lib/db/primary-db", () => ({
  getPrimaryPool: vi.fn(() => ({ query: poolQueryMock })),
}));

const { ApiErrorLogRepository } = await import("@/lib/api-error-logs/repository");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ApiErrorLogRepository.create", () => {
  it("writes a parameterized technical error log without request data", async () => {
    poolQueryMock.mockResolvedValue({ rowCount: 1 });

    await ApiErrorLogRepository.create({
      requestId: "00000000-0000-4000-8000-000000000000",
      method: "POST",
      pathname: "/api/factories",
      statusCode: 500,
      errorCode: "HTTP_500",
      errorName: "Error",
      message: "Database unavailable",
      stack: "Error: Database unavailable",
      userId: null,
      durationMs: 25,
      metadata: {},
    });

    const [sql, params] = poolQueryMock.mock.calls[0];
    expect(sql).toContain("INSERT INTO shipcore.fc_api_error_logs");
    expect(params).toEqual([
      "00000000-0000-4000-8000-000000000000",
      "POST",
      "/api/factories",
      500,
      "HTTP_500",
      "Error",
      "Database unavailable",
      "Error: Database unavailable",
      null,
      25,
      "{}",
    ]);
  });
});
