/**
 * Code Guide:
 * This API route owns the planning/sku-master backend workflow.
 * Controller layer only: parses the request, applies the auth guard, and
 * delegates to SkuMasterService for validation, business logic, and audit
 * logging. Data access lives in src/lib/sku-master/repository.ts.
 */

import { NextRequest } from "next/server";
import { guardPermission } from "@/lib/permissions";
import { getIp } from "@/lib/audit";
import { SkuMasterService } from "@/lib/sku-master/service";
import { apiSuccess, handleApiError } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  const denied = await guardPermission("sku-master", "read");
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const masterSku = searchParams.get("masterSku")?.trim() ?? "";

    if (masterSku) {
      const data = await SkuMasterService.getProduct(masterSku);
      return apiSuccess({ data });
    }

    const result = await SkuMasterService.listProducts({
      search: searchParams.get("search")?.trim() ?? "",
      product: searchParams.get("product")?.trim() ?? "",
      status: searchParams.get("status")?.trim().toLowerCase() ?? "active",
      masterSku: "",
      page: Number(searchParams.get("page") ?? 1),
      limit: Number(searchParams.get("limit") ?? 50),
      salesType: searchParams.get("salesType")?.trim() ?? "all",
      type: searchParams.get("type")?.trim() ?? "all",
    });

    return apiSuccess(result);
  } catch (error) {
    console.error("SKU master GET failed:", error);
    return handleApiError(error);
  }
}

export async function POST() {
  const denied = await guardPermission("sku-master", "edit");
  if (denied) return denied;
  try {
    const result = await SkuMasterService.syncFromInventory();
    return apiSuccess(result);
  } catch (error) {
    console.error("SKU master sync failed:", error);
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  const denied = await guardPermission("sku-master", "edit");
  if (denied) return denied;
  try {
    const body = await request.json();
    await SkuMasterService.updateProduct(body, getIp(request.headers));
    return apiSuccess({});
  } catch (error) {
    console.error("SKU master PATCH failed:", error);
    return handleApiError(error);
  }
}

export async function PUT(request: NextRequest) {
  const denied = await guardPermission("sku-master", "edit");
  if (denied) return denied;
  try {
    const body = await request.json();
    const rawRows = Array.isArray(body.rows) ? body.rows : [];

    if (body.preview === true) {
      const data = await SkuMasterService.previewExcelImport(rawRows);
      return apiSuccess({ data });
    }

    const result = await SkuMasterService.applyExcelImport(rawRows);
    return apiSuccess(result);
  } catch (error) {
    console.error("SKU master Excel import failed:", error);
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await guardPermission("sku-master", "delete");
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const masterSku = searchParams.get("masterSku")?.trim() ?? "";
    await SkuMasterService.deactivateProduct(masterSku, getIp(request.headers));
    return apiSuccess({});
  } catch (error) {
    console.error("SKU master DELETE failed:", error);
    return handleApiError(error);
  }
}
