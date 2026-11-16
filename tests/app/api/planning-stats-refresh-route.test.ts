import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const canDoMock = vi.fn();
const queueMock = vi.fn();
const listJobsMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/permissions", () => ({ canDo: canDoMock }));
vi.mock("@/lib/planning-stats-refresh/service", () => ({
  PlanningStatsRefreshService: { queue: queueMock, listJobs: listJobsMock },
}));

const { GET, POST } = await import("@/app/api/planning/stats/refresh/route");
const { NextRequest } = await import("next/server");

const correlationId = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({
    user: { id: "user-1", email: "planner@shipcore.com", role: "admin" },
  });
  canDoMock.mockResolvedValue(true);
});

describe("POST /api/planning/stats/refresh", () => {
  it("records the authenticated requester, page source, and correlation ID", async () => {
    queueMock.mockResolvedValue({
      created: true,
      job: { id: "job-1", status: "queued", correlation_id: correlationId },
    });
    const request = new Request("http://localhost/forecast/api/planning/stats/refresh", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        referer: "http://localhost/forecast/planning/dashboard-ag-grid?product=fm",
        "x-correlation-id": correlationId,
      },
      body: JSON.stringify({ salesWindowWeights: { d30: 0.3 } }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(response.headers.get("x-correlation-id")).toBe(correlationId);
    expect(queueMock).toHaveBeenCalledWith(
      { salesWindowWeights: { d30: 0.3 } },
      {
        requestedBy: "user-1",
        requestedByEmail: "planner@shipcore.com",
        source: "/forecast/planning/dashboard-ag-grid",
        correlationId,
      },
    );
    expect(body.data).toMatchObject({ jobId: "job-1", reused: false, correlationId });
  });

  it("rejects an unauthenticated refresh without queuing work", async () => {
    authMock.mockResolvedValue(null);
    const response = await POST(new Request("http://localhost/api/planning/stats/refresh", { method: "POST" }));

    expect(response.status).toBe(401);
    expect(queueMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/planning/stats/refresh", () => {
  it("returns a paginated filtered history", async () => {
    listJobsMock.mockResolvedValue({ jobs: [{ id: "job-1", status: "failed" }], total: 21 });
    const request = new NextRequest("http://localhost/api/planning/stats/refresh?page=2&limit=20&status=failed");

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(listJobsMock).toHaveBeenCalledWith({ limit: 20, offset: 20, status: "failed" });
    expect(body.pagination).toEqual({ page: 2, limit: 20, total: 21, totalPages: 2 });
  });

  it("rejects invalid pagination", async () => {
    const response = await GET(new NextRequest("http://localhost/api/planning/stats/refresh?page=0"));

    expect(response.status).toBe(400);
    expect(listJobsMock).not.toHaveBeenCalled();
  });
});
