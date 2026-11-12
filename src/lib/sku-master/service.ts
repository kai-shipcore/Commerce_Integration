import {
  SkuMasterRepository,
  inferProduct,
  type ProductRow,
  type ResolvedSkuMasterListQuery,
  type ExcelSkuRow,
  type FloorMatSetWrite,
} from "@/lib/sku-master/repository";
import { FloorMatSetRepository } from "@/lib/sku-master/floor-mat-set-repository";
import { normalizeMasterSku } from "@/lib/planning/master-sku";
import {
  OVERRIDE_SALES_STATUSES,
  coerceFloorMatSet,
  describeFloorMatSet,
  floorMatSetComponentSkus,
  hasFloorMatSetImportFields,
  isFloorMatSalesStatus,
  isFloorMatSku,
  mergeFloorMatSetImport,
  parseOverrideSalesStatus,
  parsePreOrder,
  parseSkuList,
  sameFloorMatSet,
  splitMultiValue,
  validateFloorMatSet,
  type FloorMatSet,
  type FloorMatSetImportFields,
  type OverrideSalesStatus,
} from "@/lib/planning/floor-mat-sets";
import { invalidatePlanningDashboardCache } from "@/lib/planning/dashboard-cache";
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
  originalOrCustom: unknown;
  /** Floor mat set links. Omitted = leave the stored set untouched. */
  floorMatSet?: unknown;
}

const VALID_TYPE_FILTERS: readonly string[] = OVERRIDE_SALES_STATUSES;
const VALID_SALES_STATUSES: readonly string[] = OVERRIDE_SALES_STATUSES;
const VALID_SALES_TYPES = ["Original", "Custom"] as const;

const floorMatOnlyStatusMessage = (masterSku: string, status: string) =>
  `${status} is a floor mat status and cannot be set on ${masterSku}`;

/** The dashboard reads SKU Master values through a 5-minute cache. */
async function refreshDashboardCache() {
  try {
    await invalidatePlanningDashboardCache();
  } catch (error) {
    console.error("Planning dashboard cache invalidation failed:", error);
  }
}

