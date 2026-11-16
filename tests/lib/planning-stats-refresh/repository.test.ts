import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/db/primary-db", () => ({
  getPrimaryPool: vi.fn(() => ({ query: queryMock })),
}));

const { PlanningStatsRefreshRepository } = await import("@/lib/planning-stats-refresh/repository");

const activeJob = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "running",
  payload: {},
  result: null,
  error: null,
  requested_by: "user-1",
  requested_by_email: "planner@shipcore.com",
  source: "/forecast/planning/dashboard-ag-grid",
  correlation_id: "22222222-2222-4222-8222-222222222222",
  created_at: "2026-08-07T00:00:00Z",
  started_at: "2026-08-07T00:00:01Z",
  finished_at: null,
  updated_at: "2026-08-07T00:00:01Z",
};

const requestContext = {
  requestedBy: "user-1",
  requestedByEmail: "planner@shipcore.com",
  source: "/forecast/planning/dashboard-ag-grid",
  correlationId: "22222222-2222-4222-8222-222222222222",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PlanningStatsRefreshRepository.queueJob", () => {
  it("reuses the active job instead of queuing duplicate work", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [activeJob] });

    const result = await PlanningStatsRefreshRepository.queueJob({}, requestContext);

    expect(result).toEqual({ job: activeJob, created: false });
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[0][0]).toContain("INTERVAL '30 minutes'");
  });

  it("inserts a queued job when no refresh is active", async () => {
    const queuedJob = { ...activeJob, status: "queued" };
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [queuedJob] });

    const result = await PlanningStatsRefreshRepository.queueJob(
      { salesWindowWeights: { d30: 0.3 } },
      requestContext,
    );

    expect(result).toEqual({ job: queuedJob, created: true });
    const [sql, params] = queryMock.mock.calls[2];
    expect(sql).toContain("INSERT INTO shipcore.fc_planning_stats_refresh_jobs");
    expect(params[1]).toContain('"d30":0.3');
    expect(params.slice(2)).toEqual([
      requestContext.requestedBy,
      requestContext.requestedByEmail,
      requestContext.source,
      requestContext.correlationId,
    ]);
  });
});

describe("PlanningStatsRefreshRepository.listJobs", () => {
  it("returns a filtered page and total count", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [activeJob] })
      .mockResolvedValueOnce({ rows: [{ total: 21 }] });

    const result = await PlanningStatsRefreshRepository.listJobs({
      limit: 20,
      offset: 20,
      status: "running",
    });

    expect(result).toEqual({ jobs: [activeJob], total: 21 });
    expect(queryMock.mock.calls[0][0]).toContain("WHERE status = $1");
    expect(queryMock.mock.calls[0][1]).toEqual(["running", 20, 20]);
    expect(queryMock.mock.calls[1][1]).toEqual(["running"]);
  });
});

describe("PlanningStatsRefreshRepository job transitions", () => {
  it("marks a job succeeded with its refresh result", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const result = { inventoryUpserted: 1, linkSalesUpserted: 2, customSalesUpserted: 3, productsBackfilled: 4 };

    await PlanningStatsRefreshRepository.markSucceeded(activeJob.id, result);

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("status = 'succeeded'");
    expect(params).toEqual([activeJob.id, JSON.stringify(result)]);
  });
});
