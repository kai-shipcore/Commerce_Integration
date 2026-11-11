"use client";

/**
 * Code Guide:
 * Replacing Soon page: SKUs that will be replaced soon. The Demand Planning
 * automatic order calculations stock a registered SKU only up to its target
 * inventory life (default 30 days) instead of the sales-range / gradient target.
 * Same layout and flows as the Min Sales page: register one SKU with the picker,
 * edit inline, delete, Excel import / export.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Replace } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { SkuOptionPicker, type BaseSkuOption } from "@/components/planning/min-sales/sku-option-picker";

type ReplacingSoonRow = {
  masterSku: string;
  targetInvLifeDays: number;
  replacementSku: string | null;
  note: string | null;
  productName: string | null;
  categoryCode: string | null;
  salesStatus: string | null;
  calculatedTotalAvgCurr: number | null;
  updatedBy: string | null;
  updatedAt: string;
};

type ReplacingSoonOption = BaseSkuOption & { registeredDays: number | null };

/** Automatic orders only run for these statuses (see isAutoOrderSalesStatus on the dashboard). */
type AutoOrderState = "auto" | "manual";
type SortColumn = "masterSku" | "productName" | "status" | "calculated" | "days" | "replacement" | "updatedAt";
type SortDirection = "asc" | "desc";
type SaveRow = { masterSku: string; targetInvLifeDays: number; replacementSku: string | null; note: string | null };
type FormState = { days: string; replacement: string; note: string };

const DEFAULT_DAYS = 30;
const EMPTY_FORM: FormState = { days: String(DEFAULT_DAYS), replacement: "", note: "" };

function autoOrderStateOf(row: ReplacingSoonRow): AutoOrderState {
  return row.salesStatus === "Original" || row.salesStatus === "Custom" ? "auto" : "manual";
}

function sortValue(row: ReplacingSoonRow, column: SortColumn): string | number {
  switch (column) {
    case "productName": return row.productName ?? "";
    case "status": return row.salesStatus ?? "";
    case "calculated": return row.calculatedTotalAvgCurr ?? -1;
    case "days": return row.targetInvLifeDays;
    case "replacement": return row.replacementSku ?? "";
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

/** Whole days from 1 to 365; blank means the default. */
function parseDays(raw: string): number | null {
  if (raw.trim() === "") return DEFAULT_DAYS;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 365 ? value : null;
}

function normalizeHeader(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const SKU_HEADERS = ["sku", "mastersku"];
const DAYS_HEADERS = ["targetdays", "targetinvlife", "targetinvlifedays", "invlife", "days"];
const REPLACEMENT_HEADERS = ["replacementsku", "replacement", "newsku"];
const NOTE_HEADERS = ["note", "memo"];

function readWorkbook(workbook: XLSX.WorkBook): { rows: SaveRow[]; invalid: string[] } {
  const rows: SaveRow[] = [];
  const invalid: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1, blankrows: false, defval: "", raw: true,
    });
    const headerIndex = sheetRows.findIndex((row) => row.map(normalizeHeader).some((h) => SKU_HEADERS.includes(h)));
    if (headerIndex < 0) continue;
    const headers = sheetRows[headerIndex].map(normalizeHeader);
    const skuIndex = headers.findIndex((h) => SKU_HEADERS.includes(h));
    const daysIndex = headers.findIndex((h) => DAYS_HEADERS.includes(h));
    const replacementIndex = headers.findIndex((h) => REPLACEMENT_HEADERS.includes(h));
    const noteIndex = headers.findIndex((h) => NOTE_HEADERS.includes(h));
    for (const row of sheetRows.slice(headerIndex + 1)) {
      const masterSku = String(row[skuIndex] ?? "").trim().toUpperCase();
      if (!masterSku) continue;
      const days = parseDays(daysIndex >= 0 ? String(row[daysIndex] ?? "") : "");
      if (days === null) {
        invalid.push(masterSku);
        continue;
      }
      const replacement = replacementIndex >= 0 ? String(row[replacementIndex] ?? "").trim().toUpperCase() : "";
      const note = noteIndex >= 0 ? String(row[noteIndex] ?? "").trim() : "";
      rows.push({ masterSku, targetInvLifeDays: days, replacementSku: replacement || null, note: note || null });
    }
  }
  return { rows, invalid };
}

