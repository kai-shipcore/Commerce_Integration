/**
 * Code Guide:
 * POST /api/integrations/[id]/sync — Trigger a sync for an integration, either
 *                                    directly (synchronous) or queued via Inngest.
 * GET  /api/integrations/[id]/sync — Get the last sync status for an integration.
 * Note: on POST, the response's top-level `success` mirrors the sync result's
 * own success flag (it can be `false` on a 200 response when the adapter sync
 * partially/fully fails) — not the standard apiSuccess envelope — matching the
 * original route's contract exactly.
 * Controller layer only: parses the request and delegates to IntegrationsService,
 * which owns the adapter dispatch and DB status/counter updates.
 */

import { NextRequest, NextResponse } from "next/server";
import { guardPermission } from "@/lib/permissions";
import { IntegrationsService } from "@/lib/integrations/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await guardPermission("integrations", "edit");
    if (denied) return denied;

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const fullSync = body.fullSync || false;
    const useInngest = body.useInngest || false;

    const result = await IntegrationsService.runSync(id, { fullSync, useInngest });

    if (result.queued) {
      return NextResponse.json({
        success: true,
        message: `Sync queued for ${result.name}`,
        data: {
          integrationId: result.integrationId,
          platform: result.platform,
          name: result.name,
          fullSync: result.fullSync,
          async: true,
        },
      });
    }

    return NextResponse.json({
      success: result.success,
      message: result.success
        ? `Synced ${result.ordersProcessed} orders, created ${result.salesRecordsCreated} records`
        : `Sync failed: ${result.errors[0]}`,
      data: {
        integrationId: id,
        platform: result.platform,
        name: result.name,
        ordersProcessed: result.ordersProcessed,
        salesRecordsCreated: result.salesRecordsCreated,
        skusCreated: result.skusCreated,
        errors: result.errors,
      },
    });
  } catch (error) {
    console.error("[integrations/sync] UNHANDLED ERROR:", error);
    return handleApiError(error);
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await IntegrationsService.getSyncStatus(id);
    return apiSuccess({ data });
  } catch (error) {
    console.error("Error getting sync status:", error);
    return handleApiError(error);
  }
}
