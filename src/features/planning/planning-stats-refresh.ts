import { apiPath } from "@/lib/api-path";
import type { OosLostDemandWeights } from "@/lib/planning/oos-lost-demand-weights";
import type { SalesWindowWeights } from "@/lib/planning/sales-window-weights";

type RefreshPayload = {
  salesWindowWeights?: SalesWindowWeights;
  oosLostDemandWeights?: OosLostDemandWeights;
};

type RefreshJobStatus = "queued" | "running" | "succeeded" | "failed";

type RefreshJob = {
  jobId: string;
  status: RefreshJobStatus;
  error?: string | null;
};

const POLL_INTERVAL_MS = 1_500;
const MAX_WAIT_MS = 15 * 60_000;

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function errorFrom(json: Record<string, unknown>, fallback: string): Error {
  return new Error(typeof json.error === "string" ? json.error : fallback);
}

export async function startPlanningStatsRefresh(payload: RefreshPayload): Promise<RefreshJob> {
  const response = await fetch(apiPath("/api/planning/stats/refresh"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await readJson(response);
  if (!response.ok || json.success !== true) {
    throw errorFrom(json, `Stats refresh could not be queued: HTTP ${response.status}`);
  }

  const data = json.data as Partial<RefreshJob> | undefined;
  if (!data?.jobId) throw new Error("Stats refresh did not return a job ID");
  return { jobId: data.jobId, status: data.status ?? "queued" };
}

export async function waitForPlanningStatsRefresh(
  jobId: string,
  options: { isCancelled?: () => boolean } = {},
): Promise<RefreshJob> {
  const startedAt = Date.now();

  while (!options.isCancelled?.()) {
    const response = await fetch(apiPath(`/api/planning/stats/refresh/${encodeURIComponent(jobId)}`), {
      cache: "no-store",
    });
    const json = await readJson(response);
    if (!response.ok || json.success !== true) {
      throw errorFrom(json, `Stats refresh status failed: HTTP ${response.status}`);
    }

    const data = json.data as Partial<RefreshJob> | undefined;
    const status = data?.status;
    if (status === "succeeded") return { jobId, status };
    if (status === "failed") throw new Error(data?.error || "Stats refresh failed");
    if (Date.now() - startedAt >= MAX_WAIT_MS) {
      throw new Error("Stats refresh is still running after 15 minutes");
    }

    await new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new DOMException("Stats refresh polling cancelled", "AbortError");
}

export async function runPlanningStatsRefresh(
  payload: RefreshPayload,
  options: { isCancelled?: () => boolean } = {},
): Promise<void> {
  const job = await startPlanningStatsRefresh(payload);
  if (job.status === "succeeded") return;
  await waitForPlanningStatsRefresh(job.jobId, options);
}
