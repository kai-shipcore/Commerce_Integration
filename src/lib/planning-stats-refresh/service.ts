import { DemandPlanningService } from "@/lib/demand-planning/service";
import {
  PlanningStatsRefreshRepository,
  type PlanningStatsRefreshPayload,
} from "@/lib/planning-stats-refresh/repository";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const scheduledJobs = new Set<string>();

async function execute(jobId: string): Promise<void> {
  const job = await PlanningStatsRefreshRepository.markRunning(jobId);
  if (!job) return;

  try {
    const result = await DemandPlanningService.refreshStats(job.payload);
    if (!result) throw new Error("No database connection available");
    await PlanningStatsRefreshRepository.markSucceeded(jobId, result);
  } catch (error: unknown) {
    await PlanningStatsRefreshRepository.markFailed(jobId, errorMessage(error));
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
  async queue(payload: PlanningStatsRefreshPayload) {
    const queued = await PlanningStatsRefreshRepository.queueJob(payload);
    if (queued.job.status === "queued") schedule(queued.job.id);
    return queued;
  },

  getJob(id: string) {
    return PlanningStatsRefreshRepository.getJob(id);
  },
};
