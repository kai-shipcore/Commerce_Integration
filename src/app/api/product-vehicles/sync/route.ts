// Code Guide: POST /api/product-vehicles/sync — pulls size_chart.product_vehicle
// from the Supabase lookup DB and upserts/deletes shipcore.sc_product_vehicle
// to match. Delegates to VehiclesService.sync().

import { NextResponse } from "next/server";
import { guardPermission } from "@/lib/permissions";
import { VehiclesService } from "@/lib/vehicles/service";

export const maxDuration = 300;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function POST() {
  const denied = await guardPermission("production-vehicles", "edit");
  if (denied) return denied;

  try {
    const result = await VehiclesService.sync();
    return NextResponse.json({
      success: true,
      message: `Product vehicle sync completed — +${result.upserted.toLocaleString()} / -${result.deleted.toLocaleString()} vehicles`,
    });
  } catch (error: unknown) {
    console.error("Product vehicle sync failed:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 },
    );
  }
}
