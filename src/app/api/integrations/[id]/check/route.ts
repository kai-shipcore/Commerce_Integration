/**
 * Code Guide:
 * This API route verifies whether a saved marketplace integration can be used.
 * Some platforms support a live API check today, while others only support
 * validating that the stored credentials are complete.
 */

import { NextResponse } from "next/server";
import { getPlatformIntegrationById } from "@/lib/db/platform-integrations";

type CheckStatus = "connected" | "credentials_saved" | "incomplete" | "failed";

function hasValues(config: Record<string, any>, fields: string[]) {
  return fields.every((field) => Boolean(config[field]));
}

export async function POST(
  request: Request,
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

    if (integration.platform === "shopify") {
      const { ShopifyClient } = await import("@/lib/integrations/shopify");
      const client = new ShopifyClient({
        shopDomain: config.shopDomain,
        accessToken: config.accessToken,
        apiVersion: config.apiVersion || "2024-01",
      });

      const result = await client.testConnection();

      if (!result.success) {
        return NextResponse.json({
          success: false,
          data: {
            status: "failed" satisfies CheckStatus,
            verification: "live",
            message: result.error || "Connection failed",
            checkedAt: new Date().toISOString(),
          },
        });
      }

      return NextResponse.json({
        success: true,
        data: {
          status: "connected" satisfies CheckStatus,
          verification: "live",
          message: `Connected to Shopify store ${result.shopName || integration.name}.`,
          checkedAt: new Date().toISOString(),
        },
      });
    }

    if (integration.platform === "amazon") {
      const complete = hasValues(config, [
        "sellerId",
        "marketplaceId",
        "accessKeyId",
        "secretAccessKey",
      ]);

      return NextResponse.json({
        success: complete,
        data: {
          status: complete
            ? ("credentials_saved" satisfies CheckStatus)
            : ("incomplete" satisfies CheckStatus),
          verification: "config_only",
          message: complete
            ? "Stored Amazon credentials look complete. Live connection check is not implemented yet."
            : "Amazon credentials are incomplete.",
          checkedAt: new Date().toISOString(),
        },
      });
    }

    if (integration.platform === "ebay") {
      const complete = hasValues(config, [
        "clientId",
        "clientSecret",
        "refreshToken",
      ]);

      return NextResponse.json({
        success: complete,
        data: {
          status: complete
            ? ("credentials_saved" satisfies CheckStatus)
            : ("incomplete" satisfies CheckStatus),
          verification: "config_only",
          message: complete
            ? "Stored eBay credentials look complete. Live connection check is not implemented yet."
            : "eBay credentials are incomplete.",
          checkedAt: new Date().toISOString(),
        },
      });
    }

    if (integration.platform === "walmart") {
      const complete = hasValues(config, [
        "consumerId",
        "privateKey",
        "channelType",
      ]);

      return NextResponse.json({
        success: complete,
        data: {
          status: complete
            ? ("credentials_saved" satisfies CheckStatus)
            : ("incomplete" satisfies CheckStatus),
          verification: "config_only",
          message: complete
            ? "Stored Walmart credentials look complete. Live connection check is not implemented yet."
            : "Walmart credentials are incomplete.",
          checkedAt: new Date().toISOString(),
        },
      });
    }

    return NextResponse.json({
      success: false,
      data: {
        status: "failed" satisfies CheckStatus,
        verification: "config_only",
        message: `Platform ${integration.platform} is not supported.`,
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error("Error checking integration connection:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
