/**
 * Code Guide:
 * GET /api/planning/action-list — Proxies the FastAPI /planning/action-list endpoint.
 *
 * One row per forecastable SKU: recommended order quantity and its inputs, the
 * priority, the stockout projection, the reliability tier and the data-quality
 * flags. Also returns the summary metrics and a meta block recording what the
 * forecast was trained through and how many SKUs were dropped as intermittent
 * since it ran.
 *
 * Planning parameters (lead time, review period, service level, stockout
 * horizon) are forwarded untouched. They are the user's to choose and the
 * recommendation moves with them, so this route validates nothing: FastAPI
 * bounds them, and duplicating those bounds here would give two places to
 * disagree about what is allowed.
 */

import { type NextRequest } from "next/server";
import { proxyPlanning } from "@/lib/planning-api";

export async function GET(req: NextRequest) {
  return proxyPlanning("/planning/action-list", req.nextUrl.searchParams.toString());
}
