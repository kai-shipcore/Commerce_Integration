"use client";

/**
 * Code Guide:
 * Inventory Management page: every SKU in SKU Master, active and inactive, with
 * its stock split by warehouse. Demand Planning shows active SKUs only; this is
 * where TBD and Discontinued SKUs are reviewed. A row whose stock comes from
 * another SKU says so under the SKU, with the source SKU and the units.
 * Read-only: Status and Sales Status are edited in SKU Master.
 */

import { useEffect, useMemo, useState } from "react";
import { PackageSearch } from "lucide-react";
import * as XLSX from "xlsx";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

type StockQty = { onHand: number; available: number };
type WarehouseKey = "fullerton" | "canary" | "dreamTrans" | "linkone" | "ttm" | "ttmJefferson" | "other";
type StockByWarehouse = Record<WarehouseKey, StockQty>;
type StockSource = { sku: string; total: StockQty; warehouses: StockByWarehouse };

type InventoryRow = {
  masterSku: string;
  productName: string | null;
  categoryCode: string | null;
  category: string | null;
  status: string;
  salesStatus: string | null;
  originalOrCustom: string;
  warehouses: StockByWarehouse;
  total: StockQty;
  mergedFrom: StockSource[];
  demandPlanningAddsFrom: StockSource[];
};

type Measure = keyof StockQty;
type SortColumn = "type" | "sku" | "status" | "salesStatus" | "salesType" | "total" | WarehouseKey;
type SortDirection = "asc" | "desc";

const WAREHOUSE_COLUMNS: Array<{ key: WarehouseKey; label: string }> = [
  { key: "fullerton", label: "Fullerton" },
  { key: "canary", label: "Canary" },
  { key: "dreamTrans", label: "Dream Trans" },
  { key: "linkone", label: "Linkone" },
  { key: "ttm", label: "TTM" },
  { key: "ttmJefferson", label: "TTM Jeff." },
  { key: "other", label: "Other" },
];

/** A SKU with no Hold / Discontinued / TBD set is in production. */
const IN_PRODUCTION = "In Production";
const PAGE_SIZE = 200;
const numberFormat = new Intl.NumberFormat("en-US");

function salesStatusOf(row: InventoryRow): string {
  return row.salesStatus ?? IN_PRODUCTION;
}

function sortValue(row: InventoryRow, column: SortColumn, measure: Measure): string | number {
  switch (column) {
    case "type": return row.categoryCode ?? "";
    case "sku": return row.masterSku;
    case "status": return row.status;
    case "salesStatus": return salesStatusOf(row);
    case "salesType": return row.originalOrCustom;
    case "total": return row.total[measure];
    default: return row.warehouses[column][measure];
  }
}

