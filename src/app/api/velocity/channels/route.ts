/**
 * Code Guide:
 * GET /api/velocity/channels — Returns distinct platform_source values from ecommerce_data
 * used to populate Channel tab sub-tabs on the Velocity page.
 * Controller layer only: delegates to VelocityService.
 */

import { VelocityService } from "@/lib/velocity/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

export async function GET() {
  try {
    const result = await VelocityService.getChannels();
    return apiSuccess(result);
  } catch (error) {
    console.error("[velocity/channels] GET error:", error);
    return handleApiError(error);
  }
}
