/**
 * Code Guide:
 * This API route owns the factories / [id] backend workflow.
 * Controller layer only: parses the request, validates input, applies the
 * auth guard, and delegates to FactoriesService for business logic and
 * audit logging. Data access lives in src/lib/factories/repository.ts.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { getIp } from "@/lib/audit";
import { FactoriesService } from "@/lib/factories/service";
import { apiSuccess, withErrorHandler } from "@/lib/api-response";

const FactoryUpdateSchema = z.object({
  factoryName: z.string().trim().min(1),
  factoryCode: z.string().trim().optional(),
  origin: z.string().trim().optional(),
  contactName: z.string().trim().optional(),
  email: z.string().trim().optional(),
  phone: z.string().trim().optional(),
});

const FactoryPatchSchema = z.object({
  isActive: z.boolean(),
});

export const PUT = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const denied = await guardPermission("factory", "edit");
  if (denied) return denied;
  const { id } = await params;
  const body = await request.json();
  const validated = FactoryUpdateSchema.parse(body);
  const data = await FactoriesService.updateFactory(id, validated, getIp(request.headers));
  return apiSuccess({ data });
});

export const PATCH = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const body = await request.json();
  const validated = FactoryPatchSchema.parse(body);
  const denied = await guardPermission("factory", validated.isActive ? "status" : "delete");
  if (denied) return denied;

  const data = await FactoriesService.setActive(id, validated.isActive, getIp(request.headers));
  return apiSuccess({ data });
});
