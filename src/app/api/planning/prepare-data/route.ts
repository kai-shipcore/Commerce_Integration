/**
 * Code Guide:
 * POST /api/planning/prepare-data — asks the forecast service to build its data
 * files from the database.
 *
 * For the state the no_data card describes: the service is up and has nothing
 * to read. On a machine with credentials that is repairable without anyone
 * opening a terminal, which is what this is for.
 *
 * Deliberately not the same upstream as /api/forecast/run. That one runs the
 * legacy statsforecast pipeline, which writes to shipcore.fc_forward_forecasts
 * and leaves the ML artifacts alone; using it here would regenerate the SKU
 * profiles and move segmentation underneath an unchanged ML forecast.
 *
 * Returns a job_id. The client polls /api/forecast/status, which is the same
 * machinery the Run Forecast panel already uses, so this adds an endpoint
 * rather than a mechanism.
 *
 * The long timeout is for the upstream's own readiness check before it spawns
 * anything, not for the work: the job itself is minutes and runs in the
 * background.
 */

import { proxyPlanning } from "@/lib/planning-api";

export async function POST() {
  return proxyPlanning("/planning/prepare-data", "", 30_000, "POST");
}
