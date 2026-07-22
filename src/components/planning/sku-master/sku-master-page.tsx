"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { ChevronDown, ChevronUp, Database, Download, FileSpreadsheet, Search, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import type { ProductKey } from "@/features/planning/mock-data";
import { apiPath } from "@/lib/api-path";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { toast } from "sonner";
import { SkuPriceHistoryDrawer } from "@/components/production/sku-price-history-drawer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type SkuMasterRow = {
  masterSku: string;
  productName: string;
  productKey: ProductKey;
  category: string;
  categoryCode: string;
  status: SkuStatus;
  salesStatus: SalesStatus | null;
  moq: number;
  orderMultiple: number;
  cbmPerUnit: number;
  caseQty: number;
  weightKg: number;
};

type SkuStatus = "active" | "inactive";
type SalesStatus = "Original" | "Custom" | "Hold" | "Part" | "Discontinued" | "TBD" | "SWC";
type StatusFilter = SkuStatus | "all";

const productMeta: Record<
  ProductKey,
  { label: string; icon: string; badgeClass: string; cbmClass: string }
> = {
  cc: {
    label: "Car Cover",
    icon: "CC",
    badgeClass: "bg-[#dcefe8] text-[#047857] dark:bg-emerald-950/70 dark:text-emerald-300",
    cbmClass: "text-[#b56a00]",
  },
  fm: {
    label: "Floor Mat",
    icon: "FM",
    badgeClass: "bg-[#f5ead8] text-[#b56a00] dark:bg-orange-950/70 dark:text-orange-300",
    cbmClass: "text-[#d21f1f]",
  },
  sc: {
    label: "Seat Cover",
    icon: "SC",
    badgeClass: "bg-[#e5e9ff] text-[#2855d9] dark:bg-blue-950/70 dark:text-blue-300",
    cbmClass: "text-[#b56a00]",
  },
  ac: {
    label: "Accessories",
    icon: "AC",
    badgeClass: "bg-[#f0e6ff] text-[#7c3aed] dark:bg-purple-950/70 dark:text-purple-300",
    cbmClass: "text-[#b56a00]",
  },
};

const numberFormatter = new Intl.NumberFormat("en-US");

type ExcelSkuImportRow = {
  masterSku: string;
  cbmPerUnit?: number;
  moq?: number;
  orderMultiple?: number;
};

type ImportPreviewValue = {
  cbmPerUnit: number | null;
  moq: number | null;
  orderMultiple: number | null;
};

type ImportPreviewRow = {
  masterSku: string;
  action: "insert" | "update" | "unchanged";
  current: ImportPreviewValue | null;
  next: ImportPreviewValue;
  changedFields: Array<keyof ImportPreviewValue>;
};

type ImportPreview = {
  rows: ImportPreviewRow[];
  summary: { insert: number; update: number; unchanged: number };
};

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function parseNumberCell(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const normalized = String(value ?? "")
    .trim()
    .replace(/,/g, "")
    .match(/-?\d+(?:\.\d+)?/)?.[0];

  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function decimalPlaces(value: number): number {
  const text = String(value).toLowerCase();
  if (text.includes("e-")) return Number(text.split("e-")[1] ?? 0);
  return (text.split(".")[1] ?? "").replace(/0+$/, "").length;
}

function getSheetPriority(sheetName: string): number {
  const normalized = sheetName.toLowerCase();
  if (normalized.includes("only) l -")) return 0;
  if (normalized.startsWith("l -")) return 1;
  if (normalized.startsWith("link -")) return 2;
  if (normalized.startsWith("long plan -")) return 3;
  return 4;
}

function extractExcelSkuRows(workbook: XLSX.WorkBook): ExcelSkuImportRow[] {
  const rowsBySku = new Map<string, ExcelSkuImportRow & { precision: number; sheetPriority: number }>();

  for (const sheetName of workbook.SheetNames) {
    const sheetPriority = getSheetPriority(sheetName);
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: "",
      raw: true,
    });

    for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
      const headerRow = matrix[rowIndex];
      const normalizedHeaders = headerRow.map(normalizeHeader);
      const masterSkuIndex = normalizedHeaders.findIndex(
        (header) => header === "mastersku" || header.includes("mastersku")
      );

      if (masterSkuIndex < 0) continue;

      const cbmCandidates = normalizedHeaders
        .map((header, index) => ({ header, index }))
        .filter(({ header }) => header === "cbm" || header === "cbmperunit" || header.includes("cbmunit"));
      const cbmIndex =
        cbmCandidates.find((candidate) => candidate.index < masterSkuIndex)?.index ??
        cbmCandidates[0]?.index ??
        -1;
      const moqIndex = normalizedHeaders.findIndex(
        (header) => header === "moq" || header === "minimumorderquantity"
      );
      const orderMultipleIndex = normalizedHeaders.findIndex(
        (header) => header === "ordermultiple" || header === "orderqtymultiple" || header === "ordermultiples"
      );

      if (cbmIndex < 0 && moqIndex < 0 && orderMultipleIndex < 0) continue;

      for (let dataRowIndex = rowIndex + 1; dataRowIndex < matrix.length; dataRowIndex += 1) {
        const dataRow = matrix[dataRowIndex];
        const masterSku = String(dataRow[masterSkuIndex] ?? "").trim().toUpperCase();
        const parsedCbm = cbmIndex >= 0 ? parseNumberCell(dataRow[cbmIndex]) : null;
        const parsedMoq = moqIndex >= 0 ? parseNumberCell(dataRow[moqIndex]) : null;
        const parsedOrderMultiple = orderMultipleIndex >= 0 ? parseNumberCell(dataRow[orderMultipleIndex]) : null;
        const cbmPerUnit = parsedCbm != null && parsedCbm > 0 ? parsedCbm : undefined;
        const moq = parsedMoq != null && Number.isInteger(parsedMoq) && parsedMoq >= 1 ? parsedMoq : undefined;
        const orderMultiple = parsedOrderMultiple != null && Number.isInteger(parsedOrderMultiple) && parsedOrderMultiple >= 1
          ? parsedOrderMultiple
          : undefined;

        if (!masterSku || !masterSku.includes("-")) continue;
        if (cbmPerUnit == null && moq == null && orderMultiple == null) continue;

        const precision = cbmPerUnit == null ? 0 : decimalPlaces(cbmPerUnit);
        const existing = rowsBySku.get(masterSku);
        if (
          !existing ||
          sheetPriority < existing.sheetPriority ||
          (sheetPriority === existing.sheetPriority && precision > existing.precision)
        ) {
          rowsBySku.set(masterSku, { masterSku, cbmPerUnit, moq, orderMultiple, precision, sheetPriority });
        }
      }

      break;
    }
  }

  return [...rowsBySku.values()].map(({ masterSku, cbmPerUnit, moq, orderMultiple }) => ({
    masterSku,
    cbmPerUnit,
    moq,
    orderMultiple,
  }));
}

