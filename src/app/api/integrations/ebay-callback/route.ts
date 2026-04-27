import { NextRequest, NextResponse } from "next/server";
import { getPlatformIntegrationById, updatePlatformIntegration } from "@/lib/db/platform-integrations";
import { EbayClient } from "@/lib/integrations/ebay/client";
import { applyEbayDefaults } from "@/lib/integrations/ebay/config";

// GET /api/integrations/ebay-callback?code=...&state={integrationId}
// Handles the eBay OAuth callback after user authorizes the app.
// Exchanges the authorization code for access + refresh tokens and saves the refresh token.
export async function GET(request: NextRequest) {
  const settingsUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/settings/integrations`;

  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const integrationId = searchParams.get("state");
    const errorParam = searchParams.get("error");

    if (errorParam) {
      const desc = searchParams.get("error_description") ?? errorParam;
      return NextResponse.redirect(`${settingsUrl}?ebay_error=${encodeURIComponent(desc)}`);
    }

    if (!code || !integrationId) {
      return NextResponse.redirect(`${settingsUrl}?ebay_error=${encodeURIComponent("Missing code or state parameter")}`);
    }

    const integration = await getPlatformIntegrationById(integrationId);
    if (!integration || integration.platform !== "ebay") {
      return NextResponse.redirect(`${settingsUrl}?ebay_error=${encodeURIComponent("eBay integration not found")}`);
    }

    const config = applyEbayDefaults(integration.config);

    // ruName is stored per-integration; fall back to global env var for legacy integrations
    const ruName = String(config.ruName || "") || process.env.EBAY_RUNAME;
    if (!ruName) {
      return NextResponse.redirect(`${settingsUrl}?ebay_error=${encodeURIComponent("RuName is not configured for this integration")}`);
    }

    const client = new EbayClient({
      clientId: String(config.clientId),
      clientSecret: String(config.clientSecret),
      refreshToken: "",
      environment: config.environment === "sandbox" ? "sandbox" : "production",
    });

    const { refreshToken } = await client.exchangeCodeForTokens(code, ruName);

    await updatePlatformIntegration(integrationId, {
      config: {
        ...(integration.config as Record<string, unknown>),
        refreshToken,
      },
    });

    return NextResponse.redirect(`${settingsUrl}?ebay_reauth=success`);
  } catch (error: unknown) {
    console.error("eBay OAuth callback error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.redirect(`${settingsUrl}?ebay_error=${encodeURIComponent(msg)}`);
  }
}
