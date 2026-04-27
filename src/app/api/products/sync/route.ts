import { NextResponse } from "next/server";
import { syncProductsFromShopifyDb } from "@/lib/db/supabase-lookup";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function POST() {
  try {
    const result = await syncProductsFromShopifyDb();
    return NextResponse.json({
      success: true,
      message: `Sync completed — ${result.rowsSynced} rows synced`,
    });
  } catch (error: unknown) {
    console.error("Products sync failed:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