function distinct(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function InventoryManagementPage() {
  const { pick } = useI18n();
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [stockAvailable, setStockAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [salesStatusFilter, setSalesStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [salesTypeFilter, setSalesTypeFilter] = useState("all");
  const [onlyFromOtherSku, setOnlyFromOtherSku] = useState(false);
  const [onlyWithStock, setOnlyWithStock] = useState(false);
  const [measure, setMeasure] = useState<Measure>("available");
  const [sortColumn, setSortColumn] = useState<SortColumn>("sku");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [page, setPage] = useState(0);

  const loadFailed = pick("재고 목록을 불러오지 못했습니다.", "Failed to load inventory.");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(apiPath("/api/planning/inventory-management"), { cache: "no-store" });
        const json = await response.json() as {
          success: boolean;
          data?: { rows: InventoryRow[]; stockAvailable: boolean };
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !json.success || !json.data) throw new Error(json.error ?? loadFailed);
        setRows(json.data.rows);
        setStockAvailable(json.data.stockAvailable);
        setError(null);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : loadFailed);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Loaded once; the failure text only matters at that moment.
  }, []);

  const typeOptions = useMemo(() => distinct(rows.map((row) => row.categoryCode ?? "").filter(Boolean)), [rows]);
  const salesStatusOptions = useMemo(() => distinct(rows.map(salesStatusOf)), [rows]);
  const salesTypeOptions = useMemo(() => distinct(rows.map((row) => row.originalOrCustom)), [rows]);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (salesStatusFilter !== "all" && salesStatusOf(row) !== salesStatusFilter) return false;
      if (typeFilter !== "all" && row.categoryCode !== typeFilter) return false;
      if (salesTypeFilter !== "all" && row.originalOrCustom !== salesTypeFilter) return false;
      if (onlyFromOtherSku && row.mergedFrom.length === 0 && row.demandPlanningAddsFrom.length === 0) return false;
      if (onlyWithStock && row.total.onHand === 0 && row.total.available === 0) return false;
      if (!needle) return true;
      return row.masterSku.toLowerCase().includes(needle)
        || (row.productName ?? "").toLowerCase().includes(needle)
        || row.mergedFrom.some((source) => source.sku.toLowerCase().includes(needle))
        || row.demandPlanningAddsFrom.some((source) => source.sku.toLowerCase().includes(needle));
    });
    const sign = sortDirection === "asc" ? 1 : -1;
    return filtered.sort((a, b) => {
      const left = sortValue(a, sortColumn, measure);
      const right = sortValue(b, sortColumn, measure);
      const order = typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right));
      return (order || a.masterSku.localeCompare(b.masterSku)) * sign;
    });
  }, [measure, onlyFromOtherSku, onlyWithStock, query, rows, salesStatusFilter, salesTypeFilter, sortColumn, sortDirection, statusFilter, typeFilter]);

  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = visibleRows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const counts = useMemo(() => ({
    total: rows.length,
    active: rows.filter((row) => row.status === "active").length,
    inactive: rows.filter((row) => row.status !== "active").length,
    fromOtherSku: rows.filter((row) => row.mergedFrom.length > 0 || row.demandPlanningAddsFrom.length > 0).length,
  }), [rows]);

  function toggleSort(column: SortColumn) {
    if (column === sortColumn) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      // Quantities are most useful largest first; text reads A to Z.
      const numeric = column === "total" || WAREHOUSE_COLUMNS.some((warehouse) => warehouse.key === column);
      setSortDirection(numeric ? "desc" : "asc");
    }
    setPage(0);
  }

  function sourceNote(source: StockSource): string {
    return `${source.sku} (${numberFormat.format(source.total[measure])})`;
  }

  function exportRows() {
    const sheet = XLSX.utils.json_to_sheet(visibleRows.map((row) => ({
      "Product Type": row.categoryCode ?? "",
      "SKU": row.masterSku,
      "Product Name": row.productName ?? "",
      "Status": row.status,
      "Sales Status": salesStatusOf(row),
      "Original/Custom": row.originalOrCustom,
      ...Object.fromEntries(WAREHOUSE_COLUMNS.flatMap((warehouse) => [
        [`${warehouse.label} On Hand`, row.warehouses[warehouse.key].onHand],
        [`${warehouse.label} Available`, row.warehouses[warehouse.key].available],
      ])),
      "Total On Hand": row.total.onHand,
      "Total Available": row.total.available,
      "Includes stock from": row.mergedFrom.map((source) => `${source.sku} (${source.total.onHand} on hand / ${source.total.available} available)`).join(", "),
      "Demand Planning adds from": row.demandPlanningAddsFrom.map((source) => `${source.sku} (${source.total.onHand} on hand / ${source.total.available} available)`).join(", "),
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Inventory");
    XLSX.writeFile(workbook, "Inventory Management.xlsx");
  }

  const gridCols = "grid-cols-[56px_minmax(250px,1.6fr)_minmax(150px,1fr)_84px_116px_92px_repeat(8,84px)]";
  const selectClass = "form-input h-9 bg-white text-xs";
  const resetPage = () => setPage(0);

  return (
    <section className="flex min-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] px-6 py-4">
        <div className="flex items-start gap-2">
          <PackageSearch className="mt-1 h-5 w-5" />
          <div>
            <h1 className="text-lg font-semibold">{pick("재고 관리", "Inventory Management")}</h1>
            <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
              {pick(
                "SKU Master의 모든 SKU(Active, Inactive)의 창고별 재고입니다. 다른 SKU에서 온 재고는 SKU 아래에 표시됩니다. Status와 Sales Status는 SKU Master에서 수정합니다.",
                "Stock by warehouse for every SKU in SKU Master, active and inactive. Stock that comes from another SKU is noted under the SKU. Status and Sales Status are edited in SKU Master.",
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-[#e2dfd8] text-xs font-semibold">
            {(["available", "onHand"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={measure === option}
                onClick={() => setMeasure(option)}
                className={`h-9 px-3 ${measure === option ? "bg-[#1a5cdb] text-white" : "bg-white text-muted-foreground hover:bg-[#f0eee9]"}`}
              >
                {option === "available" ? "Available" : "On Hand"}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={loading || visibleRows.length === 0}
            onClick={exportRows}
            className="h-9 rounded-md border border-[#e2dfd8] bg-white px-3 text-xs font-medium hover:bg-[#f0eee9] disabled:opacity-50"
          >
            {pick("엑셀 내보내기", "Excel Export")}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-4 border-b border-[#e2dfd8] bg-[#f8f7f4]">
        <Stat label={pick("전체 SKU", "All SKUs")} value={counts.total} />
        <Stat label="Active" value={counts.active} />
        <Stat label="Inactive" value={counts.inactive} />
        <Stat label={pick("다른 SKU 재고 포함", "With stock from another SKU")} value={counts.fromOtherSku} tone="source" />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-[#e2dfd8] bg-[#f8f7f4] px-5 py-3">
        <input
          className="form-input h-9 w-64 bg-white text-sm"
          placeholder={pick("SKU / 제품명 검색...", "Search SKU / product...")}
          value={query}
          onChange={(event) => { setQuery(event.target.value); resetPage(); }}
        />
        <select aria-label="Product Type" className={selectClass} value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); resetPage(); }}>
          <option value="all">{pick("제품 유형: 전체", "Product Type: All")}</option>
          {typeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <select aria-label="Status" className={selectClass} value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); resetPage(); }}>
          <option value="all">{pick("Status: 전체", "Status: All")}</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select aria-label="Sales Status" className={selectClass} value={salesStatusFilter} onChange={(event) => { setSalesStatusFilter(event.target.value); resetPage(); }}>
          <option value="all">{pick("Sales Status: 전체", "Sales Status: All")}</option>
          {salesStatusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <select aria-label="Original/Custom" className={selectClass} value={salesTypeFilter} onChange={(event) => { setSalesTypeFilter(event.target.value); resetPage(); }}>
          <option value="all">{pick("Original/Custom: 전체", "Original/Custom: All")}</option>
          {salesTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={onlyWithStock} onChange={(event) => { setOnlyWithStock(event.target.checked); resetPage(); }} />
          {pick("재고 있는 SKU만", "With stock only")}
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={onlyFromOtherSku} onChange={(event) => { setOnlyFromOtherSku(event.target.checked); resetPage(); }} />
          {pick("다른 SKU 재고 포함만", "Stock from another SKU only")}
        </label>
      </div>

      {error ? <div className="border-b border-[#e2dfd8] px-6 py-2 text-xs text-[#c42b2b]">{error}</div> : null}
      {!loading && !error && !stockAvailable ? (
        <div className="border-b border-[#e2dfd8] px-6 py-2 text-xs text-[#8a5300]">
          {pick(
            "창고 재고 데이터를 읽지 못했습니다. 재고 수량은 0으로 표시됩니다.",
            "The warehouse stock feed could not be read. Quantities are shown as 0.",
          )}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
        <div className={`grid ${gridCols} min-w-[1480px] bg-[#f0eee9] px-3 py-2 text-[11px] font-semibold uppercase text-muted-foreground`}>
          <SortHeader label={pick("유형", "Type")} column="type" sortColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
          <SortHeader label="SKU" column="sku" sortColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
          <span>{pick("제품명", "Product")}</span>
          <SortHeader label="Status" column="status" sortColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
          <SortHeader label="Sales Status" column="salesStatus" sortColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
          <SortHeader label="Orig/Custom" column="salesType" sortColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
          {WAREHOUSE_COLUMNS.map((warehouse) => (
            <SortHeader key={warehouse.key} label={warehouse.label} column={warehouse.key} sortColumn={sortColumn} direction={sortDirection} onSort={toggleSort} align="right" />
          ))}
          <SortHeader label={pick("합계", "Total")} column="total" sortColumn={sortColumn} direction={sortDirection} onSort={toggleSort} align="right" />
        </div>
        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">{pick("불러오는 중...", "Loading...")}</div>
        ) : pageRows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            {pick("조건에 맞는 SKU가 없습니다.", "No SKUs match the current filter.")}
          </div>
        ) : (
          pageRows.map((row) => {
            const inactive = row.status !== "active";
            const salesStatus = salesStatusOf(row);
            return (
              <div key={row.masterSku} className={`grid ${gridCols} min-w-[1480px] items-start border-b border-[#e2dfd8] px-3 py-2 text-sm ${inactive ? "bg-[#fafaf8]" : ""}`}>
                <span className="font-mono text-xs text-muted-foreground">{row.categoryCode ?? "-"}</span>
                <span className="min-w-0 pr-3">
                  <span className="block truncate font-mono text-xs" title={row.masterSku}>{row.masterSku}</span>
                  {row.mergedFrom.length > 0 ? (
                    <span className="mt-0.5 block text-[11px] leading-tight text-[#1a5cdb]">
                      {pick("다른 SKU 재고 포함: ", "Includes stock from ")}
                      <span className="font-mono">{row.mergedFrom.map(sourceNote).join(", ")}</span>
                    </span>
                  ) : null}
                  {row.demandPlanningAddsFrom.length > 0 ? (
                    <span className="mt-0.5 block text-[11px] leading-tight text-[#b45309]">
                      {pick("Demand Planning에서 추가로 합산: ", "Demand Planning also adds ")}
                      <span className="font-mono">{row.demandPlanningAddsFrom.map(sourceNote).join(", ")}</span>
                    </span>
                  ) : null}
                </span>
                <span className="truncate pr-3 text-xs text-muted-foreground" title={row.productName ?? undefined}>{row.productName ?? "-"}</span>
                <span>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${inactive
                    ? "border-[#e2dfd8] bg-[#f0eee9] text-muted-foreground"
                    : "border-[#b7e0c4] bg-[#eefaf1] text-[#1a7f3c]"}`}
                  >
                    {inactive ? "Inactive" : "Active"}
                  </span>
                </span>
                <span>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${salesStatus === IN_PRODUCTION
                    ? "border-[#e2dfd8] bg-white text-muted-foreground"
                    : "border-[#f3d19c] bg-[#fff7e8] text-[#b45309]"}`}
                  >
                    {salesStatus}
                  </span>
                </span>
                <span className="text-xs">{row.originalOrCustom}</span>
                {WAREHOUSE_COLUMNS.map((warehouse) => {
                  const value = row.warehouses[warehouse.key][measure];
                  const fromOther = row.mergedFrom.some((source) => source.warehouses[warehouse.key][measure] !== 0);
                  return (
                    <span
                      key={warehouse.key}
                      title={fromOther ? row.mergedFrom
                        .filter((source) => source.warehouses[warehouse.key][measure] !== 0)
                        .map((source) => `${source.sku}: ${numberFormat.format(source.warehouses[warehouse.key][measure])}`)
                        .join("\n") : undefined}
                      className={`pr-3 text-right font-mono text-xs ${value === 0 ? "text-[#b8b4aa]" : ""} ${fromOther ? "font-semibold text-[#1a5cdb]" : ""}`}
                    >
                      {numberFormat.format(value)}
                    </span>
                  );
                })}
                <span className={`pr-3 text-right font-mono text-xs font-semibold ${row.total[measure] === 0 ? "text-[#b8b4aa]" : ""}`}>
                  {numberFormat.format(row.total[measure])}
                </span>
              </div>
            );
          })
        )}
      </div>

      <footer className="flex items-center justify-between border-t border-[#e2dfd8] px-6 py-2 text-xs text-muted-foreground">
        <span>
          {pick(`${numberFormat.format(visibleRows.length)}개 SKU`, `${numberFormat.format(visibleRows.length)} SKUs`)}
        </span>
        <span className="flex items-center gap-2">
          <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="h-8 rounded-md border border-[#e2dfd8] bg-white px-3 font-medium hover:bg-[#f0eee9] disabled:opacity-50">
            {pick("이전", "Previous")}
          </button>
          <span className="font-mono">{currentPage + 1} / {pageCount}</span>
          <button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)} className="h-8 rounded-md border border-[#e2dfd8] bg-white px-3 font-medium hover:bg-[#f0eee9] disabled:opacity-50">
            {pick("다음", "Next")}
          </button>
        </span>
      </footer>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "source" }) {
  return (
    <div className="border-r border-[#e2dfd8] px-6 py-3 last:border-r-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${tone === "source" ? "text-[#1a5cdb]" : ""}`}>{numberFormat.format(value)}</div>
    </div>
  );
}

function SortHeader({ label, column, sortColumn, direction, onSort, align = "left" }: {
  label: string;
  column: SortColumn;
  sortColumn: SortColumn;
  direction: SortDirection;
  onSort: (column: SortColumn) => void;
  align?: "left" | "right";
}) {
  const active = sortColumn === column;
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      className={`flex items-center gap-1 uppercase hover:text-foreground ${align === "right" ? "justify-end pr-3" : "text-left"} ${active ? "text-[#1a5cdb]" : ""}`}
    >
      <span>{label}</span>
      {active ? <span aria-hidden="true">{direction === "asc" ? "▲" : "▼"}</span> : null}
    </button>
  );
}
