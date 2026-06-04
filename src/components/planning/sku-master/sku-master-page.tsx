"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import * as XLSX from "xlsx";
import type { ProductKey } from "@/features/planning/mock-data";

type SkuMasterRow = {
  masterSku: string;
  productName: string;
  productKey: ProductKey;
  category: string;
  categoryCode: string;
  status: SkuStatus;
  moq: number;
  orderMultiple: number;
  cbmPerUnit: number;
  caseQty: number;
  weightKg: number;
  isCustomSku: boolean;
};

type SkuStatus = "active" | "inactive";
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
};

const numberFormatter = new Intl.NumberFormat("en-US");

type ExcelCbmImportRow = {
  masterSku: string;
  cbmPerUnit: number;
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

function extractExcelCbmRows(workbook: XLSX.WorkBook): ExcelCbmImportRow[] {
  const rowsBySku = new Map<string, ExcelCbmImportRow & { precision: number; sheetPriority: number }>();

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

      if (cbmIndex < 0) continue;

      for (let dataRowIndex = rowIndex + 1; dataRowIndex < matrix.length; dataRowIndex += 1) {
        const dataRow = matrix[dataRowIndex];
        const masterSku = String(dataRow[masterSkuIndex] ?? "").trim().toUpperCase();
        const cbmPerUnit = parseNumberCell(dataRow[cbmIndex]);

        if (!masterSku || !masterSku.includes("-")) continue;
        if (cbmPerUnit == null || cbmPerUnit <= 0) continue;

        const precision = decimalPlaces(cbmPerUnit);
        const existing = rowsBySku.get(masterSku);
        if (
          !existing ||
          sheetPriority < existing.sheetPriority ||
          (sheetPriority === existing.sheetPriority && precision > existing.precision)
        ) {
          rowsBySku.set(masterSku, { masterSku, cbmPerUnit, precision, sheetPriority });
        }
      }

      break;
    }
  }

  return [...rowsBySku.values()].map(({ masterSku, cbmPerUnit }) => ({ masterSku, cbmPerUnit }));
}

