/**
 * Code Guide:
 * This API route owns the factories backend workflow.
 * Controller layer only: parses the request, validates input, applies the
 * auth guard, and delegates to FactoriesService for business logic and
 * audit logging. Data access lives in src/lib/factories/repository.ts.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { getIp } from "@/lib/audit";
import { FactoriesService } from "@/lib/factories/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

const FactoryCreateSchema = z.object({
  factoryName: z.string().trim().min(1),
  factoryCode: z.string().trim().optional(),
  origin: z.string().trim().optional(),
  contactName: z.string().trim().optional(),
  email: z.string().trim().optional(),
  phone: z.string().trim().optional(),
});

export async function GET(request: NextRequest) {
  const denied = await guardPermission("factory", "read");
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const data = await FactoriesService.listFactories({
      active: searchParams.get("active"),
      search: searchParams.get("search")?.trim() ?? "",
    });
    return apiSuccess({ data });
  } catch (error) {
    console.error("Error fetching factories:", error);
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  const denied = await guardPermission("factory", "create");
  if (denied) return denied;
  try {
    const body = await request.json();
    const validated = FactoryCreateSchema.parse(body);
    const data = await FactoriesService.createFactory(validated, getIp(request.headers));
    return apiSuccess({ data }, 201);
  } catch (error) {
    console.error("Error creating factory:", error);
    return handleApiError(error);
  }
}
