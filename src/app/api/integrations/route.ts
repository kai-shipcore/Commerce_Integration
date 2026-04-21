/**
 * Code Guide:
 * This API route owns the integrations backend workflow.
 * It validates request data, reads or writes database records, and returns JSON to the UI.
 * Cache invalidation and service calls usually happen here because this layer coordinates side effects.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  createPlatformIntegration,
  listPlatformIntegrations,
} from "@/lib/db/platform-integrations";
import { z } from "zod";

// Schema for creating a new integration
const CreateIntegrationSchema = z.object({
  platform: z.enum(["shopify", "walmart", "ebay", "amazon"]),
  name: z.string().min(1, "Name is required"),
  config: z.object({
    // Shopify config
    shopDomain: z.string().optional(),
    accessToken: z.string().optional(),
    apiVersion: z.string().optional(),
    // Amazon config
    sellerId: z.string().optional(),
    marketplaceId: z.string().optional(),
    accessKeyId: z.string().optional(),
    secretAccessKey: z.string().optional(),
    region: z.string().optional(),
    // eBay config
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    refreshToken: z.string().optional(),
    environment: z.enum(["sandbox", "production"]).optional(),
    // Walmart config
    consumerId: z.string().optional(),
    privateKey: z.string().optional(),
    channelType: z.string().optional(),
  }),
});

// GET /api/integrations - List all integrations
export async function GET() {
  try {
    const integrations = await listPlatformIntegrations();

    return NextResponse.json({
      success: true,
      data: integrations.map(({ config, syncCursor, ...integration }) => integration),
    });
  } catch (error: any) {
    console.error("Error fetching integrations:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// POST /api/integrations - Create a new integration
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = CreateIntegrationSchema.parse(body);

    // Validate platform-specific config
    if (data.platform === "shopify") {
      if (!data.config.shopDomain || !data.config.accessToken) {
        return NextResponse.json(
          {
            success: false,
            error: "Shopify integration requires shopDomain and accessToken",
          },
          { status: 400 }
        );
      }

      // Test connection before saving
      const { ShopifyClient } = await import("@/lib/integrations/shopify");
      const client = new ShopifyClient({
        shopDomain: data.config.shopDomain,
        accessToken: data.config.accessToken,
        apiVersion: data.config.apiVersion || "2024-01",
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

    if (data.platform === "amazon") {
      if (
        !data.config.sellerId ||
        !data.config.marketplaceId ||
        !data.config.accessKeyId ||
        !data.config.secretAccessKey
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

    if (data.platform === "ebay") {
      if (
        !data.config.clientId ||
        !data.config.clientSecret ||
        !data.config.refreshToken
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

    if (data.platform === "walmart") {
      if (
        !data.config.consumerId ||
        !data.config.privateKey ||
        !data.config.channelType
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

    // Create the integration
    const integration = await createPlatformIntegration({
      platform: data.platform,
      name: data.name,
      isActive: true,
      config: {
        ...data.config,
        apiVersion: data.config.apiVersion || "2024-01",
        region: data.config.region || "us-east-1",
        environment: data.config.environment || "production",
      },
    });

    return NextResponse.json({
      success: true,
      data: integration,
      message: "Integration created successfully",
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.issues[0].message },
        { status: 400 }
      );
    }

    console.error("Error creating integration:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
