import { NextResponse } from "next/server";
import { ProductsSyncService } from "@/lib/products-sync/service";

export const maxDuration = 300;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function POST() {
  try {
    const result = await ProductsSyncService.sync();
    return NextResponse.json({
      success: true,
      message: `Sync completed — +${result.productsUpserted} / -${result.productsDeleted} products`,
    });
  } catch (error: unknown) {
    console.error("Products sync failed:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
