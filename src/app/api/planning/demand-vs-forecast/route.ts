/**
 * Code Guide:
 * Proxies the demand-versus-forecast series from the Python planning API.
 *
 * `window` selects one backtest window or all of them, matching the values in
 * the comparison grid.
 */

import { proxyPlanning } from "@/lib/planning-api";

export async function GET(request: Request) {
  const window = new URL(request.url).searchParams.get("window");
  return proxyPlanning(
    "/planning/demand-vs-forecast",
    window ? `window=${encodeURIComponent(window)}` : "",
    60_000,
  );
}