export function SkuMasterPage() {
  const { pick } = useI18n();
  const { can, ready } = usePermissions();
  const [rows, setRows] = useState<SkuMasterRow[]>([]);
  const [query, setQuery] = useState("");
  const [product, setProduct] = useState<ProductKey | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [salesTypeFilter, setSalesTypeFilter] = useState<SalesStatus | "all">("all");
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [editingSnapshot, setEditingSnapshot] = useState<SkuMasterRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [previewingImport, setPreviewingImport] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [pendingImportRows, setPendingImportRows] = useState<ExcelSkuImportRow[]>([]);
  const [message, setMessage] = useState("");
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [summaryCollapsed, setSummaryCollapsed] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [selectedPriceSku, setSelectedPriceSku] = useState<SkuMasterRow | null>(null);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 1,
  });

  async function fetchRows() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("search", query.trim());
      if (product !== "all") params.set("product", product);
      if (statusFilter !== "active") params.set("status", statusFilter);
      if (salesTypeFilter !== "all") params.set("salesType", salesTypeFilter);
      params.set("page", String(page));
      params.set("limit", String(limit));
      const res = await fetch(apiPath(`/api/planning/sku-master?${params.toString()}`), { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? pick("SKU 마스터를 불러오지 못했습니다.", "Failed to load SKU master"));
      setRows(json.data);
      setPagination(json.pagination ?? { page, limit, total: json.data.length, totalPages: 1 });
    } catch (error) {
      setRows([]);
      setMessage(error instanceof Error ? error.message : pick("SKU 마스터를 불러오지 못했습니다.", "Failed to load SKU master"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchRows();
    }, 200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, product, statusFilter, salesTypeFilter, page, limit]);

  const visibleSkus = useMemo(
    () => rows,
    [rows]
  );

  const stats = useMemo(() => {
    const missingCbm = rows.filter((sku) => !sku.cbmPerUnit || sku.cbmPerUnit <= 0).length;
    const averageCbm = rows.length
      ? rows.reduce((sum, sku) => sum + sku.cbmPerUnit, 0) / rows.length
      : 0;
    const productTypes = product === "all" ? Object.keys(productMeta).length : 1;
    return { missingCbm, averageCbm, productTypes };
  }, [product, rows]);

  const canViewPriceHistory = ready && can("invoice-price-control", "read");

  function updateRow(
    masterSku: string,
    patch: Partial<Pick<SkuMasterRow, "cbmPerUnit" | "moq" | "orderMultiple" | "caseQty" | "weightKg" | "status" | "salesStatus">>
  ) {
    setRows((current) => current.map((sku) => (sku.masterSku === masterSku ? { ...sku, ...patch } : sku)));
  }

  function startEditing(row: SkuMasterRow) {
    setEditingSku(row.masterSku);
    setEditingSnapshot({ ...row });
  }

  function cancelEditing() {
    if (editingSnapshot) {
      setRows((current) =>
        current.map((sku) => (sku.masterSku === editingSnapshot.masterSku ? editingSnapshot : sku))
      );
    }
    setEditingSku(null);
    setEditingSnapshot(null);
  }

  function revertEditingSnapshot() {
    if (editingSnapshot) {
      setRows((current) =>
        current.map((sku) => (sku.masterSku === editingSnapshot.masterSku ? editingSnapshot : sku))
      );
    }
    setEditingSku(null);
    setEditingSnapshot(null);
  }

  async function saveRow(row: SkuMasterRow): Promise<boolean> {
    if (!can("sku-master", "edit")) {
      toast.error(pick("이 작업을 수행할 권한이 없습니다.", "You don't have permission to perform this action."));
      revertEditingSnapshot();
      return false;
    }
    try {
      const res = await fetch(apiPath("/api/planning/sku-master"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          masterSku: row.masterSku,
          cbmPerUnit: row.cbmPerUnit,
          moq: row.moq,
          orderMultiple: row.orderMultiple,
          caseQty: row.caseQty,
          weightKg: row.weightKg,
          status: row.status,
          salesStatus: row.salesStatus,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? pick("SKU 저장에 실패했습니다.", "Failed to save SKU"));
      return true;
    } catch (error) {
      revertEditingSnapshot();
      toast.error(error instanceof Error ? error.message : pick("SKU 저장에 실패했습니다.", "Failed to save SKU"));
      return false;
    }
  }

  async function syncFromInventory() {
    if (!can("sku-master", "edit")) {
      toast.error(pick("이 작업을 수행할 권한이 없습니다.", "You don't have permission to perform this action."));
      return;
    }
    setSyncing(true);
    setMessage("");
    try {
      const res = await fetch(apiPath("/api/planning/sku-master"), { method: "POST" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? pick("SKU 마스터 동기화에 실패했습니다.", "Failed to sync SKU master"));
      setMessage(pick(`coverland_inventory에서 SKU ${json.upserted ?? 0}개를 동기화했습니다.`, `Synced ${json.upserted ?? 0} SKUs from coverland_inventory`));
      await fetchRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : pick("SKU 마스터 동기화에 실패했습니다.", "Failed to sync SKU master"));
    } finally {
      setSyncing(false);
    }
  }

  async function previewImportFile(file: File) {
    if (!can("sku-master", "edit")) {
      toast.error(pick("이 작업을 수행할 권한이 없습니다.", "You don't have permission to perform this action."));
      return;
    }
    setPreviewingImport(true);
    setMessage("");

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const importRows = extractExcelSkuRows(workbook);

      if (importRows.length === 0) {
        throw new Error(pick("파일에서 업데이트할 수 있는 유효한 행을 찾지 못했습니다.", "No valid rows with updatable values were found in the file"));
      }

      const res = await fetch(apiPath("/api/planning/sku-master"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview: true, rows: importRows }),
      });
      const json = await res.json();

      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? pick("가져오기 미리보기에 실패했습니다.", "Failed to preview import"));
      }
      setPendingImportRows(importRows);
      setImportPreview(json.data as ImportPreview);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : pick("가져오기 미리보기에 실패했습니다.", "Failed to preview import"));
    } finally {
      setPreviewingImport(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  async function applyImport() {
    if (pendingImportRows.length === 0 || !importPreview) return;
    const actionableSkus = new Set(
      importPreview.rows.filter((row) => row.action !== "unchanged").map((row) => row.masterSku)
    );
    const rowsToApply = pendingImportRows.filter((row) => actionableSkus.has(row.masterSku));
    if (rowsToApply.length === 0) return;
    setImporting(true);
    setMessage("");
    try {
      const res = await fetch(apiPath("/api/planning/sku-master"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rowsToApply }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? pick("엑셀 가져오기에 실패했습니다.", "Failed to import file"));
      }
      setMessage(
        pick(
          `SKU 행 ${numberFormatter.format(json.imported ?? rowsToApply.length)}개를 반영했습니다 ` +
          `(${numberFormatter.format(json.updated ?? 0)}개 수정, ${numberFormatter.format(json.inserted ?? 0)}개 추가)`,
          `Applied ${numberFormatter.format(json.imported ?? rowsToApply.length)} SKU rows ` +
          `(${numberFormatter.format(json.updated ?? 0)} updated, ${numberFormatter.format(json.inserted ?? 0)} inserted)`
        )
      );
      setImportPreview(null);
      setPendingImportRows([]);
      await fetchRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : pick("엑셀 가져오기에 실패했습니다.", "Failed to import file"));
    } finally {
      setImporting(false);
    }
  }

  function downloadImportTemplate() {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["Master SKU", "CBM", "MOQ", "Order Multiple"],
      ["CC-EXAMPLE-001", 0.012345, 12, 6],
      ["CC-EXAMPLE-002", 0.023456, 10, 5],
    ]);
    worksheet["!cols"] = [{ wch: 28 }, { wch: 16 }, { wch: 12 }, { wch: 18 }];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "SKU CBM Import");
    XLSX.writeFile(workbook, "sku-master-cbm-import-template.xlsx");
  }

  async function downloadCsv() {
    setDownloading(true);
    setMessage("");
    try {
      const exportLimit = 200;
      const totalPages = Math.max(1, Math.ceil(pagination.total / exportLimit));
      const exportRows: SkuMasterRow[] = [];

      for (let exportPage = 1; exportPage <= totalPages; exportPage += 1) {
        const params = new URLSearchParams();
        if (query.trim()) params.set("search", query.trim());
        if (product !== "all") params.set("product", product);
        if (statusFilter !== "active") params.set("status", statusFilter);
        if (salesTypeFilter !== "all") params.set("salesType", salesTypeFilter);
        params.set("page", String(exportPage));
        params.set("limit", String(exportLimit));

        const res = await fetch(apiPath(`/api/planning/sku-master?${params.toString()}`), { cache: "no-store" });
        const json = await res.json();
        if (!json.success) throw new Error(json.error ?? pick("SKU 마스터 내보내기에 실패했습니다.", "Failed to export SKU master"));
        exportRows.push(...json.data);
      }

      const headers = [
        "product_type",
        "master_sku",
        "product_name",
        "category",
        "category_code",
        "status",
        "cbm_per_unit",
        "moq",
        "order_multiple",
        "case_qty",
        "weight_kg",
      ];
      const lines = [
        headers.join(","),
        ...exportRows.map((sku) =>
          [
            productMeta[sku.productKey]?.label ?? sku.productKey,
            sku.masterSku,
            sku.productName,
            sku.category,
            sku.categoryCode,
            sku.status,
            sku.cbmPerUnit,
            sku.moq,
            sku.orderMultiple,
            sku.caseQty,
            sku.weightKg,
          ]
            .map(formatCsvCell)
            .join(",")
        ),
      ];
      const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `sku-master-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setMessage(pick(`SKU ${numberFormatter.format(exportRows.length)}개를 CSV로 다운로드했습니다.`, `Downloaded ${numberFormatter.format(exportRows.length)} SKUs as CSV`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : pick("CSV 다운로드에 실패했습니다.", "Failed to download CSV"));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
    <section className="sku-master-fullbleed flex min-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0] shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] bg-white px-5 py-4">
        <div className="flex items-start gap-2">
          <Database className="mt-1 h-5 w-5" />
          <div>
            <h1 className="text-lg font-semibold">{pick("SKU 마스터 관리", "SKU Master Management")}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {pick("CBM 및 MOQ를 관리합니다. 편집을 클릭하여 값을 수정하세요.", "Manage CBM and MOQ. Click Edit to update values inline.")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder={pick("SKU 검색...", "Search SKU...")}
            className="form-input h-9 w-52 bg-white"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setPage(1);
              }}
              className="inline-flex h-9 items-center gap-2 rounded-md px-2 text-xs font-semibold text-foreground hover:bg-[#f0eee9]"
              aria-label="Reset SKU search"
            >
              <span>{pick("초기화", "Reset")}</span>
              <span className="text-sm font-normal" aria-hidden="true">X</span>
            </button>
          ) : null}
          <select
            value={product}
            onChange={(event) => {
              setProduct(event.target.value as ProductKey | "all");
              setPage(1);
            }}
            className="form-input h-9 w-36 bg-white text-xs"
          >
            <option value="all">{pick("전체", "All")}</option>
            {(Object.keys(productMeta) as ProductKey[]).map((key) => (
              <option key={key} value={key}>
                {productMeta[key].label}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as StatusFilter);
              setPage(1);
            }}
            className="form-input h-9 w-32 bg-white text-xs"
          >
            <option value="active">{pick("활성", "Active")}</option>
            <option value="inactive">{pick("비활성", "Inactive")}</option>
            <option value="all">{pick("전체 상태", "All Status")}</option>
          </select>
          <select
            value={salesTypeFilter}
            onChange={(event) => {
              setSalesTypeFilter(event.target.value as SalesStatus | "all");
              setPage(1);
            }}
            className="form-input h-9 w-36 bg-white text-xs"
          >
            <option value="all">{pick("전체 유형", "All Types")}</option>
            {SALES_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={downloadCsv}
            disabled={downloading}
            className="h-9 rounded-md border border-[#cccac4] bg-white px-3 text-xs font-medium hover:bg-[#f0eee9]"
          >
            {downloading ? pick("다운로드 중...", "Downloading...") : pick("CSV 다운로드", "Download CSV")}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                setImportDialogOpen(false);
                void previewImportFile(file);
              }
            }}
          />
          <button
            type="button"
            onClick={() => setImportDialogOpen(true)}
            disabled={importing || previewingImport}
            className="h-9 rounded-md border border-[#cccac4] bg-white px-3 text-xs font-medium hover:bg-[#f0eee9] disabled:opacity-50"
          >
            {previewingImport
              ? pick("검토 중...", "Reviewing...")
              : importing
                ? pick("가져오는 중...", "Importing...")
                : pick("엑셀 가져오기", "Excel Import")}
          </button>
          <button
            type="button"
            onClick={syncFromInventory}
            disabled={syncing || importing}
            className="h-9 rounded-md bg-[#1a5cdb] px-4 text-xs font-semibold text-white hover:bg-[#1650c4]"
          >
            {syncing ? pick("동기화 중...", "Syncing...") : pick("재고 동기화", "Sync Inventory")}
          </button>
        </div>
      </header>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="border-b border-[#e2dfd8] bg-[#f8f7f3] px-6 py-5 pr-12">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div className="space-y-1.5">
                <DialogTitle>{pick("SKU Master 엑셀 가져오기", "SKU Master Excel Import")}</DialogTitle>
                <DialogDescription>
                  {pick(
                    "아래 템플릿 형식으로 SKU별 CBM, MOQ, 주문 배수를 준비해 주세요.",
                    "Prepare CBM, MOQ, and order multiple values for each SKU using the template below."
                  )}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-5 px-6 py-5">
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">{pick("템플릿 미리보기", "Template Preview")}</h3>
                <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700">
                  {pick("첫 행 헤더 필수", "Header row required")}
                </span>
              </div>
              <div className="overflow-hidden rounded-lg border border-[#d8d6ce]">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="bg-[#292724] text-white">
                    <tr>
                      <th className="border-r border-white/15 px-4 py-2.5 font-semibold">Master SKU</th>
                      <th className="border-r border-white/15 px-4 py-2.5 font-semibold">CBM</th>
                      <th className="border-r border-white/15 px-4 py-2.5 font-semibold">MOQ</th>
                      <th className="px-4 py-2.5 font-semibold">Order Multiple</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-xs">
                    <tr className="border-t border-[#e2dfd8] bg-white">
                      <td className="border-r border-[#e2dfd8] px-4 py-2.5">CC-EXAMPLE-001</td>
                      <td className="border-r border-[#e2dfd8] px-4 py-2.5">0.012345</td>
                      <td className="border-r border-[#e2dfd8] px-4 py-2.5">12</td>
                      <td className="px-4 py-2.5">6</td>
                    </tr>
                    <tr className="border-t border-[#e2dfd8] bg-[#faf9f6]">
                      <td className="border-r border-[#e2dfd8] px-4 py-2.5">CC-EXAMPLE-002</td>
                      <td className="border-r border-[#e2dfd8] px-4 py-2.5">0.023456</td>
                      <td className="border-r border-[#e2dfd8] px-4 py-2.5">10</td>
                      <td className="px-4 py-2.5">5</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-lg border border-blue-200 bg-blue-50/70 px-4 py-3 text-xs leading-5 text-blue-950">
              <ul className="list-disc space-y-1 pl-4">
                <li>{pick("지원 파일: .xlsx, .xls 또는 .csv", "Supported files: .xlsx, .xls, or .csv")}</li>
                <li>{pick("Master SKU는 필수이며, 나머지는 입력된 컬럼만 업데이트됩니다.", "Master SKU is required; only populated value columns are updated.")}</li>
                <li>{pick("CBM은 0보다 큰 숫자, MOQ와 주문 배수는 1 이상의 정수로 입력해 주세요.", "CBM must be greater than zero; MOQ and Order Multiple must be integers of at least 1.")}</li>
                <li>{pick("동일 SKU가 여러 번 나오면 우선순위가 높은 시트의 값이 적용됩니다.", "If a SKU appears more than once, the value from the higher-priority sheet is used.")}</li>
              </ul>
            </div>
          </div>

          <DialogFooter className="border-t border-[#e2dfd8] bg-[#f8f7f3] px-6 py-4 sm:justify-between">
            <button
              type="button"
              onClick={downloadImportTemplate}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#cccac4] bg-white px-4 text-xs font-semibold hover:bg-[#f0eee9]"
            >
              <Download className="h-4 w-4" />
              {pick("템플릿 다운로드", "Download Template")}
            </button>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#1a5cdb] px-5 text-xs font-semibold text-white hover:bg-[#1650c4]"
            >
              <Upload className="h-4 w-4" />
              {pick("엑셀 / CSV 파일 선택", "Choose Excel / CSV File")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importPreview !== null}
        onOpenChange={(open) => {
          if (!open && !importing) {
            setImportPreview(null);
            setPendingImportRows([]);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-hidden p-0 sm:max-w-5xl">
          <DialogHeader className="border-b border-[#e2dfd8] bg-[#f8f7f3] px-6 py-5 pr-12">
            <DialogTitle>{pick("SKU Master 변경 미리보기", "SKU Master Change Preview")}</DialogTitle>
            <DialogDescription>
              {pick(
                "아직 데이터베이스에 반영되지 않았습니다. 변경 내용을 확인한 후 적용해 주세요.",
                "Nothing has been written to the database yet. Review the changes before applying them."
              )}
            </DialogDescription>
          </DialogHeader>

          {importPreview ? (
            <>
              <div className="grid grid-cols-3 border-b border-[#e2dfd8] bg-white">
                <ImportPreviewStat
                  label={pick("신규 추가", "New")}
                  value={importPreview.summary.insert}
                  className="text-emerald-700"
                />
                <ImportPreviewStat
                  label={pick("기존 수정", "Updated")}
                  value={importPreview.summary.update}
                  className="border-l border-[#e2dfd8] text-blue-700"
                />
                <ImportPreviewStat
                  label={pick("변경 없음", "Unchanged")}
                  value={importPreview.summary.unchanged}
                  className="border-l border-[#e2dfd8] text-slate-500"
                />
              </div>

              <div className="max-h-[55vh] overflow-auto">
                <table className="w-full min-w-[880px] border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-[#292724] text-white">
                    <tr>
                      <th className="px-4 py-3 font-semibold">{pick("상태", "Status")}</th>
                      <th className="px-4 py-3 font-semibold">Master SKU</th>
                      <th className="px-4 py-3 font-semibold">CBM</th>
                      <th className="px-4 py-3 font-semibold">MOQ</th>
                      <th className="px-4 py-3 font-semibold">Order Multiple</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.rows.map((row) => (
                      <tr key={row.masterSku} className="border-b border-[#e2dfd8] bg-white last:border-b-0 hover:bg-[#faf9f6]">
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                            row.action === "insert"
                              ? "bg-emerald-100 text-emerald-700"
                              : row.action === "update"
                                ? "bg-blue-100 text-blue-700"
                                : "bg-slate-100 text-slate-500"
                          }`}>
                            {row.action === "insert"
                              ? pick("신규", "New")
                              : row.action === "update"
                                ? pick("수정", "Update")
                                : pick("동일", "Same")}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono font-semibold">{row.masterSku}</td>
                        <ImportValueChange
                          current={row.current?.cbmPerUnit ?? null}
                          next={row.next.cbmPerUnit}
                          changed={row.changedFields.includes("cbmPerUnit")}
                          decimals={6}
                        />
                        <ImportValueChange
                          current={row.current?.moq ?? null}
                          next={row.next.moq}
                          changed={row.changedFields.includes("moq")}
                        />
                        <ImportValueChange
                          current={row.current?.orderMultiple ?? null}
                          next={row.next.orderMultiple}
                          changed={row.changedFields.includes("orderMultiple")}
                        />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <DialogFooter className="border-t border-[#e2dfd8] bg-[#f8f7f3] px-6 py-4">
                <button
                  type="button"
                  disabled={importing}
                  onClick={() => {
                    setImportPreview(null);
                    setPendingImportRows([]);
                  }}
                  className="h-10 rounded-md border border-[#cccac4] bg-white px-5 text-xs font-semibold hover:bg-[#f0eee9] disabled:opacity-50"
                >
                  {pick("취소", "Cancel")}
                </button>
                <button
                  type="button"
                  disabled={importing || importPreview.summary.insert + importPreview.summary.update === 0}
                  onClick={() => void applyImport()}
                  className="h-10 rounded-md bg-[#1a5cdb] px-5 text-xs font-semibold text-white hover:bg-[#1650c4] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {importing
                    ? pick("적용 중...", "Applying...")
                    : pick(
                        `${numberFormatter.format(importPreview.summary.insert + importPreview.summary.update)}건 확인 후 적용`,
                        `Confirm & Apply ${numberFormatter.format(importPreview.summary.insert + importPreview.summary.update)}`
                      )}
                </button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <div className="border-b border-[#e2dfd8] bg-[#f0eee9] dark:border-slate-700 dark:bg-slate-900">
        <button
          type="button"
          onClick={() => setSummaryCollapsed((current) => !current)}
          className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-2 text-left transition-colors hover:bg-[#ebe8df] dark:hover:bg-slate-800"
          aria-expanded={!summaryCollapsed}
        >
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="font-semibold text-[#1a1917] dark:text-slate-50">{pick("요약", "Summary")}</span>
            <span className="text-muted-foreground">
              {pick("전체", "Total")} <span className="font-mono font-semibold text-foreground">{numberFormatter.format(pagination.total)}</span>
            </span>
            <span className="text-muted-foreground">
              {pick("이 페이지", "Page")} <span className="font-mono font-semibold text-foreground">{numberFormatter.format(visibleSkus.length)}</span>
            </span>
            <span className="text-muted-foreground">
              {pick("CBM 누락", "Missing CBM")} <span className="font-mono font-semibold text-foreground">{stats.missingCbm}</span>
            </span>
            <span className="text-muted-foreground">
              {pick("평균 CBM", "Avg CBM")} <span className="font-mono font-semibold text-foreground">{stats.averageCbm.toFixed(6)}</span>
            </span>
            <span className="text-muted-foreground">
              {pick("유형", "Types")} <span className="font-mono font-semibold text-foreground">{stats.productTypes}</span>
            </span>
          </span>
          {summaryCollapsed ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </button>
        {!summaryCollapsed ? (
          <div className="grid grid-cols-2 border-t border-[#e2dfd8] dark:border-slate-700 md:grid-cols-4">
            <SkuStat
              label={pick("전체 SKU", "Total SKUs")}
              value={numberFormatter.format(pagination.total)}
              sub={loading ? pick("불러오는 중...", "Loading...") : `${numberFormatter.format(visibleSkus.length)} ${pick("개 표시 중", "on this page")}`}
            />
            <SkuStat
              label={pick("CBM 누락", "Missing CBM")}
              value={stats.missingCbm.toString()}
              sub={stats.missingCbm ? pick("검토 필요", "Needs review") : pick("모두 입력됨", "All entered")}
            />
            <SkuStat label={pick("평균 CBM", "Average CBM")} value={stats.averageCbm.toFixed(6)} sub="m3 / unit" />
            <SkuStat label={pick("제품 유형", "Product Types")} value={stats.productTypes.toString()} sub={pick("유형", "types")} />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2dfd8] bg-white px-5 py-2 text-xs text-muted-foreground">
        <div>
          {pick("표시 중", "Showing")}{" "}
          <span className="font-semibold text-foreground">
            {pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1}
            {" - "}
            {Math.min(pagination.page * pagination.limit, pagination.total)}
          </span>{" "}
          {pick("/ 전체", "of")} <span className="font-semibold text-foreground">{pagination.total}</span>
        </div>
        <div className="flex items-center gap-2">
          <span>{pick("행", "Rows")}</span>
          <select
            value={limit}
            onChange={(event) => {
              setLimit(Number(event.target.value));
              setPage(1);
            }}
            className="h-8 rounded-md border border-[#cccac4] bg-white px-2 text-xs outline-none focus:border-[#1a5cdb]"
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>
          <button
            type="button"
            disabled={loading || pagination.page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="rounded-md border border-[#cccac4] bg-white px-3 py-1.5 font-medium text-foreground hover:bg-[#f0eee9] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pick("이전", "Prev")}
          </button>
          <span className="min-w-20 text-center">
            {pick("페이지", "Page")} <span className="font-semibold text-foreground">{pagination.page}</span> / {pagination.totalPages}
          </span>
          <button
            type="button"
            disabled={loading || pagination.page >= pagination.totalPages}
            onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}
            className="rounded-md border border-[#cccac4] bg-white px-3 py-1.5 font-medium text-foreground hover:bg-[#f0eee9] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pick("다음", "Next")}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-white">
        <div className="grid min-w-[1320px] grid-cols-[180px_290px_120px_120px_180px_90px_110px_90px_140px] border-b border-[#e2dfd8] bg-white text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
          <div className="px-4 py-3">{pick("제품", "Product")}</div>
          <div className="px-4 py-3">{pick("마스터 SKU", "Master SKU")}</div>
          <div className="px-4 py-3">{pick("상태", "Status")}</div>
          <div className="px-4 py-3">{pick("판매 유형", "Type")}</div>
          <div className="px-4 py-3">{pick("CBM / 단위", "CBM / Unit")}</div>
          <div className="px-4 py-3">{pick("최소 주문량", "MOQ")}</div>
          <div className="px-4 py-3">{pick("주문 배수", "Order Mult")}</div>
          <div className="px-4 py-3">{pick("케이스 수량", "Case Qty")}</div>
          <div className="px-4 py-3 text-right">{pick("작업", "Actions")}</div>
        </div>

        {visibleSkus.map((sku) => (
          <div
            key={sku.masterSku}
            onClick={() => {
              if (canViewPriceHistory && editingSku !== sku.masterSku) setSelectedPriceSku(sku);
            }}
            className={`grid min-w-[1320px] grid-cols-[180px_290px_120px_120px_180px_90px_110px_90px_140px] items-center border-b border-[#e2dfd8] text-sm last:border-b-0 ${canViewPriceHistory && editingSku !== sku.masterSku ? "cursor-pointer hover:bg-[#faf8f2]" : ""}`}
          >
            <div className="px-4 py-3">
              <ProductBadge product={sku.productKey} />
            </div>
            <div className="px-4 py-3 font-mono text-xs font-semibold">{sku.masterSku}</div>
            <EditableStatus
              active={editingSku === sku.masterSku}
              value={sku.status}
              onChange={(value) => updateRow(sku.masterSku, { status: value })}
            />
            <EditableSalesStatus
              active={editingSku === sku.masterSku}
              value={sku.salesStatus}
              onChange={(value) => updateRow(sku.masterSku, { salesStatus: value })}
            />
            <EditableNumber
              active={editingSku === sku.masterSku}
              value={sku.cbmPerUnit}
              decimals={6}
              className={`font-mono font-semibold ${productMeta[sku.productKey].cbmClass}`}
              inputClassName="w-32"
              onChange={(value) => updateRow(sku.masterSku, { cbmPerUnit: value })}
            />
            <EditableNumber
              active={editingSku === sku.masterSku}
              value={sku.moq}
              decimals={0}
              onChange={(value) => updateRow(sku.masterSku, { moq: value })}
            />
            <EditableNumber
              active={editingSku === sku.masterSku}
              value={sku.orderMultiple}
              decimals={0}
              onChange={(value) => updateRow(sku.masterSku, { orderMultiple: value })}
            />
            <EditableNumber
              active={editingSku === sku.masterSku}
              value={sku.caseQty}
              decimals={0}
              onChange={(value) => updateRow(sku.masterSku, { caseQty: value })}
            />
            <div className="flex min-w-0 flex-nowrap justify-end gap-2 px-4 py-3">
              {editingSku === sku.masterSku ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    cancelEditing();
                  }}
                  className="whitespace-nowrap rounded-md border border-[#cccac4] bg-white px-2.5 py-1 text-xs hover:bg-[#f0eee9]"
                >
                  {pick("취소", "Cancel")}
                </button>
              ) : null}
              {canViewPriceHistory && editingSku !== sku.masterSku ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedPriceSku(sku);
                  }}
                  className="whitespace-nowrap rounded-md border border-[#cccac4] bg-white px-2.5 py-1 text-xs font-medium text-[#1d3fb7] hover:bg-[#f0eee9]"
                >
                  {pick("가격 이력", "Price")}
                </button>
              ) : null}
              <button
                type="button"
                onClick={async (event) => {
                  event.stopPropagation();
                  if (editingSku === sku.masterSku) {
                    const saved = await saveRow(sku);
                    if (saved) {
                      setEditingSku(null);
                      setEditingSnapshot(null);
                      setMessage(pick(`${sku.masterSku} 저장됨`, `Saved ${sku.masterSku}`));
                    }
                  } else {
                    startEditing(sku);
                  }
                }}
                className="whitespace-nowrap rounded-md border border-[#cccac4] bg-white px-2.5 py-1 text-xs hover:bg-[#f0eee9]"
              >
                {editingSku === sku.masterSku ? pick("완료", "Done") : pick("편집", "Edit")}
              </button>
            </div>
          </div>
        ))}

        {visibleSkus.length === 0 ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center gap-2 text-muted-foreground">
            <Search className="h-10 w-10 opacity-40" aria-hidden="true" />
            <div className="text-sm font-medium">{loading ? pick("SKU 마스터 불러오는 중...", "Loading SKU master...") : pick("일치하는 SKU 없음", "No matching SKUs")}</div>
            <div className="text-xs">
              {loading ? pick("fc_products 읽는 중", "Reading fc_products") : pick("재고 동기화를 클릭하거나 SKU 검색어를 변경하세요.", "Click Sync Inventory or change the SKU search term.")}
            </div>
          </div>
        ) : null}
      </div>
      {message ? (
        <div className="border-t border-[#e2dfd8] bg-white px-5 py-2 text-xs text-muted-foreground">{message}</div>
      ) : null}
    </section>
    <SkuPriceHistoryDrawer
      open={Boolean(selectedPriceSku)}
      sku={selectedPriceSku?.masterSku ?? null}
      productLabel={selectedPriceSku ? productMeta[selectedPriceSku.productKey].label : undefined}
      onClose={() => setSelectedPriceSku(null)}
    />
    </>
  );
}

