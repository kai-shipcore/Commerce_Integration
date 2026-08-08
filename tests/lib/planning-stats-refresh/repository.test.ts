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
  created_at: "2026-08-07T00:00:00Z",
  started_at: "2026-08-07T00:00:01Z",
  finished_at: null,
  updated_at: "2026-08-07T00:00:01Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PlanningStatsRefreshRepository.queueJob", () => {
  it("reuses the active job instead of queuing duplicate work", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [activeJob] });

    const result = await PlanningStatsRefreshRepository.queueJob({});

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

    const result = await PlanningStatsRefreshRepository.queueJob({ salesWindowWeights: { d30: 0.3 } });

    expect(result).toEqual({ job: queuedJob, created: true });
    const [sql, params] = queryMock.mock.calls[2];
    expect(sql).toContain("INSERT INTO shipcore.fc_planning_stats_refresh_jobs");
    expect(params[1]).toContain('"d30":0.3');
  });
});

describe("PlanningStatsRefreshRepository job transitions", () => {
  it("marks a job succeeded with its refresh result", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const result = { inventoryUpserted: 1, linkSalesUpserted: 2, customSalesUpserted: 3 };

    await PlanningStatsRefreshRepository.markSucceeded(activeJob.id, result);

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("status = 'succeeded'");
    expect(params).toEqual([activeJob.id, JSON.stringify(result)]);
  });
});
