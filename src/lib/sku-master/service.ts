import {
  SkuMasterRepository,
  inferProduct,
  type ProductRow,
  type ResolvedSkuMasterListQuery,
  type ExcelSkuRow,
} from "@/lib/sku-master/repository";
import { normalizeMasterSku } from "@/lib/planning/master-sku";
import { logAudit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { NotFoundError, ValidationError } from "@/lib/errors";

export interface ListSkuMasterQuery {
  search: string;
  product: string;
  status: string;
  masterSku: string;
  page: number;
  limit: number;
  salesType: string;
  type: string;
}

export interface UpdateSkuMasterInput {
  masterSku: unknown;
  moq: unknown;
  orderMultiple: unknown;
  cbmPerUnit: unknown;
  caseQty: unknown;
  weightKg: unknown;
  status: unknown;
  salesStatus: unknown;
}

const VALID_TYPE_FILTERS = ["Hold", "Discontinued", "TBD"] as const;
const VALID_SALES_STATUSES = ["Hold", "Discontinued", "TBD"] as const;

function shapeProduct(row: ProductRow) {
  const inferred = inferProduct(row.master_sku);
  return {
    masterSku: row.master_sku,
    productName: row.product_name,
    productKey: (row.category_code?.toLowerCase() ?? inferred.productKey) as typeof inferred.productKey,
    category: row.category ?? inferred.category,
    categoryCode: row.category_code ?? inferred.categoryCode,
    status: row.status ?? "active",
    salesStatus: row.sales_status ?? null,
    originalOrCustom: row.original_or_custom ?? "Original",
    moq: Number(row.moq ?? inferred.moq),
    // Intentional: falls back to inferred.moq (not a distinct "inferred order multiple"),
    // matching the pre-refactor route — inferProduct never returns an orderMultiple default.
    orderMultiple: Number(row.order_multiple ?? inferred.moq),
    cbmPerUnit: Number(row.cbm_per_unit ?? inferred.cbmPerUnit),
    caseQty: Number(row.case_qty ?? inferred.caseQty),
    weightKg: Number(row.weight_kg ?? inferred.weightKg),
  };
}

/**
 * Business logic for the SKU Master admin feature: validates filters,
 * shapes Repository rows into the API response contract, orchestrates the
 * inventory-sync/Excel-import flows, and writes audit log entries for
 * mutations. Repository has no knowledge of any of this.
 */
export const SkuMasterService = {
  async getProduct(masterSku: string) {
    const row = await SkuMasterRepository.findBySku(masterSku);
    if (!row) throw new NotFoundError(`SKU does not exist in fc_products: ${masterSku}`);
    return shapeProduct(row);
  },

  async listProducts(query: ListSkuMasterQuery) {
    const status = (query.status || "active").toLowerCase();
    if (status !== "all" && status !== "active" && status !== "inactive") {
      throw new ValidationError("Invalid status filter");
    }

    const salesType = query.salesType || "all";
    if (salesType !== "all" && salesType !== "Original" && salesType !== "Custom") {
      throw new ValidationError("Invalid salesType filter");
    }

    const typeFilter = query.type || "all";
    if (typeFilter !== "all" && !VALID_TYPE_FILTERS.includes(typeFilter as (typeof VALID_TYPE_FILTERS)[number])) {
      throw new ValidationError("Invalid type filter");
    }

    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(200, Math.max(20, Number(query.limit || 50)));
    const productValues = query.product ? query.product.split(",").map((v) => v.trim()).filter(Boolean) : [];

    const resolved: ResolvedSkuMasterListQuery = {
      page,
      limit,
      offset: (page - 1) * limit,
      search: query.search.trim(),
      productValues,
      status: status as ResolvedSkuMasterListQuery["status"],
      salesType: salesType as ResolvedSkuMasterListQuery["salesType"],
      typeFilter: typeFilter as ResolvedSkuMasterListQuery["typeFilter"],
    };

    const [total, rows] = await Promise.all([
      SkuMasterRepository.countProducts(resolved),
      SkuMasterRepository.listProducts(resolved),
    ]);

    return {
      data: rows.map(shapeProduct),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  },

  async syncFromInventory() {
    const { sourceRowCount, masterSkus } = await SkuMasterRepository.getDistinctMasterSkusFromInventory();
    const { upserted } = await SkuMasterRepository.upsertProductsFromSync(masterSkus);
    return { sourceRows: sourceRowCount, upserted };
  },

  async updateProduct(input: UpdateSkuMasterInput, ip: string | null) {
    const masterSku = String(input.masterSku ?? "").trim();
    if (!masterSku) throw new ValidationError("masterSku is required");

    const moq = input.moq == null ? null : Math.max(1, Number(input.moq));
    const orderMultiple = input.orderMultiple == null ? null : Math.max(1, Number(input.orderMultiple));
    const caseQty = input.caseQty == null ? null : Math.max(1, Number(input.caseQty));
    const cbmPerUnit = input.cbmPerUnit == null ? null : Math.max(0.000001, Number(input.cbmPerUnit));
    const weightKg = input.weightKg == null ? null : Math.max(0, Number(input.weightKg));
    const statusValue = input.status == null ? null : String(input.status).trim().toLowerCase();
    const salesStatusRaw = input.salesStatus == null ? undefined : String(input.salesStatus).trim();
    const salesStatusValue = salesStatusRaw === "" ? null : salesStatusRaw ?? undefined;

    // Original/Custom are derived from order data (see shapeProduct/originalOrCustomSql) and must
    // never be written manually; Part/SWC are auto-detected — only override statuses are settable here.
    if (salesStatusValue != null && !VALID_SALES_STATUSES.includes(salesStatusValue as (typeof VALID_SALES_STATUSES)[number])) {
      throw new ValidationError("Invalid salesStatus");
    }

    if (statusValue !== null && statusValue !== "active" && statusValue !== "inactive") {
      throw new ValidationError("Invalid status");
    }

    const found = await SkuMasterRepository.updateProduct(masterSku, {
      moq,
      orderMultiple,
      cbmPerUnit,
      caseQty,
      weightKg,
      status: statusValue as "active" | "inactive" | null,
      salesStatus: salesStatusValue,
    });

    if (!found) throw new NotFoundError("SKU not found");

    const session = await auth();
    void logAudit({
      entityType: "sku",
      entityId: masterSku,
      entityLabel: masterSku,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: statusValue === "inactive" ? "delete" : "update",
      after: Object.fromEntries(
        Object.entries({ moq, orderMultiple, cbmPerUnit, caseQty, weightKg, status: statusValue, salesStatus: salesStatusValue })
          .filter(([, v]) => v != null)
      ),
      ip,
    });
  },

  parseExcelRows(rawRows: unknown[]): ExcelSkuRow[] {
    const rowsBySku = new Map<string, ExcelSkuRow>();

    for (const rawRow of rawRows) {
      const row = rawRow as Record<string, unknown> | null | undefined;
      const masterSku = normalizeMasterSku(String(row?.masterSku ?? "").trim().toUpperCase());
      const parsedCbm = Number(row?.cbmPerUnit);
      const parsedMoq = Number(row?.moq);
      const parsedOrderMultiple = Number(row?.orderMultiple);
      const cbmPerUnit = Number.isFinite(parsedCbm) && parsedCbm > 0 ? parsedCbm : undefined;
      const moq = Number.isInteger(parsedMoq) && parsedMoq >= 1 ? parsedMoq : undefined;
      const orderMultiple = Number.isInteger(parsedOrderMultiple) && parsedOrderMultiple >= 1 ? parsedOrderMultiple : undefined;

      if (!masterSku || (cbmPerUnit == null && moq == null && orderMultiple == null)) {
        continue;
      }

      rowsBySku.set(masterSku, { masterSku, cbmPerUnit, moq, orderMultiple });
    }

    return [...rowsBySku.values()];
  },

  async previewExcelImport(rawRows: unknown[]) {
    const rows = this.parseExcelRows(rawRows);
    if (rows.length === 0) {
      throw new ValidationError("No valid Master SKU / CBM / MOQ / Order Multiple rows found");
    }

    const existingBySku = await SkuMasterRepository.findExistingValuesBySkus(rows.map((row) => row.masterSku));

    const previewRows = rows.map((row) => {
      const existing = existingBySku.get(row.masterSku) ?? null;
      const defaults = inferProduct(row.masterSku);
      const next = {
        cbmPerUnit: existing ? row.cbmPerUnit ?? existing.cbmPerUnit : row.cbmPerUnit ?? defaults.cbmPerUnit,
        moq: existing ? row.moq ?? existing.moq : row.moq ?? defaults.moq,
        orderMultiple: existing ? row.orderMultiple ?? existing.orderMultiple : row.orderMultiple ?? defaults.moq,
      };
      const changedFields = existing
        ? [
            existing.cbmPerUnit !== next.cbmPerUnit ? "cbmPerUnit" : null,
            existing.moq !== next.moq ? "moq" : null,
            existing.orderMultiple !== next.orderMultiple ? "orderMultiple" : null,
          ].filter((field): field is string => field !== null)
        : ["cbmPerUnit", "moq", "orderMultiple"];
      const action: "insert" | "update" | "unchanged" = existing
        ? changedFields.length > 0
          ? "update"
          : "unchanged"
        : "insert";

      return { masterSku: row.masterSku, action, current: existing, next, changedFields };
    });

    const summary = previewRows.reduce(
      (counts, row) => ({ ...counts, [row.action]: counts[row.action] + 1 }),
      { insert: 0, update: 0, unchanged: 0 }
    );

    return { rows: previewRows, summary };
  },

  async applyExcelImport(rawRows: unknown[]) {
    const rows = this.parseExcelRows(rawRows);
    if (rows.length === 0) {
      throw new ValidationError("No valid Master SKU / CBM / MOQ / Order Multiple rows found");
    }

    const { updated, inserted } = await SkuMasterRepository.applyExcelImport(rows);
    return { imported: rows.length, upserted: updated + inserted, updated, inserted };
  },

  async deactivateProduct(masterSku: string, ip: string | null) {
    if (!masterSku) throw new ValidationError("masterSku is required");

    await SkuMasterRepository.deactivateProduct(masterSku);

    const session = await auth();
    void logAudit({
      entityType: "sku",
      entityId: masterSku,
      entityLabel: masterSku,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: "delete",
      before: { status: "active" },
      after: { status: "inactive" },
      ip,
    });
  },
};
