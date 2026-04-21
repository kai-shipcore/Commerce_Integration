/**
 * Code Guide:
 * This API route owns the integrations / [id] backend workflow.
 * It validates request data, reads or writes database records, and returns JSON to the UI.
 * Cache invalidation and service calls usually happen here because this layer coordinates side effects.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  deletePlatformIntegration,
  getPlatformIntegrationById,
  updatePlatformIntegration,
} from "@/lib/db/platform-integrations";
import { getIntegrationAdapter } from "@/lib/integrations/core/registry";
import type { UpdatePlatformIntegrationInput } from "@/lib/db/platform-integrations";
import { z } from "zod";

// Schema for updating an integration
const UpdateIntegrationSchema = z.object({
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

// GET /api/integrations/[id] - Get a single integration
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

    const config = integration.config as Record<string, any>;
    const adapter = getIntegrationAdapter(integration.platform);
    const maskedConfig = adapter.maskConfig(config);

    return NextResponse.json({
      success: true,
      data: {
        ...integration,
        config: maskedConfig,
      },
    });
  } catch (error: any) {
    console.error("Error fetching integration:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// PATCH /api/integrations/[id] - Update an integration
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const data = UpdateIntegrationSchema.parse(body);

    const existing = await getPlatformIntegrationById(id);

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Integration not found" },
        { status: 404 }
      );
    }

    const adapter = getIntegrationAdapter(existing.platform);

    const updateData: UpdatePlatformIntegrationInput = {};
    if (data.name) updateData.name = data.name;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.config) {
      const existingConfig = existing.config as Record<string, any>;
      const nextConfig = adapter.applyDefaults({
        ...existingConfig,
        ...data.config,
      });

      adapter.validateConfig(nextConfig);

      if (existing.platform === "shopify") {
        const testResult = await adapter.checkConnection(nextConfig);

        if (!testResult.success) {
          return NextResponse.json(
            {
              success: false,
              error: `Failed to connect to Shopify: ${testResult.message}`,
            },
            { status: 400 }
          );
        }
      }

      updateData.config = nextConfig;
    }

    const integration = await updatePlatformIntegration(id, updateData);

    return NextResponse.json({
      success: true,
      data: integration,
      message: "Integration updated successfully",
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.issues[0].message },
        { status: 400 }
      );
    }

    console.error("Error updating integration:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// DELETE /api/integrations/[id] - Delete an integration
export async function DELETE(
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

    await deletePlatformIntegration(id);

    return NextResponse.json({
      success: true,
      message: "Integration deleted successfully",
    });
  } catch (error: any) {
    console.error("Error deleting integration:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
