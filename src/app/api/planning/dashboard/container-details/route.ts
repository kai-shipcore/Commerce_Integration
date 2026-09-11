import { NextResponse } from "next/server";
import { guardPermission } from "@/lib/permissions";
import { DemandPlanningService } from "@/lib/demand-planning/service";
import type { DashboardCategoryCode } from "@/lib/demand-planning/repository";

const VALID_CATEGORY_CODES = new Set<DashboardCategoryCode>(["SC", "CC", "FM", "AC", "SWC"]);

export async function GET(req: Request) {
  const denied = await guardPermission("demand-planning", "read");
  if (denied) return denied;
  try {
    const { searchParams } = new URL(req.url);
    const categoryParam = (searchParams.get("product") ?? searchParams.get("category") ?? "").toUpperCase();
    const categoryCodes = [...new Set(categoryParam.split(",").map(token => token.trim()))]
      .filter((token): token is DashboardCategoryCode => VALID_CATEGORY_CODES.has(token as DashboardCategoryCode));
    const { data, cacheStatus } = await DemandPlanningService.getContainerDetails({
      mode: searchParams.get("mode") === "custom" ? "custom" : "link",
      includeDrafts: searchParams.get("includeDrafts") === "1",
      categoryCodes: categoryCodes.length ? categoryCodes : null,
      asOf: searchParams.get("asOf"),
      salesWeightsParam: searchParams.get("salesWeights"),
    });
    return NextResponse.json({ success: true, data }, {
      headers: { "x-planning-dashboard-cache": cacheStatus },
    });
  } catch (error) {
    console.error("Planning container details GET failed:", error);
    return NextResponse.json({
      success: false, error: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
