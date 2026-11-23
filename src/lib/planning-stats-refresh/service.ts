import { DemandPlanningService } from "@/lib/demand-planning/service";
import {
  PlanningStatsRefreshRepository,
  type PlanningStatsRefreshPayload,
  type PlanningStatsRefreshRequestContext,
} from "@/lib/planning-stats-refresh/repository";
import {
  WorkbenchContainerPushService,
  type WorkbenchContainerPushResult,
} from "@/lib/workbench-container-push/service";
import {
  WorkbenchSalesRatePushService,
  type WorkbenchSalesRatePushResult,
} from "@/lib/workbench-sales-rate-push/service";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const scheduledJobs = new Set<string>();

async function execute(jobId: string): Promise<void> {
  const job = await PlanningStatsRefreshRepository.markRunning(jobId);
  if (!job) return;

  // The container push to Workbench shares nothing with the stats refresh, so
  // it runs alongside it, and its outcome is recorded whichever way the
  // refresh ends. It is not allowed to fail the job. The catch is attached
  // now, not at the await below: a rejection while the refresh is still
  // running would otherwise be an unhandled rejection.
  const workbenchPush = WorkbenchContainerPushService.push({ requestId: job.correlation_id })
    .catch((error: unknown): WorkbenchContainerPushResult => ({
      status: "skipped",
      reason: `Workbench push crashed: ${errorMessage(error)}`,
    }));

  try {
    const result = await DemandPlanningService.refreshStats(job.payload);
    if (!result) throw new Error("No database connection available");
    // The sales rates are read from the stats this refresh just wrote, so that
    // push runs after it, and not at all when the refresh failed: the rates in
    // Workbench then stay as the last good Sync left them. It cannot fail the job.
    const workbenchSalesRates = await WorkbenchSalesRatePushService.push({
      requestId: job.correlation_id,
      salesWindowWeights: job.payload.salesWindowWeights,
    }).catch((error: unknown): WorkbenchSalesRatePushResult => ({
      status: "skipped",
      reason: `Workbench sales rate push crashed: ${errorMessage(error)}`,
    }));
    await PlanningStatsRefreshRepository.markSucceeded(jobId, {
      ...result,
      workbench: await workbenchPush,
      workbenchSalesRates,
    });
  } catch (error: unknown) {
    await PlanningStatsRefreshRepository.markFailed(jobId, errorMessage(error), { workbench: await workbenchPush });
  }
}

function schedule(jobId: string): void {
  if (scheduledJobs.has(jobId)) return;
  scheduledJobs.add(jobId);
  setImmediate(() => {
    void execute(jobId).finally(() => scheduledJobs.delete(jobId));
  });
}

export const PlanningStatsRefreshService = {
  listJobs(options: { limit: number; offset: number; status?: "queued" | "running" | "succeeded" | "failed" }) {
    return PlanningStatsRefreshRepository.listJobs(options);
  },

  async queue(payload: PlanningStatsRefreshPayload, context: PlanningStatsRefreshRequestContext) {
    const queued = await PlanningStatsRefreshRepository.queueJob(payload, context);
    if (queued.job.status === "queued") schedule(queued.job.id);
    return queued;
  },

  getJob(id: string) {
    return PlanningStatsRefreshRepository.getJob(id);
  },
};