function formatCsvCell(value: string | number) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function SkuStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="border-r border-[#e2dfd8] px-5 py-3 last:border-r-0 dark:border-slate-700">
      <div className="text-[10px] uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function ProductBadge({ product }: { product: ProductKey }) {
  const meta = productMeta[product];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-[11px] font-semibold ${meta.badgeClass}`}>
      {meta.label}
    </span>
  );
}

function StatusBadge({ status }: { status: SkuStatus }) {
  const { pick } = useI18n();
  const active = status === "active";
  return (
    <span
      className={
        `inline-flex rounded-lg px-2 py-0.5 text-[11px] font-semibold ` +
        (active
          ? "bg-[#dcefe8] text-[#047857] dark:bg-emerald-950/70 dark:text-emerald-300"
          : "bg-[#eee9df] text-[#7a7061] dark:bg-stone-900/70 dark:text-stone-300")
      }
    >
      {active ? pick("활성", "Active") : pick("비활성", "Inactive")}
    </span>
  );
}

function EditableStatus({
  active,
  value,
  onChange,
}: {
  active: boolean;
  value: SkuStatus;
  onChange: (value: SkuStatus) => void;
}) {
  const { pick } = useI18n();
  if (active) {
    return (
      <div className="px-4 py-3">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value as SkuStatus)}
          className="h-8 rounded-md border border-[#cccac4] bg-white px-2 text-xs outline-none focus:border-[#1a5cdb]"
        >
          <option value="active">{pick("활성", "Active")}</option>
          <option value="inactive">{pick("비활성", "Inactive")}</option>
        </select>
      </div>
    );
  }

  return (
    <div className="px-4 py-3">
      <StatusBadge status={value} />
    </div>
  );
}

const SALES_STATUS_OPTIONS: SalesStatus[] = ["Original", "Custom", "Hold", "Part", "Discontinued", "TBD", "SWC"];

function EditableSalesStatus({
  active,
  value,
  onChange,
}: {
  active: boolean;
  value: SalesStatus | null;
  onChange: (value: SalesStatus | null) => void;
}) {
  if (active) {
    return (
      <div className="px-4 py-3">
        <select
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value as SalesStatus)}
          className="h-8 rounded-md border border-[#cccac4] bg-white px-2 text-xs outline-none focus:border-[#1a5cdb]"
        >
          <option value="">—</option>
          {SALES_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
    );
  }

  const badge: Record<SalesStatus, string> = {
    Original:     "bg-gray-100 text-gray-600",
    Custom:       "bg-blue-100 text-blue-700",
    Hold:         "bg-amber-100 text-amber-700",
    Part:         "bg-purple-100 text-purple-700",
    Discontinued: "bg-red-100 text-red-600",
    TBD:          "bg-slate-100 text-slate-500",
    SWC:          "bg-orange-50 text-orange-700",
  };

  return (
    <div className="px-4 py-3">
      {value ? (
        <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${badge[value]}`}>
          {value}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      )}
    </div>
  );
}

