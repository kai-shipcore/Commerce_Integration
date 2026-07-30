/**
 * Code Guide:
 * POST /api/integrations/[id]/check — Verifies whether a saved marketplace
 * integration can be used. Some platforms support a live API check today,
 * others only validate that stored credentials are complete.
 * Note: the response's top-level `success` mirrors the connection check's own
 * result (it can be `false` on a 200 response) — not the standard apiSuccess
 * envelope — matching the original route's contract exactly.
 */

import { NextResponse } from "next/server";
import { IntegrationsService } from "@/lib/integrations/service";
import { handleApiError } from "@/lib/api-response";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await IntegrationsService.checkConnection(id);

    return NextResponse.json({
      success: result.success,
      data: result,
    });
  } catch (error) {
    console.error("Error checking integration connection:", error);
    return handleApiError(error);
  }
}
