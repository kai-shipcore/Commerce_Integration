// Code Guide: CRUD and Excel import API for SKU price history used by Invoice & Price Control.
// Controller layer only: GET dispatches on `mode` (factories/files/default list),
// DELETE dispatches on which of sourceFileId/ids/id was supplied -- both stay
// here since they're driven by query-param shape, then delegate to
// InvoicePriceControlService.

import { NextRequest } from "next/server";
import { z } from "zod";
import { guardPermission } from "@/lib/permissions";
import { InvoicePriceControlService } from "@/lib/invoice-price-control/service";
import { apiSuccess, apiError, handleApiError } from "@/lib/api-response";

const PriceBodySchema = z.object({
  factoryId: z.string().min(1),
  sku: z.string().trim().min(1),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  unitPrice: z.number().nonnegative(),
  currency: z.string().trim().min(3).max(3).default("USD"),
  reason: z.string().trim().optional(),
});

export async function GET(request: NextRequest) {
  const denied = await guardPermission("invoice-price-control", "read");
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode")?.trim() ?? "";

    if (mode === "factories") {
      const activeOnly = searchParams.get("active") !== "false";
      const data = await InvoicePriceControlService.getFactoriesForPriceHistory(activeOnly);
      return apiSuccess({ data });
    }

    if (mode === "files") {
      const factoryId = searchParams.get("factoryId")?.trim() ?? "";
      const data = await InvoicePriceControlService.getPriceHistoryFiles(factoryId);
      return apiSuccess({ data });
    }

    const data = await InvoicePriceControlService.getPriceHistoryList({
      factoryId: searchParams.get("factoryId")?.trim() ?? "",
      sku: searchParams.get("sku")?.trim() ?? "",
      asOfDate: searchParams.get("asOfDate")?.trim() ?? "",
      sourceFileId: searchParams.get("sourceFileId")?.trim() ?? "",
      currentOnly: searchParams.get("currentOnly") === "true",
    });
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  const denied = await guardPermission("invoice-price-control", "create");
  if (denied) return denied;

  try {
    const body = await request.json();
    const parsed = PriceBodySchema.parse(body);
    const data = await InvoicePriceControlService.createPriceHistory(parsed);
    return apiSuccess({ data }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: NextRequest) {
  const denied = await guardPermission("invoice-price-control", "edit");
  if (denied) return denied;

  try {
    const body = await request.json();
    const id = String(body.id ?? "").trim();
    if (!id) return apiError("id is required", 400);

    const parsed = PriceBodySchema.parse(body);
    await InvoicePriceControlService.updatePriceHistory(id, parsed);
    return apiSuccess({});
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await guardPermission("invoice-price-control", "delete");
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const sourceFileId = searchParams.get("sourceFileId")?.trim() || undefined;
    const ids = searchParams.get("ids")?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
    const id = searchParams.get("id")?.trim() || undefined;

    const data = await InvoicePriceControlService.deletePriceHistory({ sourceFileId, ids, id });
    return data ? apiSuccess({ data }) : apiSuccess({});
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  const denied = await guardPermission("invoice-price-control", "create");
  if (denied) return denied;

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const fallbackFactoryId = String(formData.get("factoryId") ?? "").trim();
    const fallbackEffectiveDate = String(formData.get("effectiveDate") ?? "").trim();
    const fallbackReason = String(formData.get("reason") ?? "").trim();

    if (!(file instanceof File)) {
      return apiError("file is required", 400);
    }

    const data = await InvoicePriceControlService.importPriceHistoryExcel(file, fallbackFactoryId, fallbackEffectiveDate, fallbackReason);
    return apiSuccess({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
