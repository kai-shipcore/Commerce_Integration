/**
 * Code Guide:
 * Proxies portfolio demand patterns from the Python planning API.
 *
 * `weeks` controls the lookback for the weekly series. It is forwarded rather
 * than defaulted here so the bound stays defined in one place, on the FastAPI
 * side, where it is validated.
 */

import { proxyPlanning } from "@/lib/planning-api";

export async function GET(request: Request) {
  const weeks = new URL(request.url).searchParams.get("weeks");
  return proxyPlanning(
    "/planning/demand-patterns",
    weeks ? `weeks=${encodeURIComponent(weeks)}` : "",
    60_000,
  );
}