function ImportPreviewStat({
  label,
  value,
  className = "",
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div className={`px-5 py-3 ${className}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide">{label}</div>
      <div className="mt-0.5 font-mono text-xl font-bold">{numberFormatter.format(value)}</div>
    </div>
  );
}

function ImportValueChange({
  current,
  next,
  changed,
  decimals = 0,
}: {
  current: number | null;
  next: number | null;
  changed: boolean;
  decimals?: number;
}) {
  const format = (value: number | null) => value == null
    ? "—"
    : decimals > 0
      ? value.toFixed(decimals)
      : numberFormatter.format(value);

  return (
    <td className={`px-4 py-3 font-mono ${changed ? "bg-amber-50" : ""}`}>
      {changed ? (
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <span className="text-slate-400 line-through">{format(current)}</span>
          <span className="text-slate-400">→</span>
          <span className="font-semibold text-blue-700">{format(next)}</span>
        </span>
      ) : (
        <span className="text-slate-600">{format(next)}</span>
      )}
    </td>
  );
}

function EditableNumber({
  active,
  value,
  decimals,
  suffix,
  className = "",
  inputClassName = "w-20",
  compact = false,
  onChange,
}: {
  active: boolean;
  value: number;
  decimals: number;
  suffix?: string;
  className?: string;
  inputClassName?: string;
  compact?: boolean;
  onChange: (value: number) => void;
}) {
  if (active) {
    return (
      <div className={`${compact ? "" : "px-4 py-3"} inline-flex min-w-0 items-center whitespace-nowrap`}>
        <input
          type="number"
          step={decimals === 0 ? 1 : 10 ** -decimals}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className={`h-8 ${inputClassName} shrink-0 rounded-md border border-[#cccac4] bg-white px-2 text-sm outline-none focus:border-[#1a5cdb]`}
        />
        {suffix ? <span className="ml-1 whitespace-nowrap text-xs text-muted-foreground">{suffix}</span> : null}
      </div>
    );
  }

  return (
    <div className={`${compact ? "" : "px-4 py-3"} whitespace-nowrap`}>
      <span className={className}>{value.toFixed(decimals)}</span>
      {suffix ? <span className="ml-0.5 whitespace-nowrap text-xs text-muted-foreground">{suffix}</span> : null}
    </div>
  );
}
