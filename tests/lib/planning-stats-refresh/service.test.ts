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
const workbenchPushMock = vi.fn();
vi.mock("@/lib/workbench-container-push/service", () => ({
  WorkbenchContainerPushService: { push: workbenchPushMock },
}));

const workbenchOutcome = {
  status: "succeeded",
  target: "staging.cowork.coverland.com",
  considered: 2,
  sent: 2,
  created: 1,
  updated: 0,
  unchanged: 1,
  failed: 0,
  skipped: 0,
  skipReasons: {},
  errors: [],
  durationMs: 10,
};

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
  workbenchPushMock.mockResolvedValue(workbenchOutcome);
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

  it("runs the refresh and records the result, with the Workbench push, after returning the queued job", async () => {
    queueJobMock.mockResolvedValue({ job, created: true });
    markRunningMock.mockResolvedValue({
      ...job,
      status: "running",
      payload: {},
      correlation_id: requestContext.correlationId,
    });
    const result = { inventoryUpserted: 1, linkSalesUpserted: 2, customSalesUpserted: 3, productsBackfilled: 4 };
    refreshStatsMock.mockResolvedValue(result);

    await PlanningStatsRefreshService.queue({}, requestContext);

    await vi.waitFor(() =>
      expect(markSucceededMock).toHaveBeenCalledWith(job.id, { ...result, workbench: workbenchOutcome }),
    );
    expect(workbenchPushMock).toHaveBeenCalledWith({ requestId: requestContext.correlationId });
  });

  it("marks the durable job failed when the background refresh fails, keeping the push outcome", async () => {
    queueJobMock.mockResolvedValue({ job, created: true });
    markRunningMock.mockResolvedValue({ ...job, status: "running", payload: {} });
    refreshStatsMock.mockRejectedValue(new Error("lookup unavailable"));

    await PlanningStatsRefreshService.queue({}, requestContext);

    await vi.waitFor(() =>
      expect(markFailedMock).toHaveBeenCalledWith(job.id, "lookup unavailable", { workbench: workbenchOutcome }),
    );
  });

  it("does not let a crashed Workbench push fail the refresh", async () => {
    queueJobMock.mockResolvedValue({ job, created: true });
    markRunningMock.mockResolvedValue({ ...job, status: "running", payload: {} });
    const result = { inventoryUpserted: 1, linkSalesUpserted: 2, customSalesUpserted: 3, productsBackfilled: 4 };
    refreshStatsMock.mockResolvedValue(result);
    workbenchPushMock.mockRejectedValue(new Error("boom"));

    await PlanningStatsRefreshService.queue({}, requestContext);

    await vi.waitFor(() =>
      expect(markSucceededMock).toHaveBeenCalledWith(job.id, {
        ...result,
        workbench: { status: "skipped", reason: "Workbench push crashed: boom" },
      }),
    );
    expect(markFailedMock).not.toHaveBeenCalled();
  });
});
