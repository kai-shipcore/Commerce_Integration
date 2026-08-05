/**
 * Code Guide:
 * POST /api/planning/run-forecast — refresh the data and produce a new ML
 * forecast, on demand.
 *
 * Deliberately not the same upstream as /api/forecast/run. That one runs the
 * legacy statsforecast pipeline: it cross-validates a model menu per SKU and
 * writes shipcore.fc_forward_forecasts, which SKU Planning reads and the two
 * ML screens do not. Using it here would spend most of its runtime on work
 * neither the Action List nor Forecast Validation can see, and would move the
 * SKU profiles underneath an unchanged ML forecast.
 *
 * Returns a job_id. Polling and cancellation go through the existing
 * /api/forecast/status/[jobId] and /api/forecast/cancel/[jobId] routes, which
 * proxy generic job endpoints that read the jobs table by id and know nothing
 * about which pipeline produced the job. So this adds an endpoint rather than a
 * mechanism, the same way prepare-data did.
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
