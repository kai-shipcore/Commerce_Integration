import { beforeEach, describe, expect, it, vi } from "vitest";

const queueJobMock = vi.fn();
const markRunningMock = vi.fn();
const markSucceededMock = vi.fn();
const markFailedMock = vi.fn();
const getJobMock = vi.fn();
const refreshStatsMock = vi.fn();

vi.mock("@/lib/planning-stats-refresh/repository", () => ({
  PlanningStatsRefreshRepository: {
    queueJob: queueJobMock,
    markRunning: markRunningMock,
    markSucceeded: markSucceededMock,
    markFailed: markFailedMock,
    getJob: getJobMock,
  },
}));
vi.mock("@/lib/demand-planning/service", () => ({
  DemandPlanningService: { refreshStats: refreshStatsMock },
}));

const { PlanningStatsRefreshService } = await import("@/lib/planning-stats-refresh/service");

const job = { id: "11111111-1111-4111-8111-111111111111", status: "queued" };
const requestContext = {
  requestedBy: "user-1",
  requestedByEmail: "planner@shipcore.com",
  source: "/forecast/planning/dashboard-ag-grid",
  correlationId: "22222222-2222-4222-8222-222222222222",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PlanningStatsRefreshService.queue", () => {
  it("schedules a newly created job on the background runner", async () => {
    queueJobMock.mockResolvedValue({ job, created: true });
    markRunningMock.mockResolvedValue(null);

    await PlanningStatsRefreshService.queue({}, requestContext);

    expect(queueJobMock).toHaveBeenCalledWith({}, requestContext);

    await vi.waitFor(() => expect(markRunningMock).toHaveBeenCalledWith(job.id));
  });

  it("does not schedule duplicate work when a running job is reused", async () => {
    queueJobMock.mockResolvedValue({ job: { ...job, status: "running" }, created: false });

    await PlanningStatsRefreshService.queue({}, requestContext);

    await new Promise((resolve) => setImmediate(resolve));
    expect(markRunningMock).not.toHaveBeenCalled();
  });

  it("runs the refresh and records the result after returning the queued job", async () => {
    queueJobMock.mockResolvedValue({ job, created: true });
    markRunningMock.mockResolvedValue({ ...job, status: "running", payload: {} });
    const result = { inventoryUpserted: 1, linkSalesUpserted: 2, customSalesUpserted: 3, productsBackfilled: 4 };
    refreshStatsMock.mockResolvedValue(result);

    await PlanningStatsRefreshService.queue({}, requestContext);

    await vi.waitFor(() => expect(markSucceededMock).toHaveBeenCalledWith(job.id, result));
  });

  it("marks the durable job failed when the background refresh fails", async () => {
    queueJobMock.mockResolvedValue({ job, created: true });
    markRunningMock.mockResolvedValue({ ...job, status: "running", payload: {} });
    refreshStatsMock.mockRejectedValue(new Error("lookup unavailable"));

    await PlanningStatsRefreshService.queue({}, requestContext);

    await vi.waitFor(() => expect(markFailedMock).toHaveBeenCalledWith(job.id, "lookup unavailable"));
  });
});
