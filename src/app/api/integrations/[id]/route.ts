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
import type { UpdatePlatformIntegrationInput } from "@/lib/db/platform-integrations";
import { z } from "zod";

const MASKED_SECRET = "********";

// Schema for updating an integration
const UpdateIntegrationSchema = z.object({
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  config: z
    .object({
      shopDomain: z.string().optional(),
      accessToken: z.string().optional(),
      apiVersion: z.string().optional(),
      sellerId: z.string().optional(),
      marketplaceId: z.string().optional(),
      accessKeyId: z.string().optional(),
      secretAccessKey: z.string().optional(),
      region: z.string().optional(),
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      refreshToken: z.string().optional(),
      consumerId: z.string().optional(),
      privateKey: z.string().optional(),
      channelType: z.string().optional(),
      environment: z.enum(["sandbox", "production"]).optional(),
    })
    .optional(),
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
    const maskedConfig = {
      ...config,
      accessToken: config.accessToken ? MASKED_SECRET : undefined,
      secretAccessKey: config.secretAccessKey ? MASKED_SECRET : undefined,
      clientSecret: config.clientSecret ? MASKED_SECRET : undefined,
      refreshToken: config.refreshToken ? MASKED_SECRET : undefined,
      privateKey: config.privateKey ? MASKED_SECRET : undefined,
    };

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

    if (data.config && existing.platform === "shopify") {
      const existingConfig = existing.config as Record<string, any>;
      const newConfig = {
        ...existingConfig,
        ...data.config,
      };

      if (newConfig.shopDomain && newConfig.accessToken) {
        const { ShopifyClient } = await import("@/lib/integrations/shopify");
        const client = new ShopifyClient({
          shopDomain: newConfig.shopDomain,
          accessToken: newConfig.accessToken,
          apiVersion: newConfig.apiVersion || "2024-01",
        });

        const testResult = await client.testConnection();
        if (!testResult.success) {
          return NextResponse.json(
            {
              success: false,
              error: `Failed to connect to Shopify: ${testResult.error}`,
            },
            { status: 400 }
          );
        }
      }
    }

    if (data.config && existing.platform === "amazon") {
      const existingConfig = existing.config as Record<string, any>;
      const newConfig = {
        ...existingConfig,
        ...data.config,
      };

      if (
        !newConfig.sellerId ||
        !newConfig.marketplaceId ||
        !newConfig.accessKeyId ||
        !newConfig.secretAccessKey
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Amazon integration requires sellerId, marketplaceId, accessKeyId, and secretAccessKey",
          },
          { status: 400 }
        );
      }
    }

    if (data.config && existing.platform === "ebay") {
      const existingConfig = existing.config as Record<string, any>;
      const newConfig = {
        ...existingConfig,
        ...data.config,
      };

      if (
        !newConfig.clientId ||
        !newConfig.clientSecret ||
        !newConfig.refreshToken
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "eBay integration requires clientId, clientSecret, and refreshToken",
          },
          { status: 400 }
        );
      }
    }

    if (data.config && existing.platform === "walmart") {
      const existingConfig = existing.config as Record<string, any>;
      const newConfig = {
        ...existingConfig,
        ...data.config,
      };

      if (
        !newConfig.consumerId ||
        !newConfig.privateKey ||
        !newConfig.channelType
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Walmart integration requires consumerId, privateKey, and channelType",
          },
          { status: 400 }
        );
      }
    }

    const updateData: UpdatePlatformIntegrationInput = {};
    if (data.name) updateData.name = data.name;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.config) {
      const existingConfig = existing.config as Record<string, any>;
      updateData.config = {
        ...existingConfig,
        ...data.config,
      };
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
