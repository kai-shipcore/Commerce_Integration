/**
 * Code Guide:
 * GET /api/integrations/ebay-callback?code=...&state={integrationId} — Handles
 * the eBay OAuth callback after the user authorizes the app. Exchanges the
 * authorization code for access + refresh tokens and saves the refresh token.
 * No auth guard: this endpoint is called by eBay's OAuth server, not the
 * logged-in user directly (the `state` param scopes it to an integrationId).
 * Every path — success and failure — redirects back to the settings page,
 * so errors are surfaced via query params rather than the JSON error envelope.
 */

import { NextRequest, NextResponse } from "next/server";
import { IntegrationsService } from "@/lib/integrations/service";

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

    await IntegrationsService.completeEbayAuth(code, integrationId);

    return NextResponse.redirect(`${settingsUrl}?ebay_reauth=success`);
  } catch (error: unknown) {
    console.error("eBay OAuth callback error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.redirect(`${settingsUrl}?ebay_error=${encodeURIComponent(msg)}`);
  }
}
