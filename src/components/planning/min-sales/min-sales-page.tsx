"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpToLine } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { usePermissions } from "@/lib/hooks/use-permissions";

type MinSalesRow = {
  masterSku: string;
  minTotalAvgCurr: number;
  note: string | null;
  productName: string | null;
  categoryCode: string | null;
  calculatedTotalAvgCurr: number | null;
  totalAvgCurrOverride: number | null;
  updatedBy: string | null;
  updatedAt: string;
};

type MinSalesStatus = "override" | "applied" | "calculated";
type SortColumn = "masterSku" | "productName" | "calculated" | "minimum" | "status" | "updatedAt";
type SortDirection = "asc" | "desc";
type SaveRow = { masterSku: string; minTotalAvgCurr: number; note: string | null };

/**
 * Mirrors DemandPlanningService: a manual T.Avg override wins, otherwise the
 * minimum replaces a calculated value that falls below it. The calculated value
 * here is the stored stats figure, so it is a close reference, not the exact
 * number the dashboard recomputes at read time.
 */
function statusOf(row: MinSalesRow): MinSalesStatus {
  if (row.totalAvgCurrOverride !== null) return "override";
  if (row.calculatedTotalAvgCurr === null || row.calculatedTotalAvgCurr < row.minTotalAvgCurr) return "applied";
  return "calculated";
}

const STATUS_ORDER: Record<MinSalesStatus, number> = { applied: 0, override: 1, calculated: 2 };

function sortValue(row: MinSalesRow, column: SortColumn): string | number {
  switch (column) {
    case "productName": return row.productName ?? "";
    case "calculated": return row.calculatedTotalAvgCurr ?? -1;
    case "minimum": return row.minTotalAvgCurr;
    case "status": return STATUS_ORDER[statusOf(row)];
    case "updatedAt": return row.updatedAt;
    default: return row.masterSku;
  }
}

function formatAvg(value: number | null): string {
  if (value === null || value === undefined) return "-";
  return value.toFixed(2);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function parseMinimum(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeHeader(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const SKU_HEADERS = ["sku", "mastersku"];
const MIN_HEADERS = ["mintavg", "mintavgcurrent", "mintotalavgcurr", "minimum", "min", "minsales"];
const NOTE_HEADERS = ["note", "memo"];

function readWorkbook(workbook: XLSX.WorkBook): SaveRow[] {
  const result: SaveRow[] = [];
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1, blankrows: false, defval: "", raw: true,
    });
    const headerIndex = rows.findIndex((row) => {
      const headers = row.map(normalizeHeader);
      return headers.some((h) => SKU_HEADERS.includes(h)) && headers.some((h) => MIN_HEADERS.includes(h));
    });
    if (headerIndex < 0) continue;
    const headers = rows[headerIndex].map(normalizeHeader);
    const skuIndex = headers.findIndex((h) => SKU_HEADERS.includes(h));
    const minIndex = headers.findIndex((h) => MIN_HEADERS.includes(h));
    const noteIndex = headers.findIndex((h) => NOTE_HEADERS.includes(h));
    for (const row of rows.slice(headerIndex + 1)) {
      const masterSku = String(row[skuIndex] ?? "").trim().toUpperCase();
      const minimum = parseMinimum(String(row[minIndex] ?? ""));
      if (!masterSku || minimum === null) continue;
      const note = noteIndex >= 0 ? String(row[noteIndex] ?? "").trim() : "";
      result.push({ masterSku, minTotalAvgCurr: minimum, note: note || null });
    }
  }
  return result;
}

