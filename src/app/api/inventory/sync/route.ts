import { NextResponse } from "next/server";
import { syncInventorySnapshotFromSqlFile } from "@/lib/db/supabase-lookup";
import path from "node:path";

const INVENTORY_SYNC_SQL_FILE_PATH = path.join(
  process.cwd(),
  "src",
  "sql",
  "Data_sync_sc_inventory_snapshot.sql"
);

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function POST() {
  try {
    const result = await syncInventorySnapshotFromSqlFile(
      INVENTORY_SYNC_SQL_FILE_PATH
    );

    return NextResponse.json({
      success: true,
      message: "Sync completed",
      filePath: result.filePath,
    });
  } catch (error: unknown) {
    console.error("Inventory sync failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}
