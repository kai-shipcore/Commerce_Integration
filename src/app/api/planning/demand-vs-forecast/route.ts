/**
 * Code Guide:
 * Proxies the demand-versus-forecast series from the Python planning API.
 *
 * No parameters: every series carries its segment and lead, and the chart
 * filters client-side, so switching either does not re-request.
 */

import { proxyPlanning } from "@/lib/planning-api";

export async function GET() {
  return proxyPlanning("/planning/demand-vs-forecast", "", 60_000);
}
