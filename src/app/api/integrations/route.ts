/**
 * Code Guide:
 * GET  /api/integrations — List all integrations with a computed tokenStatus badge.
 * POST /api/integrations — Create a new integration (validates config via the
 *                          platform adapter; live-tests the connection for Shopify).
 * Controller layer only: parses/validates the request and delegates to
 * IntegrationsService. Data access lives in src/lib/integrations/repository.ts.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { IntegrationsService } from "@/lib/integrations/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

const CreateIntegrationSchema = z.object({
  platform: z.enum(["shopify", "walmart", "ebay", "amazon"]),
  name: z.string().min(1, "Name is required"),
  config: z.record(z.string(), z.unknown()),
});

export async function GET() {
  try {
    const data = await IntegrationsService.listIntegrations();
    return apiSuccess({ data });
  } catch (error) {
    console.error("Error fetching integrations:", error);
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  const denied = await guardPermission("integrations", "create");
  if (denied) return denied;
  try {
    const body = await request.json();
    const data = CreateIntegrationSchema.parse(body);
    const integration = await IntegrationsService.createIntegration(data);

    return apiSuccess({ data: integration, message: "Integration created successfully" });
  } catch (error) {
    console.error("Error creating integration:", error);
    return handleApiError(error);
  }
}
