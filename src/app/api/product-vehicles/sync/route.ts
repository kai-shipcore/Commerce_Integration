import { NextResponse } from "next/server";
import { syncProductVehicles } from "@/lib/db/primary-db";

export const maxDuration = 300;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function POST() {
  try {
    const result = await syncProductVehicles();
    return NextResponse.json({
      success: true,
      message: `Product vehicle sync completed — +${result.upserted.toLocaleString()} / -${result.deleted.toLocaleString()} vehicles`,
    });
  } catch (error: unknown) {
    console.error("Product vehicle sync failed:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
