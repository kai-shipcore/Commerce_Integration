/**
 * Code Guide:
 * GET /api/integrations/[id]/ebay-auth — Starts the eBay OAuth Authorization
 * Code flow and redirects to eBay's consent screen. Requires the integration's
 * ruName (or the EBAY_RUNAME env var as a legacy fallback).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminLikeRole } from "@/components/layout/navigation-config";
import { IntegrationsService } from "@/lib/integrations/service";
import { handleApiError } from "@/lib/api-response";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id || !isAdminLikeRole(session.user.role)) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const authUrl = await IntegrationsService.buildEbayAuthUrl(id);

    return NextResponse.redirect(authUrl);
  } catch (error) {
    console.error("eBay auth start error:", error);
    return handleApiError(error);
  }
}