export function SkuMasterPage() {
  const [rows, setRows] = useState<SkuMasterRow[]>([]);
  const [query, setQuery] = useState("");
  const [product, setProduct] = useState<ProductKey | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [summaryCollapsed, setSummaryCollapsed] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
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
      params.set("page", String(page));
      params.set("limit", String(limit));
      const res = await fetch(`/api/planning/sku-master?${params.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Failed to load SKU master");
      setRows(json.data);
      setPagination(json.pagination ?? { page, limit, total: json.data.length, totalPages: 1 });
    } catch (error) {
      setRows([]);
      setMessage(error instanceof Error ? error.message : "Failed to load SKU master");
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
  }, [query, product, statusFilter, page, limit]);

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

  function updateRow(
    masterSku: string,
    patch: Partial<Pick<SkuMasterRow, "cbmPerUnit" | "moq" | "caseQty" | "weightKg" | "status">>
  ) {
    setRows((current) => current.map((sku) => (sku.masterSku === masterSku ? { ...sku, ...patch } : sku)));
  }

  async function saveRow(row: SkuMasterRow) {
    const res = await fetch("/api/planning/sku-master", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        masterSku: row.masterSku,
        cbmPerUnit: row.cbmPerUnit,
        moq: row.moq,
        caseQty: row.caseQty,
        weightKg: row.weightKg,
        status: row.status,
      }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error ?? "Failed to save SKU");
  }

  async function syncFromInventory() {
    setSyncing(true);
    setMessage("");
    try {
      const res = await fetch("/api/planning/sku-master", { method: "POST" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Failed to sync SKU master");
      setMessage(`Synced ${json.upserted ?? 0} SKUs from coverland_inventory`);
      await fetchRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to sync SKU master");
    } finally {
      setSyncing(false);
    }
  }

  async function importExcel(file: File) {
    setImporting(true);
    setMessage("");

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const importRows = extractExcelCbmRows(workbook);

      if (importRows.length === 0) {
        throw new Error("No valid Master SKU / CBM rows found in the Excel file");
      }

      const res = await fetch("/api/planning/sku-master", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: importRows }),
      });
      const json = await res.json();

      if (!json.success) throw new Error(json.error ?? "Failed to import Excel");

      setMessage(
        `Imported ${numberFormatter.format(json.imported ?? importRows.length)} CBM rows ` +
        `(${numberFormatter.format(json.updated ?? 0)} updated, ${numberFormatter.format(json.inserted ?? 0)} inserted)`
      );
      await fetchRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to import Excel");
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
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
        params.set("page", String(exportPage));
        params.set("limit", String(exportLimit));

        const res = await fetch(`/api/planning/sku-master?${params.toString()}`, { cache: "no-store" });
        const json = await res.json();
        if (!json.success) throw new Error(json.error ?? "Failed to export SKU master");
        exportRows.push(...json.data);
      }

      const headers = [
        "product_type",
        "sku_type",
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
            sku.isCustomSku ? "Custom" : "Original",
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
      setMessage(`Downloaded ${numberFormatter.format(exportRows.length)} SKUs as CSV`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to download CSV");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section className="sku-master-fullbleed flex min-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0] shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] bg-white px-5 py-4">
        <div>
          <h1 className="text-lg font-semibold">SKU Master Management</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Manage CBM and MOQ. Click Edit to update values inline.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Search SKU..."
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
              <span>Reset</span>
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
            <option value="all">All</option>
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
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All Status</option>
          </select>
          <button
            type="button"
            onClick={downloadCsv}
            disabled={downloading}
            className="h-9 rounded-md border border-[#cccac4] bg-white px-3 text-xs font-medium hover:bg-[#f0eee9]"
          >
            {downloading ? "Downloading..." : "Download CSV"}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importExcel(file);
            }}
          />
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            disabled={importing}
            className="h-9 rounded-md border border-[#cccac4] bg-white px-3 text-xs font-medium hover:bg-[#f0eee9] disabled:opacity-50"
          >
            {importing ? "Importing..." : "Excel Import"}
          </button>
          <button
            type="button"
            onClick={syncFromInventory}
            disabled={syncing || importing}
            className="h-9 rounded-md bg-[#1a5cdb] px-4 text-xs font-semibold text-white hover:bg-[#1650c4]"
          >
            {syncing ? "Syncing..." : "Sync Inventory"}
          </button>
        </div>
      </header>

      <div className="border-b border-[#e2dfd8] bg-[#f0eee9]">
        <button
          type="button"
          onClick={() => setSummaryCollapsed((current) => !current)}
          className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-2 text-left transition-colors hover:bg-[#ebe8df]"
          aria-expanded={!summaryCollapsed}
        >
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="font-semibold text-[#1a1917]">Summary</span>
            <span className="text-muted-foreground">
              Total <span className="font-mono font-semibold text-foreground">{numberFormatter.format(pagination.total)}</span>
            </span>
            <span className="text-muted-foreground">
              Page <span className="font-mono font-semibold text-foreground">{numberFormatter.format(visibleSkus.length)}</span>
            </span>
            <span className="text-muted-foreground">
              Missing CBM <span className="font-mono font-semibold text-foreground">{stats.missingCbm}</span>
            </span>
            <span className="text-muted-foreground">
              Avg CBM <span className="font-mono font-semibold text-foreground">{stats.averageCbm.toFixed(6)}</span>
            </span>
            <span className="text-muted-foreground">
              Types <span className="font-mono font-semibold text-foreground">{stats.productTypes}</span>
            </span>
          </span>
          {summaryCollapsed ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </button>
        {!summaryCollapsed ? (
          <div className="grid grid-cols-2 border-t border-[#e2dfd8] md:grid-cols-4">
            <SkuStat
              label="Total SKUs"
              value={numberFormatter.format(pagination.total)}
              sub={loading ? "Loading..." : `${numberFormatter.format(visibleSkus.length)} on this page`}
            />
            <SkuStat
              label="Missing CBM"
              value={stats.missingCbm.toString()}
              sub={stats.missingCbm ? "Needs review" : "All entered"}
            />
            <SkuStat label="Average CBM" value={stats.averageCbm.toFixed(6)} sub="m3 / unit" />
            <SkuStat label="Product Types" value={stats.productTypes.toString()} sub="types" />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2dfd8] bg-white px-5 py-2 text-xs text-muted-foreground">
        <div>
          Showing{" "}
          <span className="font-semibold text-foreground">
            {pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1}
            {" - "}
            {Math.min(pagination.page * pagination.limit, pagination.total)}
          </span>{" "}
          of <span className="font-semibold text-foreground">{pagination.total}</span>
        </div>
        <div className="flex items-center gap-2">
          <span>Rows</span>
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
            Prev
          </button>
          <span className="min-w-20 text-center">
            Page <span className="font-semibold text-foreground">{pagination.page}</span> / {pagination.totalPages}
          </span>
          <button
            type="button"
            disabled={loading || pagination.page >= pagination.totalPages}
            onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}
            className="rounded-md border border-[#cccac4] bg-white px-3 py-1.5 font-medium text-foreground hover:bg-[#f0eee9] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-white">
        <div className="grid min-w-[920px] grid-cols-[190px_310px_130px_150px_100px_100px] border-b border-[#e2dfd8] bg-white text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
          <div className="px-4 py-3">Product</div>
          <div className="px-4 py-3">Master SKU</div>
          <div className="px-4 py-3">Status</div>
          <div className="px-4 py-3">CBM / Unit</div>
          <div className="px-4 py-3">MOQ</div>
          <div className="px-4 py-3 text-right">Actions</div>
        </div>

        {visibleSkus.map((sku) => (
          <div
            key={sku.masterSku}
            className="grid min-w-[920px] grid-cols-[190px_310px_130px_150px_100px_100px] items-center border-b border-[#e2dfd8] text-sm last:border-b-0"
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
            <EditableNumber
              active={editingSku === sku.masterSku}
              value={sku.cbmPerUnit}
              decimals={6}
              className={`font-mono font-semibold ${productMeta[sku.productKey].cbmClass}`}
              onChange={(value) => updateRow(sku.masterSku, { cbmPerUnit: value })}
            />
            <EditableNumber
              active={editingSku === sku.masterSku}
              value={sku.moq}
              decimals={0}
              onChange={(value) => updateRow(sku.masterSku, { moq: value })}
            />
            <div className="flex min-w-0 flex-nowrap justify-end px-4 py-3">
              <button
                type="button"
                onClick={async () => {
                  if (editingSku === sku.masterSku) {
                    try {
                      await saveRow(sku);
                      setEditingSku(null);
                      setMessage(`Saved ${sku.masterSku}`);
                    } catch (error) {
                      window.alert(error instanceof Error ? error.message : "Failed to save SKU");
                    }
                  } else {
                    setEditingSku(sku.masterSku);
                  }
                }}
                className="whitespace-nowrap rounded-md border border-[#cccac4] bg-white px-2.5 py-1 text-xs hover:bg-[#f0eee9]"
              >
                {editingSku === sku.masterSku ? "Done" : "Edit"}
              </button>
            </div>
          </div>
        ))}

        {visibleSkus.length === 0 ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center gap-2 text-muted-foreground">
            <div className="text-4xl opacity-50">⌕</div>
            <div className="text-sm font-medium">{loading ? "Loading SKU master..." : "No matching SKUs"}</div>
            <div className="text-xs">
              {loading ? "Reading fc_products" : "Click Sync Inventory or change the SKU search term."}
            </div>
          </div>
        ) : null}
      </div>
      {message ? (
        <div className="border-t border-[#e2dfd8] bg-white px-5 py-2 text-xs text-muted-foreground">{message}</div>
      ) : null}
    </section>
  );
}

function formatCsvCell(value: string | number) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function SkuStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="border-r border-[#e2dfd8] px-5 py-3 last:border-r-0">
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
      {active ? "Active" : "Inactive"}
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
  if (active) {
    return (
      <div className="px-4 py-3">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value as SkuStatus)}
          className="h-8 rounded-md border border-[#cccac4] bg-white px-2 text-xs outline-none focus:border-[#1a5cdb]"
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
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

function EditableNumber({
  active,
  value,
  decimals,
  suffix,
  className = "",
  compact = false,
  onChange,
}: {
  active: boolean;
  value: number;
  decimals: number;
  suffix?: string;
  className?: string;
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
          className="h-8 w-20 shrink-0 rounded-md border border-[#cccac4] bg-white px-2 text-sm outline-none focus:border-[#1a5cdb]"
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
