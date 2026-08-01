// Code Guide: GET /api/forecast/bounds — earliest order date on file, used to
// bound the SKU Planning date picker. Preserves the original route's
// contract exactly: no success/error envelope, and any failure degrades to
// { minDate: null } with a 200 rather than a 500.

import { NextResponse } from "next/server";
import { guardPermission } from "@/lib/permissions";
import { SkuForecastsService } from "@/lib/sku-forecasts/service";

export async function GET() {
  const denied = await guardPermission("sku-forecasts", "read");
  if (denied) return denied;

  try {
    const minDate = await SkuForecastsService.getForecastBounds();
    return NextResponse.json({ minDate });
  } catch {
    return NextResponse.json({ minDate: null });
  }
}
