import { NextResponse } from "next/server";
import { syncInventorySnapshotCrossDb } from "@/lib/db/primary-db";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function POST() {
  try {
    const result = await syncInventorySnapshotCrossDb();
    return NextResponse.json({
      success: true,
      message: `Sync completed — ${result.rowsSynced} rows synced`,
    });
  } catch (error: unknown) {
    console.error("Inventory sync failed:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