/** Reads one import cell that may be a string, an array, or absent. */
function importCell(value: unknown): string | unknown[] | null {
  if (Array.isArray(value)) return value.length > 0 ? value : null;
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

function parseSetImportFields(masterSku: string, row: Record<string, unknown> | null | undefined): FloorMatSetImportFields {
  const fields: FloorMatSetImportFields = {};
  const label = masterSku || "SKU row";

  const single = (value: unknown, name: string) => {
    const cell = importCell(value);
    if (cell == null) return undefined;
    const skus = parseSkuList(cell);
    if (skus.length > 1) throw new ValidationError(`${label}: ${name} takes one SKU, got ${skus.length}`);
    return skus[0];
  };
  const frontSku = single(row?.frontSku, "1st Row SKU");
  if (frontSku) fields.frontSku = frontSku;
  const rearSku = single(row?.rearSku, "2nd Row SKU");
  if (rearSku) fields.rearSku = rearSku;

  const third = importCell(row?.thirdRowSkus);
  if (third != null) {
    const skus = parseSkuList(third);
    if (skus.length > 0) fields.thirdRowSkus = skus;
  }
  const old = importCell(row?.oldSetSkus);
  if (old != null) {
    const skus = parseSkuList(old);
    if (skus.length > 0) fields.oldSetSkus = skus;
  }

  const preOrder12Raw = row?.preOrder12;
  if (typeof preOrder12Raw === "boolean" || importCell(preOrder12Raw) != null) {
    const parsed = parsePreOrder(preOrder12Raw);
    if (parsed == null) {
      throw new ValidationError(`Invalid 1~2 Row Pre-Order for ${label}: ${String(preOrder12Raw)} (use Yes or No)`);
    }
    fields.preOrder12 = parsed;
  }

  const preOrder3Raw = row?.preOrder3Values ?? row?.preOrder3;
  const preOrder3Cell = typeof preOrder3Raw === "boolean" ? [preOrder3Raw] : importCell(preOrder3Raw);
  if (preOrder3Cell != null) {
    const parts: unknown[] = Array.isArray(preOrder3Cell) ? preOrder3Cell : splitMultiValue(preOrder3Cell);
    const values = parts.map((part) => {
      const parsed = parsePreOrder(part);
      if (parsed === undefined) {
        throw new ValidationError(`Invalid 3rd Row Pre-Order for ${label}: ${String(part)} (use Yes or No)`);
      }
      return parsed;
    });
    if (values.some((value) => value != null)) fields.preOrder3Values = values;
  }

  return fields;
}

function shapeProduct(row: ProductRow, floorMatSet: FloorMatSet | null = null) {
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
    floorMatSet,
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
    const sets = isFloorMatSku(row.master_sku) ? await FloorMatSetRepository.findBySkus([row.master_sku]) : null;
    return shapeProduct(row, sets?.get(row.master_sku) ?? null);
  },

  async listProducts(query: ListSkuMasterQuery) {
    const status = (query.status || "active").toLowerCase();
    if (status !== "all" && status !== "active" && status !== "inactive") {
      throw new ValidationError("Invalid status filter");
    }

    const salesType = query.salesType || "all";
    if (salesType !== "all" && salesType !== "Original" && salesType !== "Custom" && salesType !== "Part") {
      throw new ValidationError("Invalid salesType filter");
    }

    const typeFilter = query.type || "all";
    if (typeFilter !== "all" && !VALID_TYPE_FILTERS.includes(typeFilter)) {
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

    const floorMatSkus = rows.map((row) => row.master_sku).filter(isFloorMatSku);
    const sets = await FloorMatSetRepository.findBySkus(floorMatSkus);

    return {
      data: rows.map((row) => shapeProduct(row, sets.get(row.master_sku) ?? null)),
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
    const salesTypeRaw = input.originalOrCustom == null ? undefined : String(input.originalOrCustom).trim();
    // "Part" is derived from the SKU code (see originalOrCustomSql) and is what the UI
    // displays for part SKUs; a client echoing it back means "no override change", not
    // a request to store it. Rejecting it blocked every edit on part SKUs.
    const salesTypeOverride = salesTypeRaw === "" ? null : salesTypeRaw === "Part" ? undefined : salesTypeRaw ?? undefined;

    // Original/Custom are derived from order data (see shapeProduct/originalOrCustomSql) and must
    // never be written manually; Part/SWC are auto-detected — only override statuses are settable here.
    if (salesStatusValue != null && !VALID_SALES_STATUSES.includes(salesStatusValue)) {
      throw new ValidationError("Invalid salesStatus");
    }
    if (isFloorMatSalesStatus(salesStatusValue) && !isFloorMatSku(masterSku)) {
      throw new ValidationError(floorMatOnlyStatusMessage(masterSku, salesStatusValue));
    }
    if (salesTypeOverride != null && !VALID_SALES_TYPES.includes(salesTypeOverride as (typeof VALID_SALES_TYPES)[number])) {
      throw new ValidationError("Invalid originalOrCustom");
    }

    if (statusValue !== null && statusValue !== "active" && statusValue !== "inactive") {
      throw new ValidationError("Invalid status");
    }

    // Set links are validated before anything is written, so a bad link never
    // leaves the product half-saved.
    let floorMatSet: FloorMatSet | undefined;
    if (input.floorMatSet !== undefined && input.floorMatSet !== null) {
      try {
        floorMatSet = coerceFloorMatSet(input.floorMatSet);
      } catch (error) {
        throw new ValidationError(error instanceof Error ? error.message : "Invalid floor mat set");
      }
      const problem = validateFloorMatSet(masterSku, floorMatSet);
      if (problem) throw new ValidationError(problem);
      const components = floorMatSetComponentSkus(floorMatSet);
      const known = await FloorMatSetRepository.findExistingProductSkus(components);
      const unknown = components.filter((sku) => !known.has(sku));
      if (unknown.length > 0) {
        throw new ValidationError(`Not in SKU Master: ${unknown.join(", ")}`);
      }
    }

    const found = await SkuMasterRepository.updateProduct(masterSku, {
      moq,
      orderMultiple,
      cbmPerUnit,
      caseQty,
      weightKg,
      status: statusValue as "active" | "inactive" | null,
      salesStatus: salesStatusValue,
      salesTypeOverride: salesTypeOverride as "Original" | "Custom" | null | undefined,
    });

    if (!found) throw new NotFoundError("SKU not found");

    const session = await auth();
    if (floorMatSet) {
      await FloorMatSetRepository.save(
        masterSku,
        floorMatSet,
        session?.user?.name ?? session?.user?.email ?? session?.user?.id ?? null
      );
    }
    await refreshDashboardCache();

    void logAudit({
      entityType: "sku",
      entityId: masterSku,
      entityLabel: masterSku,
      userId: session?.user?.id ?? null,
      userName: session?.user?.name ?? null,
      userEmail: session?.user?.email ?? null,
      action: statusValue === "inactive" ? "delete" : "update",
      after: Object.fromEntries(
        Object.entries({
          moq, orderMultiple, cbmPerUnit, caseQty, weightKg, status: statusValue, salesStatus: salesStatusValue, originalOrCustom: salesTypeOverride,
          floorMatSet: floorMatSet ? describeFloorMatSet(floorMatSet) ?? "(cleared)" : undefined,
        })
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
      const rawStatus = String(row?.status ?? "").trim();
      const normalizedStatus = rawStatus.toLowerCase();
      const status = normalizedStatus === "active" || normalizedStatus === "inactive" ? normalizedStatus : undefined;
      const rawSalesStatus = String(row?.salesStatus ?? "").trim();
      const salesStatus: OverrideSalesStatus | undefined = parseOverrideSalesStatus(rawSalesStatus);

      if (rawStatus && !status) {
        throw new ValidationError(`Invalid Status for ${masterSku || "SKU row"}: ${rawStatus}`);
      }
      if (rawSalesStatus && !salesStatus) {
        throw new ValidationError(`Invalid Type for ${masterSku || "SKU row"}: ${rawSalesStatus}`);
      }

      if (isFloorMatSalesStatus(salesStatus) && !isFloorMatSku(masterSku)) {
        throw new ValidationError(floorMatOnlyStatusMessage(masterSku || "SKU row", salesStatus));
      }
      const setFields = parseSetImportFields(masterSku, row);
      const hasSetFields = hasFloorMatSetImportFields(setFields);

      if (
        !masterSku ||
        (cbmPerUnit == null && moq == null && orderMultiple == null && status == null && salesStatus == null && !hasSetFields)
      ) {
        continue;
      }
      if (hasSetFields && !isFloorMatSku(masterSku)) {
        throw new ValidationError(`${masterSku} is not a floor mat SKU; set links and Pre-Order flags apply to CA-FM- SKUs only`);
      }

      rowsBySku.set(masterSku, { masterSku, cbmPerUnit, moq, orderMultiple, status, salesStatus, ...setFields });
    }

    return [...rowsBySku.values()];
  },

  /**
   * Resolves each import row's floor mat set columns into the full set that
   * would be stored, merged over what is stored now. Rows with no set columns
   * are absent from the result.
   */
  async resolveFloorMatSetImports(rows: ExcelSkuRow[]) {
    const setRows = rows.filter(hasFloorMatSetImportFields);
    const existing = await FloorMatSetRepository.findBySkus(setRows.map((row) => row.masterSku));
    const resolved = new Map<string, { current: FloorMatSet | null; next: FloorMatSet; changed: boolean }>();

    for (const row of setRows) {
      const current = existing.get(row.masterSku) ?? null;
      let next: FloorMatSet;
      try {
        next = mergeFloorMatSetImport(row.masterSku, current, row);
      } catch (error) {
        throw new ValidationError(error instanceof Error ? error.message : "Invalid floor mat set");
      }
      const problem = validateFloorMatSet(row.masterSku, next);
      if (problem) throw new ValidationError(problem);
      resolved.set(row.masterSku, { current, next, changed: !sameFloorMatSet(current, next) });
    }

    return resolved;
  },

  async previewExcelImport(rawRows: unknown[]) {
    const rows = this.parseExcelRows(rawRows);
    if (rows.length === 0) {
      throw new ValidationError("No valid Master SKU / CBM / MOQ / Order Multiple / Status / Type rows found");
    }

    const [existingBySku, setsBySku] = await Promise.all([
      SkuMasterRepository.findExistingValuesBySkus(rows.map((row) => row.masterSku)),
      this.resolveFloorMatSetImports(rows),
    ]);

    // Component SKUs that have no SKU Master row yet. Not an error (a new
    // component can be linked before it appears in inventory), but most often
    // a typo, so the preview lists them.
    const importedSkus = new Set(rows.map((row) => row.masterSku));
    const componentSkus = [...new Set([...setsBySku.values()].flatMap(({ next }) => floorMatSetComponentSkus(next)))];
    const knownComponents = await FloorMatSetRepository.findExistingProductSkus(componentSkus);
    const unknownComponentSkus = componentSkus.filter((sku) => !knownComponents.has(sku) && !importedSkus.has(sku));

    const previewRows = rows.map((row) => {
      const existing = existingBySku.get(row.masterSku) ?? null;
      const defaults = inferProduct(row.masterSku);
      const set = setsBySku.get(row.masterSku) ?? null;
      const next = {
        cbmPerUnit: existing ? row.cbmPerUnit ?? existing.cbmPerUnit : row.cbmPerUnit ?? defaults.cbmPerUnit,
        moq: existing ? row.moq ?? existing.moq : row.moq ?? defaults.moq,
        orderMultiple: existing ? row.orderMultiple ?? existing.orderMultiple : row.orderMultiple ?? defaults.moq,
        status: existing ? row.status ?? existing.status : row.status ?? "active",
        salesStatus: existing ? row.salesStatus ?? existing.salesStatus : row.salesStatus ?? null,
        floorMatSet: set ? describeFloorMatSet(set.next) : null,
      };
      const current = existing ? { ...existing, floorMatSet: set ? describeFloorMatSet(set.current) : null } : null;
      const changedFields = existing
        ? [
            existing.cbmPerUnit !== next.cbmPerUnit ? "cbmPerUnit" : null,
            existing.moq !== next.moq ? "moq" : null,
            existing.orderMultiple !== next.orderMultiple ? "orderMultiple" : null,
            existing.status !== next.status ? "status" : null,
            existing.salesStatus !== next.salesStatus ? "salesStatus" : null,
            set?.changed ? "floorMatSet" : null,
          ].filter((field): field is string => field !== null)
        : ["cbmPerUnit", "moq", "orderMultiple", "status", "salesStatus", ...(set ? ["floorMatSet"] : [])];
      const action: "insert" | "update" | "unchanged" = existing
        ? changedFields.length > 0
          ? "update"
          : "unchanged"
        : "insert";

      return { masterSku: row.masterSku, action, current, next, changedFields };
    });

    const summary = previewRows.reduce(
      (counts, row) => ({ ...counts, [row.action]: counts[row.action] + 1 }),
      { insert: 0, update: 0, unchanged: 0 }
    );

    return { rows: previewRows, summary, unknownComponentSkus };
  },

  async applyExcelImport(rawRows: unknown[]) {
    const rows = this.parseExcelRows(rawRows);
    if (rows.length === 0) {
      throw new ValidationError("No valid Master SKU / CBM / MOQ / Order Multiple / Status / Type rows found");
    }

    const setsBySku = await this.resolveFloorMatSetImports(rows);
    const floorMatSets: FloorMatSetWrite[] = [...setsBySku.entries()]
      .filter(([, set]) => set.changed)
      .map(([masterSku, set]) => ({ masterSku, set: set.next }));
    const session = floorMatSets.length > 0 ? await auth() : null;
    const actor = session?.user?.name ?? session?.user?.email ?? session?.user?.id ?? null;

    const { updated, inserted } = await SkuMasterRepository.applyExcelImport(rows, floorMatSets, actor);
    await refreshDashboardCache();
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