export function ReplacingSoonPage() {
  const { pick } = useI18n();
  const { can } = usePermissions();
  const canEdit = can("replacing-soon", "edit");
  const canDelete = can("replacing-soon", "delete");

  const [rows, setRows] = useState<ReplacingSoonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<AutoOrderState | "all">("all");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [selectedSku, setSelectedSku] = useState<ReplacingSoonOption | null>(null);
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortColumn, setSortColumn] = useState<SortColumn>("masterSku");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const loadFailed = pick("교체 예정 SKU 목록을 불러오지 못했습니다.", "Failed to load replacing-soon SKUs.");
  const saveFailed = pick("저장에 실패했습니다.", "Failed to save.");
  const noPermission = pick("이 작업을 수행할 권한이 없습니다.", "You don't have permission to perform this action.");
  const invalidDays = pick("목표 INV Life는 1~365 사이의 정수로 입력하세요.", "Enter a target inventory life of 1 to 365 whole days.");

  async function loadRows() {
    setLoading(true);
    try {
      const response = await fetch(apiPath("/api/planning/sku-replacing-soon"), { cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error ?? loadFailed);
      setRows(json.data as ReplacingSoonRow[]);
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
    const result = { total: rows.length, auto: 0, manual: 0 };
    for (const row of rows) result[autoOrderStateOf(row)] += 1;
    return result;
  }, [rows]);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = rows.filter((row) =>
      (stateFilter === "all" || autoOrderStateOf(row) === stateFilter) &&
      (!needle || `${row.masterSku} ${row.productName ?? ""} ${row.replacementSku ?? ""} ${row.note ?? ""}`.toLowerCase().includes(needle))
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
  }, [rows, query, stateFilter, sortColumn, sortDirection]);

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
    const response = await fetch(apiPath("/api/planning/sku-replacing-soon"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: payload }),
    });
    const json = await response.json();
    if (!response.ok || !json.success) throw new Error(json.error ?? saveFailed);
    return json.data as { inserted: number; updated: number };
  }

  function selectSku(option: ReplacingSoonOption | null) {
    setSelectedSku(option);
    setMessage("");
    // Editing an existing registration starts from its current values.
    const existing = option ? rows.find((row) => row.masterSku === option.masterSku) : undefined;
    setForm(existing
      ? { days: String(existing.targetInvLifeDays), replacement: existing.replacementSku ?? "", note: existing.note ?? "" }
      : EMPTY_FORM);
  }

  function toSaveRow(masterSku: string, values: FormState): SaveRow | null {
    const days = parseDays(values.days);
    if (days === null) return null;
    return {
      masterSku,
      targetInvLifeDays: days,
      replacementSku: values.replacement.trim().toUpperCase() || null,
      note: values.note.trim() || null,
    };
  }

  async function register() {
    if (!canEdit) { toast.error(noPermission); return; }
    const masterSku = selectedSku?.masterSku ?? "";
    if (!masterSku) {
      setMessage(pick("SKU를 선택하세요.", "Select a SKU."));
      return;
    }
    const row = toSaveRow(masterSku, form);
    if (!row) { setMessage(invalidDays); return; }
    setSaving(true);
    setMessage("");
    try {
      await postRows([row]);
      setForm(EMPTY_FORM);
      setSelectedSku(null);
      toast.success(pick(`${masterSku}을(를) 교체 예정으로 등록했습니다.`, `Registered ${masterSku} as replacing soon.`));
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : saveFailed);
    } finally {
      setSaving(false);
    }
  }

  function beginEdit(row: ReplacingSoonRow) {
    setEditingSku(row.masterSku);
    setEditForm({ days: String(row.targetInvLifeDays), replacement: row.replacementSku ?? "", note: row.note ?? "" });
    setMessage("");
  }

  async function saveEdit(row: ReplacingSoonRow) {
    if (!canEdit) { toast.error(noPermission); return; }
    const saveRow = toSaveRow(row.masterSku, editForm);
    if (!saveRow) { setMessage(invalidDays); return; }
    setSaving(true);
    try {
      await postRows([saveRow]);
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
          `${skus[0]}을(를) 교체 예정 목록에서 삭제할까요? 자동 발주가 다시 원래 목표일수로 계산합니다.`,
          `Remove ${skus[0]} from Replacing Soon? Automatic orders will use the normal target days again.`,
        )
      : pick(`선택한 ${skus.length}개 SKU를 교체 예정 목록에서 삭제할까요?`, `Remove ${skus.length} selected SKUs from Replacing Soon?`);
    if (!window.confirm(confirmText)) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(apiPath(`/api/planning/sku-replacing-soon?sku=${encodeURIComponent(skus.join(","))}`), { method: "DELETE" });
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
      const { rows: importRows, invalid } = readWorkbook(workbook);
      if (invalid.length > 0) {
        throw new Error(pick(
          `목표 INV Life가 1~365 정수가 아닌 행이 있습니다: ${invalid.slice(0, 10).join(", ")}`,
          `Target inventory life must be 1 to 365 whole days: ${invalid.slice(0, 10).join(", ")}`,
        ));
      }
      if (importRows.length === 0) {
        throw new Error(pick("엑셀에서 SKU 행을 찾지 못했습니다.", "No SKU rows were found in the Excel file."));
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
      ["SKU", "Target Days", "Replacement SKU", "Note"],
      ["CA-SC-10-F-10-BK-1TO", 30, "CA-SC-15-F-10-BK-1TO", "New fabric from Q1"],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Replacing Soon");
    XLSX.writeFile(workbook, "Replacing Soon template.xlsx");
  }

  function exportRows() {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["SKU", "Product", "Sales Status", "Calculated T.Avg", "Target Days", "Replacement SKU", "Note", "Updated By", "Updated At"],
      ...visibleRows.map((row) => [
        row.masterSku, row.productName ?? "", row.salesStatus ?? "", row.calculatedTotalAvgCurr ?? "",
        row.targetInvLifeDays, row.replacementSku ?? "", row.note ?? "", row.updatedBy ?? "", formatDate(row.updatedAt),
      ]),
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Replacing Soon");
    XLSX.writeFile(workbook, "Replacing Soon.xlsx");
  }

  const gridCols = "grid-cols-[28px_44px_minmax(190px,1.2fr)_minmax(150px,1fr)_96px_80px_90px_minmax(170px,1fr)_minmax(140px,1fr)_140px_110px]";
  const statusTitle = pick(
    "자동 발주는 Sales Status가 Original 또는 Custom인 SKU에만 수량을 넣습니다.",
    "Automatic orders only add quantity for SKUs whose Sales Status is Original or Custom.",
  );

  return (
    <section className="flex min-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] px-6 py-4">
        <div className="flex items-start gap-2">
          <Replace className="mt-1 h-5 w-5" />
          <div>
            <h1 className="text-lg font-semibold">{pick("교체 예정 SKU", "Replacing Soon SKUs")}</h1>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              {pick(
                "곧 다른 SKU로 바뀔 SKU를 등록합니다. Demand Planning 자동 발주는 등록된 SKU를 판매량 구간 목표일수 대신 여기 입력한 INV Life(기본 30일)까지만 채웁니다.",
                "Register SKUs that will soon be replaced. Demand Planning automatic orders stock a registered SKU only up to the inventory life entered here (30 days by default), instead of the sales-range target.",
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="form-input h-9 w-60 bg-white text-sm"
            placeholder={pick("SKU / 제품명 / 대체 SKU / 메모 검색...", "Search SKU / product / replacement / note...")}
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

      <div className="grid grid-cols-3 border-b border-[#e2dfd8] bg-[#f8f7f4]">
        <StatButton label={pick("등록 SKU", "Registered SKUs")} value={counts.total} active={stateFilter === "all"} onClick={() => setStateFilter("all")} />
        <StatButton
          label={pick("자동 발주 대상 (Original/Custom)", "Auto-ordered (Original/Custom)")}
          value={counts.auto}
          tone="auto"
          active={stateFilter === "auto"}
          onClick={() => setStateFilter("auto")}
        />
        <StatButton
          label={pick("자동 발주 제외 (기타 상태)", "Not auto-ordered (other status)")}
          value={counts.manual}
          active={stateFilter === "manual"}
          onClick={() => setStateFilter("manual")}
          title={statusTitle}
        />
      </div>

      {canEdit ? (
        <div className="border-b border-[#e2dfd8] bg-[#f8f7f4] px-5 py-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            {pick("교체 예정 등록", "Register SKU")}
          </div>
          <div className="grid gap-2 md:grid-cols-[minmax(200px,1fr)_110px_minmax(170px,1fr)_minmax(160px,1fr)_auto]">
            <div>
              <SkuOptionPicker<ReplacingSoonOption>
                value={selectedSku}
                onChange={selectSku}
                disabled={saving}
                endpoint="/api/planning/sku-replacing-soon/sku-options"
                renderRegistered={(option) => option.registeredDays !== null
                  ? <div className="font-semibold text-[#b45309]">{pick("등록됨", "Registered")} {option.registeredDays}d</div>
                  : null}
              />
              {selectedSku ? (
                <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                  {selectedSku.productName ? <span className="truncate">{selectedSku.productName}</span> : null}
                  <span>T.Avg {formatAvg(selectedSku.calculatedTotalAvgCurr)}</span>
                  {selectedSku.registeredDays !== null ? (
                    <span className="font-semibold text-[#b45309]">
                      {pick(`이미 등록됨 (${selectedSku.registeredDays}일), 저장하면 덮어씁니다`, `Already registered (${selectedSku.registeredDays} days), saving overwrites it`)}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <label className="relative block">
              <input
                className="form-input h-8 w-full bg-white pr-8 text-xs"
                type="number"
                step="1"
                min="1"
                max="365"
                title={pick("목표 INV Life (일)", "Target inventory life (days)")}
                placeholder={String(DEFAULT_DAYS)}
                value={form.days}
                onChange={(event) => setForm((f) => ({ ...f, days: event.target.value }))}
                onKeyDown={(event) => { if (event.key === "Enter") void register(); }}
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">{pick("일", "days")}</span>
            </label>
            <input
              className="form-input h-8 w-full bg-white font-mono text-xs"
              placeholder={pick("대체 SKU (선택)", "Replacement SKU (optional)")}
              value={form.replacement}
              onChange={(event) => setForm((f) => ({ ...f, replacement: event.target.value }))}
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
        <div className={`grid ${gridCols} min-w-[1240px] bg-[#f0eee9] px-3 py-2 text-[11px] font-semibold uppercase text-muted-foreground`}>
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
          <SortHeader label={pick("판매 상태", "Status")} column="status" sortColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
          <SortHeader label="T.Avg" column="calculated" sortColumn={sortColumn} direction={sortDirection} onSort={toggleSort} align="right" />
          <SortHeader label={pick("목표 INV Life", "Target Days")} column="days" sortColumn={sortColumn} direction={sortDirection} onSort={toggleSort} align="right" />
          <SortHeader label={pick("대체 SKU", "Replacement SKU")} column="replacement" sortColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
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
            const editing = editingSku === row.masterSku;
            const manual = autoOrderStateOf(row) === "manual";
            const keyHandler = (event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter") void saveEdit(row);
              if (event.key === "Escape") setEditingSku(null);
            };
            return (
              <div key={row.masterSku} className={`grid ${gridCols} min-w-[1240px] items-center border-b border-[#e2dfd8] px-3 py-2 text-sm`}>
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
                <span>
                  <span
                    title={manual ? statusTitle : undefined}
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${manual
                      ? "border-[#e2dfd8] bg-[#f8f7f4] text-muted-foreground"
                      : "border-[#bcd0f7] bg-[#eef3fd] text-[#1a5cdb]"}`}
                  >
                    {row.salesStatus ?? "-"}
                  </span>
                </span>
                <span className="pr-3 text-right font-mono text-xs">{formatAvg(row.calculatedTotalAvgCurr)}</span>
                {editing ? (
                  <input
                    className="form-input h-8 w-full bg-white text-right text-xs"
                    type="number"
                    step="1"
                    min="1"
                    max="365"
                    autoFocus
                    value={editForm.days}
                    onChange={(event) => setEditForm((f) => ({ ...f, days: event.target.value }))}
                    onKeyDown={keyHandler}
                  />
                ) : (
                  <span className="pr-3 text-right font-mono text-xs font-semibold">{row.targetInvLifeDays}{pick("일", "d")}</span>
                )}
                {editing ? (
                  <input
                    className="form-input h-8 w-full bg-white font-mono text-xs"
                    value={editForm.replacement}
                    onChange={(event) => setEditForm((f) => ({ ...f, replacement: event.target.value }))}
                    onKeyDown={keyHandler}
                  />
                ) : (
                  <span className="truncate font-mono text-xs" title={row.replacementSku ?? undefined}>{row.replacementSku ?? "-"}</span>
                )}
                {editing ? (
                  <input
                    className="form-input h-8 w-full bg-white text-xs"
                    value={editForm.note}
                    onChange={(event) => setEditForm((f) => ({ ...f, note: event.target.value }))}
                    onKeyDown={keyHandler}
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

function StatButton({ label, value, active, onClick, tone, title }: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
  tone?: "auto";
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`border-r border-[#e2dfd8] px-6 py-3 text-left last:border-r-0 hover:bg-[#f0eee9] ${active ? "bg-white shadow-[inset_0_-2px_0_#1a5cdb]" : ""}`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${tone === "auto" ? "text-[#1a5cdb]" : ""}`}>{new Intl.NumberFormat("en-US").format(value)}</div>
    </button>
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
