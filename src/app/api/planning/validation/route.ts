/**
 * Code Guide:
 * Proxies the forecast validation payload from the Python planning API.
 *
 * The comparison reads a stored accuracy report rather than scoring on demand,
 * so it is quick, but the demand-pattern companion route scans full sales
 * history. Both share the default proxy timeout.
 */

import { proxyPlanning } from "@/lib/planning-api";

export async function GET() {
  // Longer than the default: the comparison is cheap, but scoring stored runs
  // against actuals loads full sales history on a cold server.
  return proxyPlanning("/planning/validation", "", 60_000);
}
