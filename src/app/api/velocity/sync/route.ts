/**
 * Code Guide:
 * GET  /api/velocity/sync — Returns the most recent synced_at timestamp from velocity_snapshot.
 * POST /api/velocity/sync — Triggers a full re-sync of velocity_snapshot from Supabase.
 *                           Deletes rows older than 400 days, then upserts daily rows.
 *                           Sync logic is pending implementation.
 */

import { NextResponse } from "next/server";
import { getPrimaryPool } from "@/lib/db/primary-db";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET() {
  try {
    const pool = getPrimaryPool();
    const result = await pool.query<{ last_synced_at: Date | null }>(
      "SELECT MAX(synced_at) AS last_synced_at FROM shipcore.velocity_snapshot"
    );
    const lastSyncedAt = result.rows[0]?.last_synced_at ?? null;
    return NextResponse.json({ success: true, lastSyncedAt });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST() {
  // TODO: implement sync logic
  // 1. Query Supabase views for link/custom sales, TTM, preorder data
  // 2. Derive item_category from link_master_sku prefix
  // 3. Delete rows older than 400 days from velocity_snapshot
  // 4. Upsert daily rows by unique key
  return NextResponse.json({
    success: true,
    message: "Sync logic not yet implemented",
  });
}
