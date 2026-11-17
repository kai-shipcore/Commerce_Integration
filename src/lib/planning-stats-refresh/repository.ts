import { randomUUID } from "node:crypto";
import { getPrimaryPool } from "@/lib/db/primary-db";
import type { WorkbenchContainerPushResult } from "@/lib/workbench-container-push/service";

export type PlanningStatsRefreshStatus = "queued" | "running" | "succeeded" | "failed";

export type PlanningStatsRefreshPayload = {
  salesWindowWeights?: unknown;
  oosLostDemandWeights?: unknown;
};

export type PlanningStatsRefreshRequestContext = {
  requestedBy: string;
  requestedByEmail: string | null;
  source: string;
  correlationId: string;
};

export type PlanningStatsRefreshResult = {
  inventoryUpserted: number;
  linkSalesUpserted: number;
  customSalesUpserted: number;
  productsBackfilled: number;
  // Added with the Step 0 velocity-snapshot sync; absent on jobs recorded
  // before it, hence optional.
  velocityLinkUpserted?: number;
  velocityCustomUpserted?: number;
  velocitySnapshotStale?: boolean;
  // The container push to Workbench that runs with every refresh (2026-11).
  workbench?: WorkbenchContainerPushResult;
};

export type PlanningStatsRefreshJob = {
  id: string;
  status: PlanningStatsRefreshStatus;
  payload: PlanningStatsRefreshPayload;
  result: PlanningStatsRefreshResult | null;
  error: string | null;
  requested_by: string | null;
  requested_by_email: string | null;
  source: string;
  correlation_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
};

type QueuedJob = { job: PlanningStatsRefreshJob; created: boolean };

export type PlanningStatsRefreshListResult = {
  jobs: PlanningStatsRefreshJob[];
  total: number;
};

async function expireStaleRunningJobs(): Promise<void> {
  await getPrimaryPool().query(`
    UPDATE shipcore.fc_planning_stats_refresh_jobs
    SET status = 'failed',
        error = 'Background worker stopped before the refresh completed',
        finished_at = NOW(), updated_at = NOW()
    WHERE status = 'running'
      AND updated_at < NOW() - INTERVAL '30 minutes'
  `);
}

async function findActiveJob(): Promise<PlanningStatsRefreshJob | null> {
  const result = await getPrimaryPool().query<PlanningStatsRefreshJob>(`
    SELECT id::text, status, payload, result, error,
           requested_by, requested_by_email, source, correlation_id::text,
           created_at::text, started_at::text, finished_at::text, updated_at::text
    FROM shipcore.fc_planning_stats_refresh_jobs
    WHERE status IN ('queued', 'running')
    ORDER BY created_at DESC
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

export const PlanningStatsRefreshRepository = {
  async listJobs(options: {
    limit: number;
    offset: number;
    status?: PlanningStatsRefreshStatus;
  }): Promise<PlanningStatsRefreshListResult> {
    const params: unknown[] = [];
    const where = options.status ? "WHERE status = $1" : "";
    if (options.status) params.push(options.status);
    const limitIndex = params.length + 1;
    const offsetIndex = params.length + 2;

    const [rowsResult, countResult] = await Promise.all([
      getPrimaryPool().query<PlanningStatsRefreshJob>(`
        SELECT id::text, status, payload, result, error,
               requested_by, requested_by_email, source, correlation_id::text,
               created_at::text, started_at::text, finished_at::text, updated_at::text
        FROM shipcore.fc_planning_stats_refresh_jobs
        ${where}
        ORDER BY created_at DESC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}
      `, [...params, options.limit, options.offset]),
      getPrimaryPool().query<{ total: number }>(`
        SELECT COUNT(*)::int AS total
        FROM shipcore.fc_planning_stats_refresh_jobs
        ${where}
      `, params),
    ]);

    return { jobs: rowsResult.rows, total: countResult.rows[0]?.total ?? 0 };
  },

  async queueJob(
    payload: PlanningStatsRefreshPayload,
    context: PlanningStatsRefreshRequestContext,
  ): Promise<QueuedJob> {
    await expireStaleRunningJobs();
    const active = await findActiveJob();
    if (active) return { job: active, created: false };

    const id = randomUUID();
    try {
      const result = await getPrimaryPool().query<PlanningStatsRefreshJob>(`
        INSERT INTO shipcore.fc_planning_stats_refresh_jobs
          (id, status, payload, requested_by, requested_by_email, source, correlation_id)
        VALUES ($1::uuid, 'queued', $2::jsonb, $3, $4, $5, $6::uuid)
        RETURNING id::text, status, payload, result, error,
                  requested_by, requested_by_email, source, correlation_id::text,
                  created_at::text, started_at::text, finished_at::text, updated_at::text
      `, [
        id,
        JSON.stringify(payload),
        context.requestedBy,
        context.requestedByEmail,
        context.source,
        context.correlationId,
      ]);
      return { job: result.rows[0], created: true };
    } catch (error: unknown) {
      if ((error as { code?: string }).code !== "23505") throw error;
      const racedJob = await findActiveJob();
      if (!racedJob) throw error;
      return { job: racedJob, created: false };
    }
  },

  async getJob(id: string): Promise<PlanningStatsRefreshJob | null> {
    const result = await getPrimaryPool().query<PlanningStatsRefreshJob>(`
      SELECT id::text, status, payload, result, error,
             requested_by, requested_by_email, source, correlation_id::text,
             created_at::text, started_at::text, finished_at::text, updated_at::text
      FROM shipcore.fc_planning_stats_refresh_jobs
      WHERE id = $1::uuid
      LIMIT 1
    `, [id]);
    return result.rows[0] ?? null;
  },

  async markRunning(id: string): Promise<PlanningStatsRefreshJob | null> {
    const result = await getPrimaryPool().query<PlanningStatsRefreshJob>(`
      UPDATE shipcore.fc_planning_stats_refresh_jobs
      SET status = 'running', started_at = COALESCE(started_at, NOW()),
          error = NULL, updated_at = NOW()
      WHERE id = $1::uuid AND status = 'queued'
      RETURNING id::text, status, payload, result, error,
                requested_by, requested_by_email, source, correlation_id::text,
                created_at::text, started_at::text, finished_at::text, updated_at::text
    `, [id]);
    return result.rows[0] ?? null;
  },

  async markSucceeded(id: string, result: PlanningStatsRefreshResult): Promise<void> {
    await getPrimaryPool().query(`
      UPDATE shipcore.fc_planning_stats_refresh_jobs
      SET status = 'succeeded', result = $2::jsonb, error = NULL,
          finished_at = NOW(), updated_at = NOW()
      WHERE id = $1::uuid
    `, [id, JSON.stringify(result)]);
  },

  /** `partialResult` keeps what did finish (the Workbench push) next to the error. */
  async markFailed(
    id: string,
    error: string,
    partialResult?: Pick<PlanningStatsRefreshResult, "workbench">,
  ): Promise<void> {
    await getPrimaryPool().query(`
      UPDATE shipcore.fc_planning_stats_refresh_jobs
      SET status = 'failed', error = $2, result = COALESCE($3::jsonb, result),
          finished_at = NOW(), updated_at = NOW()
      WHERE id = $1::uuid
    `, [id, error, partialResult ? JSON.stringify(partialResult) : null]);
  },
};
