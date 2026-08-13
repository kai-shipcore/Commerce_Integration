/**
 * Code Guide:
 * POST /api/planning/run-forecast — refresh the data and produce a new ML
 * forecast, on demand.
 *
 * There used to be a second, similar route at /api/forecast/run, which ran the
 * legacy statsforecast pipeline: it cross-validated a model menu per SKU and
 * wrote shipcore.fc_forward_forecasts, which no screen reads any more. It was
 * deleted in August 2026 with the pages it served. This is now the only
 * on-demand forecast trigger, and it runs the ML pipeline.
 *
 * Returns a job_id. Polling goes through /api/forecast/status/[jobId], which
 * proxies a generic job endpoint that reads the jobs table by id and knows
 * nothing about which pipeline produced the job. That route survived the
 * deletion for exactly that reason: it is job machinery, not statsforecast.
 *
 * The horizon is forwarded rather than defaulted here. The floor lives upstream
 * (ge=13 in the endpoint signature) because the reason for it is upstream: each
 * run replaces the stored forecast for its training week, so a shorter run
 * clobbers a full snapshot. A second floor here would be a copy free to drift
 * from the one that matters.
 *
 * The timeout covers the upstream spawning a background thread and returning a
 * job_id, not the run itself, which is minutes.
 */

import { proxyPlanning } from "@/lib/planning-api";

export async function POST(request: Request) {
  const horizon = new URL(request.url).searchParams.get("horizon");
  return proxyPlanning(
    "/planning/run-forecast",
    horizon ? `horizon=${encodeURIComponent(horizon)}` : "",
    30_000,
    "POST",
  );
}
