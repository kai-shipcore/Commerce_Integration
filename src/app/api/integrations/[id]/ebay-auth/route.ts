import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminLikeRole } from "@/components/layout/navigation-config";
import { getPlatformIntegrationById } from "@/lib/db/platform-integrations";
import { EbayClient } from "@/lib/integrations/ebay/client";
import { applyEbayDefaults, validateEbayConfig } from "@/lib/integrations/ebay/config";

// GET /api/integrations/[id]/ebay-auth
// Starts the eBay OAuth Authorization Code flow.
// Requires EBAY_RUNAME env var (the RuName registered in eBay developer portal).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id || !isAdminLikeRole(session.user.role)) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const ruName = process.env.EBAY_RUNAME;
    if (!ruName) {
      return NextResponse.json(
        { success: false, error: "EBAY_RUNAME environment variable is not configured." },
        { status: 500 }
      );
    }

    const { id } = await params;
    const integration = await getPlatformIntegrationById(id);

    if (!integration || integration.platform !== "ebay") {
      return NextResponse.json({ success: false, error: "eBay integration not found" }, { status: 404 });
    }

    const config = applyEbayDefaults(integration.config);

    try {
      validateEbayConfig(config);
    } catch {
      return NextResponse.json(
        { success: false, error: "Integration is missing clientId or clientSecret. Please edit the integration first." },
        { status: 400 }
      );
    }

    const client = new EbayClient({
      clientId: String(config.clientId),
      clientSecret: String(config.clientSecret),
      refreshToken: "",
      environment: config.environment === "sandbox" ? "sandbox" : "production",
    });

    // state = integrationId so the callback can route to the right integration
    const authUrl = client.buildAuthorizationUrl(ruName, id);

    return NextResponse.redirect(authUrl);
  } catch (error: unknown) {
    console.error("eBay auth start error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
