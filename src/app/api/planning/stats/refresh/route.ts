// Code Guide: POST /api/planning/stats/refresh — "Sync" button target.
// Controller layer only: parses optional weight overrides and delegates the
// whole inventory/OOS/velocity pipeline to DemandPlanningService.refreshStats.
// See that service for the step-by-step breakdown (inventory sync, OOS
// episode tracking, OOS lost-demand estimate, sales velocity recompute,
// SWC product sync) — steps intentionally are not wrapped in a DB
// transaction, matching the original route (each step is independently
// idempotent/re-runnable).

import { NextResponse } from "next/server";
import { guardPermission } from "@/lib/permissions";
import { DemandPlanningService } from "@/lib/demand-planning/service";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function POST(request: Request) {
  const denied = await guardPermission("demand-planning", "edit");
  if (denied) return denied;

  try {
    const requestBody = await request.json().catch(() => null) as { salesWindowWeights?: unknown; oosLostDemandWeights?: unknown } | null;

    const result = await DemandPlanningService.refreshStats(requestBody ?? {});
    if (result === null) {
      return NextResponse.json(
        { success: false, error: "No database connection available" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      inventory_upserted: result.inventoryUpserted,
      link_sales_upserted: result.linkSalesUpserted,
      custom_sales_upserted: result.customSalesUpserted,
    });
  } catch (error) {
    console.error("Planning stats refresh POST failed:", error);
    return NextResponse.json(
      { success: false, error: errorMessage(error) },
      { status: 500 },
    );
  }
}
