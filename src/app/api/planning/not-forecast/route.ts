/**
 * Code Guide:
 * GET /api/planning/not-forecast — Proxies the FastAPI /planning/not-forecast endpoint.
 *
 * The intermittent tail: SKUs segmentation excludes from forecasting, which is
 * most of the catalogue by count and about a fifth of recent unit volume.
 * Nothing in the response is forecast-derived and there is no recommended order
 * quantity, by design.
 *
 * A longer timeout than the action list, because this covers roughly seven times
 * as many SKUs.
 */

import { type NextRequest } from "next/server";
import { proxyPlanning } from "@/lib/planning-api";

export async function GET(req: NextRequest) {
  return proxyPlanning(
    "/planning/not-forecast",
    req.nextUrl.searchParams.toString(),
    40_000,
  );
}
