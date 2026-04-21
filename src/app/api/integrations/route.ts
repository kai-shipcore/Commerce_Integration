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
import { getIntegrationAdapter } from "@/lib/integrations/core/registry";
import { z } from "zod";

// Schema for creating a new integration
const CreateIntegrationSchema = z.object({
  platform: z.enum(["shopify", "walmart", "ebay", "amazon"]),
  name: z.string().min(1, "Name is required"),
  config: z.record(z.string(), z.unknown()),
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
    const adapter = getIntegrationAdapter(data.platform);
    const config = adapter.applyDefaults(data.config);
    adapter.validateConfig(config);

    if (data.platform === "shopify") {
      const testResult = await adapter.checkConnection(config);

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

    // Create the integration
    const integration = await createPlatformIntegration({
      platform: data.platform,
      name: data.name,
      isActive: true,
      config,
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
