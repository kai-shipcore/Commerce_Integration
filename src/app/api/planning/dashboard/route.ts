// Code Guide: Returns DemandPlanningData for the /planning/dashboard page
// (and, via ?view is not used here, the container-timeline page's
// ?mode=link&includeContainers=1 "link view"). Controller layer only:
// parses query params, delegates the read pipeline + chain-projection math
// to DemandPlanningService, and sets the cache-status response header.
//
// Phase 1 data sources:
//   fc_containers          — container headers (primary DB)
//   fc_container_items     — per-SKU inbound qty per container (primary DB)
//   fc_stats               — pre-calculated sales/inventory stats (primary DB, LEFT JOIN)
//                            Empty table is fine — all stats columns default to 0.
//   coverland_inventory    — backorder qty (Supabase lookup, best-effort)
// Run prisma/sql/fc_stats.sql once before using this route.

import { NextResponse } from "next/server";
import { guardPermission } from "@/lib/permissions";
import { DemandPlanningService } from "@/lib/demand-planning/service";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error";
}

export async function GET(req: Request) {
  const denied = await guardPermission("demand-planning", "read");
  if (denied) return denied;

  try {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get("mode") === "custom" ? "custom" as const : "link" as const;
    const includeContainers = searchParams.get("includeContainers") === "1";
    const rawContainers = includeContainers && searchParams.get("rawContainers") === "1";
    const includeDrafts = searchParams.get("includeDrafts") === "1";
    const categoryParam = (searchParams.get("product") ?? searchParams.get("category") ?? "").toUpperCase();
    const categoryCode = categoryParam === "SC" || categoryParam === "CC" || categoryParam === "FM" || categoryParam === "AC"
      ? categoryParam
      : null;

    const { data, cacheStatus } = await DemandPlanningService.getDashboardData({
      mode,
      includeContainers,
      rawContainers,
      includeDrafts,
      categoryCode,
      asOf: searchParams.get("asOf"),
      salesWeightsParam: searchParams.get("salesWeights"),
    });

    return NextResponse.json({ success: true, data }, {
      headers: { "x-planning-dashboard-cache": cacheStatus },
    });
  } catch (error) {
    console.error("Planning dashboard GET failed:", error);
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 },
    );
  }
}
