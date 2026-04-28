import { NextResponse } from "next/server";
import { syncProductsAndSkuMappings } from "@/lib/db/primary-db";

export const maxDuration = 300;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function POST() {
  try {
    const result = await syncProductsAndSkuMappings();
    return NextResponse.json({
      success: true,
      message: `Sync completed — products: +${result.productsUpserted} / -${result.productsDeleted}, mappings: +${result.mappingsUpserted} / -${result.mappingsDeleted}`,
    });
  } catch (error: unknown) {
    console.error("Products sync failed:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
