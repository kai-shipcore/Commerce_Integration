/**
 * Code Guide:
 * This API route owns the integrations / [id] / sync backend workflow.
 * It validates request data, reads or writes database records, and returns JSON to the UI.
 * Cache invalidation and service calls usually happen here because this layer coordinates side effects.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminLikeRole } from "@/components/layout/navigation-config";
import {
  getPlatformIntegrationById,
} from "@/lib/db/platform-integrations";
import { runIntegrationSync } from "@/lib/integrations/core/sync-runner";

// POST /api/integrations/[id]/sync - Trigger a sync for an integration
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    if (!isAdminLikeRole(session.user.role)) {
      return NextResponse.json(
        { success: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const fullSync = body.fullSync || false;
    const useInngest = body.useInngest || false;

    // Verify integration exists and is active
    const integration = await getPlatformIntegrationById(id);

    if (!integration) {
      return NextResponse.json(
        { success: false, error: "Integration not found" },
        { status: 404 }
      );
    }

    if (!integration.isActive) {
      return NextResponse.json(
        { success: false, error: "Integration is not active" },
        { status: 400 }
      );
    }

    // Option to use Inngest for background processing
    if (useInngest) {
      const { inngest } = await import("@/lib/inngest/client");
      await inngest.send({
        name: "app/sync.trigger",
        data: {
          integrationId: id,
          fullSync,
        },
      });

      return NextResponse.json({
        success: true,
        message: `Sync queued for ${integration.name}`,
        data: {
          integrationId: id,
          platform: integration.platform,
          name: integration.name,
          fullSync,
          async: true,
        },
      });
    }

    // Direct sync (synchronous)
    console.log(`[sync route] Starting sync for ${integration.platform} / ${integration.name}`);
    const result = await runIntegrationSync(id, { fullSync });
    console.log(`[sync route] Sync result:`, JSON.stringify(result));

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
  } catch (error: any) {
    console.error("[sync route] UNHANDLED ERROR:", error?.message, error?.stack);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// GET /api/integrations/[id]/sync - Get sync status
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const integration = await getPlatformIntegrationById(id);

    if (!integration) {
      return NextResponse.json(
        { success: false, error: "Integration not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        integrationId: id,
        platform: integration.platform,
        name: integration.name,
        isActive: integration.isActive,
        sync: {
          lastSyncAt: integration.lastSyncAt,
          status: integration.lastSyncStatus,
          error: integration.lastSyncError,
          totalOrders: integration.totalOrdersSynced,
          totalRecords: integration.totalRecordsSynced,
          cursor: integration.syncCursor,
        },
      },
    });
  } catch (error: any) {
    console.error("Error getting sync status:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
