/**
 * Code Guide:
 * GET    /api/integrations/[id] — Fetch a single integration with masked config.
 * PATCH  /api/integrations/[id] — Update name/isActive/config; re-validates
 *                                 config via the platform adapter and audit-logs.
 * DELETE /api/integrations/[id] — Delete an integration and audit-log it.
 * PATCH/DELETE intentionally use the stricter admin-role + permission double
 * gate (not the guardPermission() one-liner) — this matches the original
 * route's behavior exactly and is preserved as-is.
 * Controller layer only: parses/validates the request and delegates to
 * IntegrationsService. Data access lives in src/lib/integrations/repository.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isAdminLikeRole } from "@/components/layout/navigation-config";
import { canDo } from "@/lib/permissions";
import { getIp } from "@/lib/audit";
import { IntegrationsService } from "@/lib/integrations/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

const UpdateIntegrationSchema = z.object({
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await IntegrationsService.getIntegrationForDisplay(id);
    return apiSuccess({ data });
  } catch (error) {
    console.error("Error fetching integration:", error);
    return handleApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    if (!isAdminLikeRole(session.user.role)) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const allowed = await canDo(session.user.id, session.user.role as string, "integrations", "edit");
    if (!allowed) {
      return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const data = UpdateIntegrationSchema.parse(body);

    const integration = await IntegrationsService.updateIntegration(id, data, getIp(request.headers));

    return apiSuccess({ data: integration, message: "Integration updated successfully" });
  } catch (error) {
    console.error("Error updating integration:", error);
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    if (!isAdminLikeRole(session.user.role)) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const allowed = await canDo(session.user.id, session.user.role as string, "integrations", "delete");
    if (!allowed) {
      return NextResponse.json({ success: false, error: "Permission denied" }, { status: 403 });
    }

    const { id } = await params;
    await IntegrationsService.deleteIntegration(id, getIp(request.headers));

    return apiSuccess({ message: "Integration deleted successfully" });
  } catch (error) {
    console.error("Error deleting integration:", error);
    return handleApiError(error);
  }
}
