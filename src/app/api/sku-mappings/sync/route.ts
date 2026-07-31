import { NextResponse } from "next/server";
import { SkuMappingsSyncService } from "@/lib/sku-mappings-sync/service";

export const maxDuration = 300;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function POST() {
  try {
    const result = await SkuMappingsSyncService.sync();
    return NextResponse.json({
      success: true,
      message: `Mapping sync completed — +${result.mappingsUpserted.toLocaleString()} / -${result.mappingsDeleted.toLocaleString()} mappings`,
    });
  } catch (error: unknown) {
    console.error("SKU mapping sync failed:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