export function MinSalesPage() {
  const { pick } = useI18n();
  const { can } = usePermissions();
  const canEdit = can("min-sales", "edit");
  const canDelete = can("min-sales", "delete");

  const [rows, setRows] = useState<MinSalesRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<MinSalesStatus | "all">("all");
  const [form, setForm] = useState({ masterSku: "", minimum: "", note: "" });
  const [formProductName, setFormProductName] = useState<string | null>(null);
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ minimum: "", note: "" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortColumn, setSortColumn] = useState<SortColumn>("masterSku");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const loadFailed = pick("최소 판매량 목록을 불러오지 못했습니다.", "Failed to load minimum sales.");
  const saveFailed = pick("저장에 실패했습니다.", "Failed to save.");
  const noPermission = pick("이 작업을 수행할 권한이 없습니다.", "You don't have permission to perform this action.");

  async function loadRows() {
    setLoading(true);
    try {
      const response = await fetch(apiPath("/api/planning/sku-min-sales"), { cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error ?? loadFailed);
      setRows(json.data as MinSalesRow[]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : loadFailed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    const result = { total: rows.length, applied: 0, override: 0, calculated: 0 };
    for (const row of rows) result[statusOf(row)] += 1;
    return result;
  }, [rows]);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = rows.filter((row) =>
      (statusFilter === "all" || statusOf(row) === statusFilter) &&
      (!needle || `${row.masterSku} ${row.productName ?? ""} ${row.note ?? ""}`.toLowerCase().includes(needle))
    );
    const direction = sortDirection === "asc" ? 1 : -1;
    return filtered.sort((a, b) => {
      const left = sortValue(a, sortColumn);
      const right = sortValue(b, sortColumn);
      const compared = typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
      return compared === 0 ? a.masterSku.localeCompare(b.masterSku) : compared * direction;
    });
  }, [rows, query, statusFilter, sortColumn, sortDirection]);

  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((row) => selected.has(row.masterSku));

  function toggleSort(column: SortColumn) {
    if (sortColumn === column) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortColumn(column);
    setSortDirection("asc");
  }

  async function postRows(payload: SaveRow[]): Promise<{ inserted: number; updated: number }> {
    const response = await fetch(apiPath("/api/planning/sku-min-sales"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: payload }),
    });
    const json = await response.json();
    if (!response.ok || !json.success) throw new Error(json.error ?? saveFailed);
    return json.data as { inserted: number; updated: number };
  }

  async function lookupSku() {
    const sku = form.masterSku.trim().toUpperCase();
    setFormProductName(null);
    if (!sku) return;
    setForm((f) => ({ ...f, masterSku: sku }));
    try {
      const response = await fetch(apiPath(`/api/planning/sku-master?masterSku=${encodeURIComponent(sku)}`), { cache: "no-store" });
      // Without SKU Master access the lookup is skipped; the save still validates the SKU.
      if (response.status === 403) return;
      const json = await response.json();
      if (!response.ok || !json.success) {
        setMessage(pick(`SKU 마스터에서 SKU를 찾을 수 없습니다: ${sku}`, `SKU not found in SKU Master: ${sku}`));
        return;
      }
      setFormProductName((json.data?.productName as string | null) ?? null);
      const existing = rows.find((row) => row.masterSku === sku);
      setMessage(existing
        ? pick(
            `${sku}는 이미 등록되어 있습니다 (최소 ${formatAvg(existing.minTotalAvgCurr)}). 등록하면 값을 덮어씁니다.`,
            `${sku} is already registered (min ${formatAvg(existing.minTotalAvgCurr)}). Registering overwrites it.`,
          )
        : "");
    } catch {
      // Lookup is a convenience only.
    }
  }

  async function register() {
    if (!canEdit) { toast.error(noPermission); return; }
    const masterSku = form.masterSku.trim().toUpperCase();
    const minimum = parseMinimum(form.minimum);
    if (!masterSku || minimum === null) {
      setMessage(pick("SKU와 0 이상의 최소값을 입력하세요.", "Enter a SKU and a minimum of 0 or more."));
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await postRows([{ masterSku, minTotalAvgCurr: minimum, note: form.note.trim() || null }]);
      setForm({ masterSku: "", minimum: "", note: "" });
      setFormProductName(null);
      toast.success(pick(`${masterSku} 최소값을 저장했습니다.`, `Saved minimum for ${masterSku}.`));
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : saveFailed);
    } finally {
      setSaving(false);
    }
  }

  function beginEdit(row: MinSalesRow) {
    setEditingSku(row.masterSku);
    setEditForm({ minimum: String(row.minTotalAvgCurr), note: row.note ?? "" });
    setMessage("");
  }

  async function saveEdit(row: MinSalesRow) {
    if (!canEdit) { toast.error(noPermission); return; }
    const minimum = parseMinimum(editForm.minimum);
    if (minimum === null) {
      setMessage(pick("0 이상의 최소값을 입력하세요.", "Enter a minimum of 0 or more."));
      return;
    }
    setSaving(true);
    try {
      await postRows([{ masterSku: row.masterSku, minTotalAvgCurr: minimum, note: editForm.note.trim() || null }]);
      setEditingSku(null);
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : saveFailed);
    } finally {
      setSaving(false);
    }
  }

  async function remove(skus: string[]) {
    if (!canDelete) { toast.error(noPermission); return; }
    if (skus.length === 0) return;
    const confirmText = skus.length === 1
      ? pick(
          `${skus[0]} 최소값 등록을 삭제할까요? Demand Planning에는 계산값이 다시 표시됩니다.`,
          `Remove the minimum for ${skus[0]}? Demand Planning will show the calculated value again.`,
        )
      : pick(`선택한 ${skus.length}개 SKU의 최소값 등록을 삭제할까요?`, `Remove the minimum for ${skus.length} selected SKUs?`);
    if (!window.confirm(confirmText)) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(apiPath(`/api/planning/sku-min-sales?sku=${encodeURIComponent(skus.join(","))}`), { method: "DELETE" });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error ?? pick("삭제에 실패했습니다.", "Failed to delete."));
      setSelected(new Set());
      if (editingSku && skus.includes(editingSku)) setEditingSku(null);
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : pick("삭제에 실패했습니다.", "Failed to delete."));
    } finally {
      setSaving(false);
    }
  }

  async function importExcel(file: File) {
    if (!canEdit) { toast.error(noPermission); return; }
    setImporting(true);
    setMessage("");
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const importRows = readWorkbook(workbook);
      if (importRows.length === 0) {
        throw new Error(pick("엑셀에서 SKU / Min T.Avg 행을 찾지 못했습니다.", "No SKU / Min T.Avg rows were found in the Excel file."));
      }
      const result = await postRows(importRows);
      setMessage(pick(
        `${result.inserted}개 등록, ${result.updated}개 갱신했습니다.`,
        `Registered ${result.inserted}, updated ${result.updated}.`,
      ));
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : pick("엑셀 가져오기에 실패했습니다.", "Failed to import Excel."));
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  function downloadTemplate() {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["SKU", "Min T.Avg", "Note"],
      ["CA-SC-10-F-10-BK-1TO", 3, "Launch floor"],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Min Sales");
    XLSX.writeFile(workbook, "SKU Min Sales template.xlsx");
  }

  function exportRows() {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["SKU", "Product", "Calculated T.Avg", "Min T.Avg", "Note", "Updated By", "Updated At"],
      ...visibleRows.map((row) => [
        row.masterSku, row.productName ?? "", row.calculatedTotalAvgCurr ?? "", row.minTotalAvgCurr,
        row.note ?? "", row.updatedBy ?? "", formatDate(row.updatedAt),
      ]),
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Min Sales");
    XLSX.writeFile(workbook, "SKU Min Sales.xlsx");
  }

  const statusLabel = (status: MinSalesStatus) => status === "applied"
    ? pick("최소값 적용", "Min applied")
    : status === "override"
      ? pick("수동값 우선", "Manual override")
      : pick("계산값 사용", "Calculated");

  const gridCols = "grid-cols-[28px_44px_minmax(190px,1.2fr)_minmax(160px,1fr)_90px_90px_110px_minmax(140px,1fr)_140px_110px]";

  return (
    <section className="flex min-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] px-6 py-4">
        <div className="flex items-start gap-2">
          <ArrowUpToLine className="mt-1 h-5 w-5" />
          <div>
            <h1 className="text-lg font-semibold">{pick("SKU 최소 판매량", "SKU Minimum Sales")}</h1>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              {pick(
                "등록한 SKU의 T.Avg 현재가 최소값보다 낮으면 Demand Planning에서 최소값으로 표시되고 계획에 사용됩니다. 수동으로 입력한 T.Avg 값이 있으면 그 값이 우선합니다.",
                "When a registered SKU's T.Avg current falls below its minimum, Demand Planning shows and plans with the minimum instead. A manually entered T.Avg value still takes priority.",
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="form-input h-9 w-60 bg-white text-sm"
            placeholder={pick("SKU / 제품명 / 메모 검색...", "Search SKU / product / note...")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importExcel(file);
            }}
          />
          <button type="button" onClick={exportRows} disabled={visibleRows.length === 0} className="h-9 rounded-md border border-[#cccac4] bg-white px-3 text-xs font-medium hover:bg-[#f0eee9] disabled:opacity-50">
            {pick("엑셀 내보내기", "Export")}
          </button>
          {canEdit ? (
            <>
              <button type="button" onClick={downloadTemplate} className="h-9 rounded-md border border-[#cccac4] bg-white px-3 text-xs font-medium hover:bg-[#f0eee9]">
                {pick("템플릿 다운로드", "Download Template")}
              </button>
              <button type="button" disabled={importing || saving} onClick={() => importInputRef.current?.click()} className="h-9 rounded-md bg-[#1a5cdb] px-4 text-xs font-semibold text-white hover:bg-[#1650c4] disabled:opacity-50">
                {importing ? pick("가져오는 중...", "Importing...") : pick("엑셀 가져오기", "Excel Import")}
              </button>
            </>
          ) : null}
          {canDelete && selected.size > 0 ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void remove([...selected])}
              className="h-9 rounded-md border border-[#f2b8b5] bg-[#fff5f5] px-3 text-xs font-medium text-[#c42b2b] hover:bg-[#fee2e2] disabled:opacity-50"
            >
              {pick(`선택 삭제 (${selected.size})`, `Delete Selected (${selected.size})`)}
            </button>
          ) : null}
        </div>
      </header>

      <div className="grid grid-cols-4 border-b border-[#e2dfd8] bg-[#f8f7f4]">
        <StatButton label={pick("등록 SKU", "Registered SKUs")} value={counts.total} active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
        <StatButton label={statusLabel("applied")} value={counts.applied} tone="applied" active={statusFilter === "applied"} onClick={() => setStatusFilter("applied")} />
        <StatButton label={statusLabel("calculated")} value={counts.calculated} active={statusFilter === "calculated"} onClick={() => setStatusFilter("calculated")} />
        <StatButton label={statusLabel("override")} value={counts.override} tone="override" active={statusFilter === "override"} onClick={() => setStatusFilter("override")} />
      </div>

      {canEdit ? (
        <div className="border-b border-[#e2dfd8] bg-[#f8f7f4] px-5 py-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            {pick("최소값 등록", "Register Minimum")}
          </div>
          <div className="grid gap-2 md:grid-cols-[minmax(200px,1fr)_130px_minmax(160px,1fr)_auto]">
            <div>
              <input
                className="form-input h-8 w-full bg-white font-mono text-xs"
                placeholder={pick("마스터 SKU", "Master SKU")}
                value={form.masterSku}
                onChange={(event) => setForm((f) => ({ ...f, masterSku: event.target.value }))}
                onBlur={() => void lookupSku()}
              />
              {formProductName ? <div className="mt-1 truncate text-[11px] text-muted-foreground">{formProductName}</div> : null}
            </div>
            <input
              className="form-input h-8 w-full bg-white text-xs"
              type="number"
              step="any"
              min="0"
              placeholder={pick("최소 T.Avg 현재", "Min T.Avg current")}
              value={form.minimum}
              onChange={(event) => setForm((f) => ({ ...f, minimum: event.target.value }))}
              onKeyDown={(event) => { if (event.key === "Enter") void register(); }}
            />
            <input
              className="form-input h-8 w-full bg-white text-xs"
              placeholder={pick("메모 (선택)", "Note (optional)")}
              value={form.note}
              onChange={(event) => setForm((f) => ({ ...f, note: event.target.value }))}
              onKeyDown={(event) => { if (event.key === "Enter") void register(); }}
            />
            <button type="button" disabled={saving} onClick={() => void register()} className="h-8 rounded-md border border-[#1a5cdb] bg-white px-4 text-xs font-semibold text-[#1a5cdb] disabled:opacity-50">
              {pick("등록", "Register")}
            </button>
          </div>
        </div>
      ) : null}

      {message ? <div className="border-b border-[#e2dfd8] px-6 py-2 text-xs text-[#8a5300]">{message}</div> : null}

      <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
        <div className={`grid ${gridCols} min-w-[1100px] bg-[#f0eee9] px-3 py-2 text-[11px] font-semibold uppercase text-muted-foreground`}>
          <input
            type="checkbox"
            aria-label={pick("전체 선택", "Select all")}
            checked={allVisibleSelected}
            disabled={!canDelete || visibleRows.length === 0}
            onChange={(event) => setSelected(event.target.checked ? new Set(visibleRows.map((row) => row.masterSku)) : new Set())}
          />
          <span>{pick("번호", "No.")}</span>
          <SortHeader label={pick("마스터 SKU", "Master SKU")} column="masterSku" sortColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
          <SortHeader label={pick("제품명", "Product")} column="productName" sortColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
          <SortHeader label={pick("계산값", "Calculated")} column="calculated" sortColumn={sortColumn} direction={sortDirection} onSort={toggleSort} align="right" />
          <SortHeader label={pick("최소값", "Minimum")} column="minimum" sortColumn={sortColumn} direction={sortDirection} onSort={toggleSort} align="right" />
          <SortHeader label={pick("상태", "Status")} column="status" sortColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
          <span>{pick("메모", "Note")}</span>
          <SortHeader label={pick("수정", "Updated")} column="updatedAt" sortColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
          <span>{pick("작업", "Actions")}</span>
        </div>
        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">{pick("불러오는 중...", "Loading...")}</div>
        ) : visibleRows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            {rows.length === 0
              ? pick("등록된 SKU가 없습니다.", "No SKUs registered yet.")
              : pick("조건에 맞는 SKU가 없습니다.", "No SKUs match the current filter.")}
          </div>
        ) : (
          visibleRows.map((row, index) => {
            const status = statusOf(row);
            const editing = editingSku === row.masterSku;
            return (
              <div key={row.masterSku} className={`grid ${gridCols} min-w-[1100px] items-center border-b border-[#e2dfd8] px-3 py-2 text-sm`}>
                <input
                  type="checkbox"
                  aria-label={pick(`${row.masterSku} 선택`, `Select ${row.masterSku}`)}
                  disabled={!canDelete}
                  checked={selected.has(row.masterSku)}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setSelected((current) => {
                      const next = new Set(current);
                      if (checked) next.add(row.masterSku);
                      else next.delete(row.masterSku);
                      return next;
                    });
                  }}
                />
                <span className="font-mono text-xs text-muted-foreground">{index + 1}</span>
                <span className="truncate font-mono text-xs">{row.masterSku}</span>
                <span className="truncate text-xs text-muted-foreground" title={row.productName ?? undefined}>{row.productName ?? "-"}</span>
                <span className={`pr-3 text-right font-mono text-xs ${status === "applied" ? "text-muted-foreground line-through" : ""}`}>
                  {formatAvg(row.calculatedTotalAvgCurr)}
                </span>
                {editing ? (
                  <input
                    className="form-input h-8 w-full bg-white text-right text-xs"
                    type="number"
                    step="any"
                    min="0"
                    autoFocus
                    value={editForm.minimum}
                    onChange={(event) => setEditForm((f) => ({ ...f, minimum: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void saveEdit(row);
                      if (event.key === "Escape") setEditingSku(null);
                    }}
                  />
                ) : (
                  <span className="pr-3 text-right font-mono text-xs font-semibold">{formatAvg(row.minTotalAvgCurr)}</span>
                )}
                <span>
                  <StatusBadge
                    status={status}
                    label={statusLabel(status)}
                    title={status === "override"
                      ? pick(`수동 입력값 ${formatAvg(row.totalAvgCurrOverride)}이 우선합니다.`, `Manual value ${formatAvg(row.totalAvgCurrOverride)} takes priority.`)
                      : undefined}
                  />
                </span>
                {editing ? (
                  <input
                    className="form-input h-8 w-full bg-white text-xs"
                    value={editForm.note}
                    onChange={(event) => setEditForm((f) => ({ ...f, note: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void saveEdit(row);
                      if (event.key === "Escape") setEditingSku(null);
                    }}
                  />
                ) : (
                  <span className="truncate text-xs text-muted-foreground" title={row.note ?? undefined}>{row.note || "-"}</span>
                )}
                <span className="text-[11px] leading-tight text-muted-foreground">
                  <span className="block font-mono">{formatDate(row.updatedAt)}</span>
                  {row.updatedBy ? <span className="block truncate">{row.updatedBy}</span> : null}
                </span>
                <div className="flex gap-2">
                  {editing ? (
                    <>
                      <button type="button" disabled={saving} onClick={() => void saveEdit(row)} className="text-xs font-semibold text-[#1a5cdb]">{pick("저장", "Save")}</button>
                      <button type="button" onClick={() => setEditingSku(null)} className="text-xs font-semibold text-muted-foreground">{pick("취소", "Cancel")}</button>
                    </>
                  ) : (
                    <>
                      {canEdit ? <button type="button" onClick={() => beginEdit(row)} className="text-xs font-semibold text-[#1a5cdb]">{pick("편집", "Edit")}</button> : null}
                      {canDelete ? <button type="button" disabled={saving} onClick={() => void remove([row.masterSku])} className="text-xs font-semibold text-[#c42b2b]">{pick("삭제", "Delete")}</button> : null}
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function StatButton({ label, value, active, onClick, tone }: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
  tone?: "applied" | "override";
}) {
  const color = tone === "applied" ? "text-[#b45309]" : tone === "override" ? "text-[#1a5cdb]" : "";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-r border-[#e2dfd8] px-6 py-3 text-left last:border-r-0 hover:bg-[#f0eee9] ${active ? "bg-white shadow-[inset_0_-2px_0_#1a5cdb]" : ""}`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${color}`}>{new Intl.NumberFormat("en-US").format(value)}</div>
    </button>
  );
}

function StatusBadge({ status, label, title }: { status: MinSalesStatus; label: string; title?: string }) {
  const style = status === "applied"
    ? "border-[#f5c97a] bg-[#fff7e6] text-[#b45309]"
    : status === "override"
      ? "border-[#bcd0f7] bg-[#eef3fd] text-[#1a5cdb]"
      : "border-[#e2dfd8] bg-[#f8f7f4] text-muted-foreground";
  return (
    <span title={title} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${style}`}>
      {label}
    </span>
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
