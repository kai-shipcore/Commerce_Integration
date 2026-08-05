/**
 * Code Guide:
 * GET /api/planning/sku/[sku]/history — Proxies FastAPI /planning/sku/{id}/history.
 *
 * Weekly actual demand for any SKU, whether or not the model forecasts it.
 * Separate from the sibling route because that one answers a planning question
 * and correctly 404s for an intermittent SKU: without a forecast there is no
 * order quantity, coverage demand or reliability. Sales history exists either
 * way, and is the only thing the detail page can honestly show for those SKUs.
 */

import { type NextRequest } from "next/server";
import { proxyPlanning } from "@/lib/planning-api";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sku: string }> },
) {
  const { sku } = await params;
  return proxyPlanning(
    `/planning/sku/${encodeURIComponent(sku)}/history`,
    req.nextUrl.searchParams.toString(),
  );
}
