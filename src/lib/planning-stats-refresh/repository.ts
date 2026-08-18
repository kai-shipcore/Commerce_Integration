import { randomUUID } from "node:crypto";
import { getPrimaryPool } from "@/lib/db/primary-db";

export type PlanningStatsRefreshStatus = "queued" | "running" | "succeeded" | "failed";

export type PlanningStatsRefreshPayload = {
  salesWindowWeights?: unknown;
  oosLostDemandWeights?: unknown;
};

export type PlanningStatsRefreshResult = {
  inventoryUpserted: number;
  linkSalesUpserted: number;
  customSalesUpserted: number;
  productsBackfilled: number;
};

export type PlanningStatsRefreshJob = {
  id: string;
  status: PlanningStatsRefreshStatus;
  payload: PlanningStatsRefreshPayload;
  result: PlanningStatsRefreshResult | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
};

type QueuedJob = { job: PlanningStatsRefreshJob; created: boolean };

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
           created_at::text, started_at::text, finished_at::text, updated_at::text
    FROM shipcore.fc_planning_stats_refresh_jobs
    WHERE status IN ('queued', 'running')
    ORDER BY created_at DESC
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

export const PlanningStatsRefreshRepository = {
  async queueJob(payload: PlanningStatsRefreshPayload): Promise<QueuedJob> {
    await expireStaleRunningJobs();
    const active = await findActiveJob();
    if (active) return { job: active, created: false };

    const id = randomUUID();
    try {
      const result = await getPrimaryPool().query<PlanningStatsRefreshJob>(`
        INSERT INTO shipcore.fc_planning_stats_refresh_jobs (id, status, payload)
        VALUES ($1::uuid, 'queued', $2::jsonb)
        RETURNING id::text, status, payload, result, error,
                  created_at::text, started_at::text, finished_at::text, updated_at::text
      `, [id, JSON.stringify(payload)]);
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

  async markFailed(id: string, error: string): Promise<void> {
    await getPrimaryPool().query(`
      UPDATE shipcore.fc_planning_stats_refresh_jobs
      SET status = 'failed', error = $2, finished_at = NOW(), updated_at = NOW()
      WHERE id = $1::uuid
    `, [id, error]);
  },
};
