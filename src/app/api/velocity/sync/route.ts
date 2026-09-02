/**
 * Code Guide:
 * GET  /api/velocity/sync — Returns the most recent synced_at timestamp from fc_velocity_link_snapshot.
 * POST /api/velocity/sync — Pulls data from two Supabase views independently.
 *                           Stores the UTC order date (order_date) per row — the only date basis
 *                           the app aggregates on; there is no timezone option.
 *                           Batch-upserts into fc_velocity_link_snapshot and fc_velocity_custom_snapshot
 *                           (500 rows per batch each).
 * Controller layer only: parses the request and delegates to VelocityService, which owns the
 * advisory-lock retry/reclaim policy and the batch upsert/cleanup sequence.
 */

import { NextResponse, type NextRequest } from "next/server";
import { VelocityService, SyncInProgressError } from "@/lib/velocity/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

export async function GET() {
  try {
    const lastSyncedAt = await VelocityService.getLastSyncedAt();
    return apiSuccess({ lastSyncedAt });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  const full = req.nextUrl.searchParams.get("full") === "true";
  try {
    const result = await VelocityService.runSync(full);
    return apiSuccess(result);
  } catch (error) {
    if (error instanceof SyncInProgressError) {
      return NextResponse.json(
        { success: false, error: error.message, holdSeconds: error.holdSeconds },
        { status: 409 }
      );
    }
    console.error("[velocity/sync] POST error:", error);
    return handleApiError(error);
  }
}
