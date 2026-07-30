// Code Guide: Available Stock CRUD/import (GET/POST create+import/PATCH/DELETE-by-stockId)
// backs the /planning/available-stock page and delegates to AvailableStockService.
//
// The container-allocation logic interleaved in this same file (POST
// action="allocate", DELETE by allocationIds) is a DIFFERENT domain
// (container-planning) that happens to share this route path and the
// "available-stock" permission's edit action for historical reasons. It
// delegates to ContainerPlanningService but keeps its own route/permission
// wiring here rather than moving to /api/containers, since the frontend and
// permission model are keyed off "available-stock".

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import { getIp } from "@/lib/audit";
import { AvailableStockService } from "@/lib/available-stock/service";
import { ContainerPlanningService } from "@/lib/container-planning/service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api-response";

const StockSourceSchema = z.enum(["remaining", "mistake"]);

const CreateStockSchema = z.object({
  sourceType: StockSourceSchema,
  referenceNo: z.string().trim().min(1),
  plNo: z.string().trim().optional(),
  masterSku: z.string().trim().min(1),
  totalQty: z.number().int().positive(),
  cbm: z.number().positive(),
  note: z.string().trim().optional(),
});

const UpdateStockSchema = CreateStockSchema.extend({
  id: z.string().regex(/^\d+$/),
});

const AllocateSchema = z.object({
  action: z.literal("allocate"),
  containerId: z.string().regex(/^\d+$/),
  allocations: z.array(z.object({
    stockId: z.string().regex(/^\d+$/),
    qty: z.number().int().positive(),
  })).min(1),
});

const ImportStockSchema = z.object({
  action: z.literal("import"),
  rows: z.array(z.object({
    sourceType: StockSourceSchema,
    referenceNo: z.string().trim().min(1),
    plNo: z.string().trim().optional(),
    masterSku: z.string().trim().min(1),
    totalQty: z.number().int().positive(),
    cbm: z.number().positive().optional(),
    note: z.string().trim().optional(),
  })).min(1),
});

async function currentWho() {
  const session = await auth();
  return { userId: session?.user?.id ?? null, userName: session?.user?.name ?? null, userEmail: session?.user?.email ?? null };
}

export async function GET(request: NextRequest) {
  const denied = await guardPermission("available-stock", "read");
  if (denied) return denied;
  try {
    const containerId = new URL(request.url).searchParams.get("containerId")?.trim() ?? "";
    const data = await AvailableStockService.listStock(containerId || null);
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  const body: unknown = await request.json();
  // allocate action modifies existing records; import/create add new ones
  const actionCheck = (body as { action?: string } | null)?.action;
  const postAction = actionCheck === "allocate" ? "edit" : "create";
  const denied = await guardPermission("available-stock", postAction);
  if (denied) return denied;

  const importRequest = ImportStockSchema.safeParse(body);
  if (importRequest.success) {
    try {
      const data = await AvailableStockService.importStock(importRequest.data.rows, await currentWho(), getIp(request.headers));
      return apiSuccess({ data });
    } catch (error) {
      return handleApiError(error);
    }
  }

  const allocation = AllocateSchema.safeParse(body);

  if (!allocation.success) {
    try {
      const validated = CreateStockSchema.parse(body);
      const data = await AvailableStockService.createStock(validated, await currentWho(), getIp(request.headers));
      return apiSuccess({ data });
    } catch (error) {
      return handleApiError(error);
    }
  }

  // ── container-planning territory below ──────────────────────────────
  try {
    await ContainerPlanningService.allocateStock(allocation.data.containerId, allocation.data.allocations);
    return apiSuccess({});
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  const denied = await guardPermission("available-stock", "edit");
  if (denied) return denied;
  try {
    const body: unknown = await request.json();
    const validated = UpdateStockSchema.parse(body);
    const data = await AvailableStockService.updateStock(validated.id, validated, await currentWho(), getIp(request.headers));
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await guardPermission("available-stock", "delete");
  if (denied) return denied;
  const searchParams = new URL(request.url).searchParams;
  const stockIdInput = searchParams.get("stockId")?.trim() ?? "";
  if (stockIdInput) {
    const stockIds = [...new Set(stockIdInput.split(",").map((id) => id.trim()).filter(Boolean))];
    if (stockIds.length === 0 || stockIds.some((id) => !/^\d+$/.test(id))) {
      return apiError("Valid stockId is required", 400);
    }

    try {
      const data = await AvailableStockService.deleteStock(stockIds, await currentWho(), getIp(request.headers));
      return apiSuccess({ data });
    } catch (error) {
      return handleApiError(error);
    }
  }

  // ── container-planning territory below ──────────────────────────────
  const allocationInput = searchParams.get("allocationIds")?.trim() || searchParams.get("allocationId")?.trim() || "";
  const allocationIds = [...new Set(allocationInput.split(",").map((id) => id.trim()).filter(Boolean))];
  if (allocationIds.length === 0 || allocationIds.some((id) => !/^\d+$/.test(id))) {
    return apiError("Valid allocationId or allocationIds is required", 400);
  }

  try {
    const data = await ContainerPlanningService.deallocateStock(allocationIds);
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
