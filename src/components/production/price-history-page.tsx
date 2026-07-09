"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, FileUp, Plus, RefreshCcw, Save, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiPath } from "@/lib/api-path";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { useI18n } from "@/lib/i18n/i18n-provider";

type Factory = {
  id: string;
  factoryName: string;
  factoryCode: string | null;
};

type PriceRow = {
  id: string;
  factoryId: string;
  factoryName: string;
  sku: string;
  effectiveDate: string;
  unitPrice: number;
  currency: string;
  reason: string | null;
  sourceFileId: string | null;
  sourceFileName: string | null;
  previousPrice: number | null;
  changeAmount: number | null;
  changeRate: number | null;
};

type SourceFileRow = {
  id: string;
  originalName: string;
  mimeType: string | null;
  sizeBytes: number;
  uploadedBy: string | null;
  createdAt: string;
  rowCount: number;
  factoryCount: number;
  factoryIds: string[];
  factoryNames: string | null;
  skuCount: number;
  firstEffectiveDate: string | null;
  lastEffectiveDate: string | null;
};

type UploadPreviewRow = {
  rowNo: number;
  sku: string;
  effectiveDate: string | null;
  unitPrice: number | null;
  reason: string;
  error: string | null;
};

type UploadPreview = {
  file: File;
  rows: UploadPreviewRow[];
  errors: string[];
};

type UploadResult = {
  sourceFileId: string;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

type PriceForm = {
  id: string | null;
  factoryId: string;
  sku: string;
  effectiveDate: string;
  unitPrice: string;
  currency: string;
  reason: string;
};

const emptyForm: PriceForm = {
  id: null,
  factoryId: "",
  sku: "",
  effectiveDate: new Date().toISOString().slice(0, 10),
  unitPrice: "",
  currency: "USD",
  reason: "",
};

function money(value: number | null | undefined, currency = "USD") {
  if (value == null || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(value);
}

function pct(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function pickExcelValue(row: Record<string, unknown>, names: string[]) {
  const entries = Object.entries(row);
  for (const name of names) {
    const normalized = name.toLowerCase().replace(/[\s_-]/g, "");
    const found = entries.find(([key]) => key.toLowerCase().replace(/[\s_-]/g, "") === normalized);
    if (found) return found[1];
  }
  return undefined;
}

type PriceHistoryPageProps = {
  initialSku?: string;
};

export function PriceHistoryPage({ initialSku }: PriceHistoryPageProps = {}) {
  const { pick } = useI18n();
  const { can, ready } = usePermissions();
  const canCreate = ready && can("invoice-price-control", "create");
  const canEdit = ready && can("invoice-price-control", "edit");
  const canDelete = ready && can("invoice-price-control", "delete");
  const fileRef = useRef<HTMLInputElement>(null);
  const [factories, setFactories] = useState<Factory[]>([]);
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [sourceFiles, setSourceFiles] = useState<SourceFileRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState(initialSku ?? "");
  const [factoryId, setFactoryId] = useState("");
  const [asOfDate, setAsOfDate] = useState("");
  const [currentOnly, setCurrentOnly] = useState(true);
  const [form, setForm] = useState<PriceForm>(emptyForm);
  const [uploadEffectiveDate, setUploadEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [uploadPreview, setUploadPreview] = useState<UploadPreview | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<{ file: SourceFileRow; rows: PriceRow[]; mode: "view" | "delete" } | null>(null);
  const [showUploadHistory, setShowUploadHistory] = useState(false);
  const [uploadSearch, setUploadSearch] = useState("");
  const [uploadFactoryFilter, setUploadFactoryFilter] = useState("");
  const [uploadEffectiveFrom, setUploadEffectiveFrom] = useState("");
  const [uploadEffectiveTo, setUploadEffectiveTo] = useState("");
  const [uploadCreatedFrom, setUploadCreatedFrom] = useState("");
  const [uploadCreatedTo, setUploadCreatedTo] = useState("");
  const [uploadHistoryPage, setUploadHistoryPage] = useState(1);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  async function loadFactories() {
    const res = await fetch(apiPath("/api/production/price-history?mode=factories&active=true"), { cache: "no-store" });
    const json = await res.json();
    if (json.success) {
      setFactories(json.data);
      setFactoryId((current) => current || json.data[0]?.id || "");
      setForm((current) => ({ ...current, factoryId: current.factoryId || json.data[0]?.id || "" }));
    }
  }

  async function loadRows() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (factoryId) params.set("factoryId", factoryId);
      if (search.trim()) params.set("sku", search.trim());
      if (asOfDate) params.set("asOfDate", asOfDate);
      if (currentOnly) params.set("currentOnly", "true");
      const res = await fetch(apiPath(`/api/production/price-history?${params.toString()}`), { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || pick("가격 이력을 불러오지 못했습니다.", "Failed to load price history"));
      setRows(json.data);
      setPage(1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : pick("가격 이력을 불러오지 못했습니다.", "Failed to load price history"));
    } finally {
      setLoading(false);
    }
  }

  async function loadSourceFiles() {
    setLoadingFiles(true);
    try {
      const params = new URLSearchParams({ mode: "files" });
      const res = await fetch(apiPath(`/api/production/price-history?${params.toString()}`), { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || pick("업로드 파일 목록을 불러오지 못했습니다.", "Failed to load uploaded files"));
      setSourceFiles(json.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : pick("업로드 파일 목록을 불러오지 못했습니다.", "Failed to load uploaded files"));
    } finally {
      setLoadingFiles(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFactories();
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      void loadRows();
    }, 200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, factoryId, search, asOfDate, currentOnly]);

  useEffect(() => {
    if (!ready) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSourceFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const selectedSkuHistory = useMemo(() => {
    if (!form.sku.trim()) return [];
    const sku = form.sku.trim().toUpperCase();
    return rows.filter((row) => row.sku.toUpperCase() === sku);
  }, [form.sku, rows]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pagedRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize]
  );
  const filteredSourceFiles = useMemo(() => {
    const query = uploadSearch.trim().toLowerCase();
    return sourceFiles.filter((file) => {
      const createdDate = file.createdAt.slice(0, 10);
      if (query && !file.originalName.toLowerCase().includes(query)) return false;
      if (uploadFactoryFilter && !file.factoryIds.includes(uploadFactoryFilter)) return false;
      if (uploadEffectiveFrom && (file.lastEffectiveDate ?? "") < uploadEffectiveFrom) return false;
      if (uploadEffectiveTo && (file.firstEffectiveDate ?? "9999-12-31") > uploadEffectiveTo) return false;
      if (uploadCreatedFrom && createdDate < uploadCreatedFrom) return false;
      if (uploadCreatedTo && createdDate > uploadCreatedTo) return false;
      return true;
    });
  }, [sourceFiles, uploadCreatedFrom, uploadCreatedTo, uploadEffectiveFrom, uploadEffectiveTo, uploadFactoryFilter, uploadSearch]);
  const uploadHistoryPageSize = 10;
  const uploadHistoryTotalPages = Math.max(1, Math.ceil(filteredSourceFiles.length / uploadHistoryPageSize));
  const pagedSourceFiles = useMemo(
    () => filteredSourceFiles.slice((uploadHistoryPage - 1) * uploadHistoryPageSize, uploadHistoryPage * uploadHistoryPageSize),
    [filteredSourceFiles, uploadHistoryPage]
  );

  async function saveForm() {
    if (!canCreate && !form.id) return toast.error(pick("가격 이력을 추가할 권한이 없습니다.", "No permission to create price history"));
    if (!canEdit && form.id) return toast.error(pick("가격 이력을 수정할 권한이 없습니다.", "No permission to edit price history"));
    const unitPrice = Number(form.unitPrice);
    if (!form.factoryId || !form.sku.trim() || !form.effectiveDate || !Number.isFinite(unitPrice)) {
      toast.error(pick("공장, SKU, 적용 시작일, 단가는 필수입니다.", "Factory, SKU, effective date, and unit price are required"));
      return;
    }
    const method = form.id ? "PUT" : "POST";
    const res = await fetch(apiPath("/api/production/price-history"), {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: form.id,
        factoryId: form.factoryId,
        sku: form.sku,
        effectiveDate: form.effectiveDate,
        unitPrice,
        currency: "USD",
        reason: form.reason,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      toast.error(json.error || pick("가격 이력 저장에 실패했습니다.", "Failed to save price history"));
      return;
    }
    toast.success(pick("가격 이력이 저장되었습니다.", "Price history saved"));
    setForm({ ...emptyForm, factoryId: form.factoryId });
    await loadRows();
  }

  async function deleteRow(id: string) {
    if (!canDelete) return toast.error(pick("가격 이력을 삭제할 권한이 없습니다.", "No permission to delete price history"));
    if (!window.confirm(pick("이 가격 이력을 삭제할까요?", "Delete this price history row?"))) return;
    const res = await fetch(apiPath(`/api/production/price-history?id=${encodeURIComponent(id)}`), { method: "DELETE" });
    const json = await res.json();
    if (!res.ok || !json.success) {
      toast.error(json.error || pick("가격 이력 삭제에 실패했습니다.", "Failed to delete price history"));
      return;
    }
    toast.success(pick("가격 이력이 삭제되었습니다.", "Price history deleted"));
    await Promise.all([loadRows(), loadSourceFiles()]);
  }

  async function previewUploadFile(file: File) {
    if (!canCreate) return toast.error(pick("Price List를 업로드할 권한이 없습니다.", "No permission to upload price lists"));
    if (!factoryId) return toast.error(pick("업로드 전에 공장을 선택하세요.", "Select a factory before upload"));
    if (!uploadEffectiveDate) return toast.error(pick("업로드 적용일을 선택하세요.", "Select an upload effective date"));
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const rows = rawRows.map((row, index) => {
        const rowNo = index + 2;
        const sku = String(pickExcelValue(row, ["sku", "master_sku", "master sku", "item"]) ?? "").trim().toUpperCase();
        const rawPrice = pickExcelValue(row, ["unit_price", "unit price", "price", "cost"]);
        const unitPrice = Number(String(rawPrice ?? "").replace(/[$,]/g, ""));
        const reason = String(pickExcelValue(row, ["reason", "note", "memo"]) ?? "").trim();
        const error = !sku || !Number.isFinite(unitPrice) || unitPrice < 0
          ? pick("SKU, unit_price를 확인하세요.", "Check SKU and unit_price.")
          : null;
        return { rowNo, sku, effectiveDate: uploadEffectiveDate, unitPrice: Number.isFinite(unitPrice) ? unitPrice : null, reason, error };
      });
      setUploadResult(null);
      setUploadPreview({ file, rows, errors: rows.filter((row) => row.error).map((row) => `Row ${row.rowNo}: ${row.error}`) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : pick("파일 미리보기에 실패했습니다.", "Failed to preview file"));
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function uploadFile(file: File) {
    if (!canCreate) return toast.error(pick("Price List를 업로드할 권한이 없습니다.", "No permission to upload price lists"));
    if (!factoryId) return toast.error(pick("업로드 전에 공장을 선택하세요.", "Select a factory before upload"));
    if (!uploadEffectiveDate) return toast.error(pick("업로드 적용일을 선택하세요.", "Select an upload effective date"));
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("factoryId", factoryId);
      formData.append("effectiveDate", uploadEffectiveDate);
      const res = await fetch(apiPath("/api/production/price-history"), { method: "PATCH", body: formData });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || pick("업로드에 실패했습니다.", "Upload failed"));
      const errors = json.data?.errors ?? [];
      setUploadResult({
        sourceFileId: String(json.data?.sourceFileId ?? ""),
        created: Number(json.data?.created ?? 0),
        updated: Number(json.data?.updated ?? 0),
        skipped: Number(json.data?.skipped ?? errors.length),
        errors,
      });
      toast.success(pick(
        `${json.data?.imported ?? 0}개 행을 가져왔습니다${errors.length ? `, ${errors.length}개 건너뜀` : ""}`,
        `Imported ${json.data?.imported ?? 0} rows${errors.length ? `, ${errors.length} skipped` : ""}`
      ));
      if (errors.length) console.warn("Price list import errors", errors);
      await Promise.all([loadRows(), loadSourceFiles()]);
      setUploadPreview(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : pick("업로드에 실패했습니다.", "Upload failed"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function previewDeleteSourceFile(file: SourceFileRow, mode: "view" | "delete" = "delete") {
    if (!canDelete) return toast.error(pick("업로드 파일을 삭제할 권한이 없습니다.", "No permission to delete uploaded files"));
    const params = new URLSearchParams({ sourceFileId: file.id });
    const res = await fetch(apiPath(`/api/production/price-history?${params.toString()}`), { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json.success) {
      toast.error(json.error || pick("삭제 영향 row 조회에 실패했습니다.", "Failed to load affected rows"));
      return;
    }
    setDeleteImpact({ file, rows: json.data, mode });
  }

  async function deleteSourceFile(file: SourceFileRow, skipConfirm = false) {
    if (!canDelete) return toast.error(pick("업로드 파일을 삭제할 권한이 없습니다.", "No permission to delete uploaded files"));
    const message = pick(
      `${file.originalName} 업로드분을 삭제할까요?\n\n연결된 가격 이력 ${file.rowCount}개가 함께 삭제됩니다.`,
      `Delete upload ${file.originalName}?\n\n${file.rowCount} linked price history row(s) will also be deleted.`
    );
    if (!skipConfirm && !window.confirm(message)) return;

    const res = await fetch(apiPath(`/api/production/price-history?sourceFileId=${encodeURIComponent(file.id)}`), { method: "DELETE" });
    const json = await res.json();
    if (!res.ok || !json.success) {
      toast.error(json.error || pick("업로드 파일 삭제에 실패했습니다.", "Failed to delete uploaded file"));
      return;
    }
    toast.success(pick(
      `${json.data?.deletedRows ?? 0}개 가격 이력을 삭제했습니다.`,
      `Deleted ${json.data?.deletedRows ?? 0} price history row(s).`
    ));
    setDeleteImpact(null);
    await Promise.all([loadRows(), loadSourceFiles()]);
  }

  function formatFileSize(bytes: number) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function exportRows() {
    const data = rows.map((row) => ({
      Factory: row.factoryName,
      SKU: row.sku,
      "Effective Date": row.effectiveDate,
      "Unit Price": row.unitPrice,
      Currency: row.currency,
      "Previous Price": row.previousPrice ?? "",
      Change: row.changeAmount ?? "",
      "Change Rate %": row.changeRate ?? "",
      Reason: row.reason ?? "",
      "Source File": row.sourceFileName ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Price History");
    XLSX.writeFile(wb, `price-history-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function downloadTemplate() {
    const ws = XLSX.utils.json_to_sheet([
      {
        sku: "CN15D",
        unit_price: 32.1,
        reason: "Base price",
      },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "price-list-template.xlsx");
  }

  function editRow(row: PriceRow) {
    setForm({
      id: row.id,
      factoryId: row.factoryId,
      sku: row.sku,
      effectiveDate: row.effectiveDate,
      unitPrice: String(row.unitPrice),
      currency: "USD",
      reason: row.reason ?? "",
    });
  }

  return (
    <div className="flex h-full min-h-0 bg-[#f6f7f9] px-5 py-5 text-[#1a1917]">
      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-4">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-hidden">
            <select value={factoryId} onChange={(e) => setFactoryId(e.target.value)} className="h-9 w-[210px] shrink-0 truncate rounded-md border bg-white px-2 text-sm">
              <option value="">{pick("전체 공장", "All factories")}</option>
              {factories.map((factory) => (
                <option key={factory.id} value={factory.id}>{factory.factoryName}</option>
              ))}
            </select>
            <div className="flex h-9 min-w-[180px] max-w-[260px] flex-1 items-center rounded-md border bg-white px-2">
              <Search className="mr-2 h-4 w-4 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} className="w-full outline-none" placeholder={pick("SKU 검색", "SKU Search")} />
            </div>
            <label className="flex h-9 shrink-0 items-center gap-1.5 text-sm font-medium">
              <span className="whitespace-nowrap">{pick("기준 날짜", "As Of Date")}</span>
              <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="h-9 w-[132px] rounded-md border bg-white px-2 text-sm" />
            </label>
            <label className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap text-sm">
              <input type="checkbox" checked={currentOnly} onChange={(e) => setCurrentOnly(e.target.checked)} />
              {pick("현재 가격만", "Current only")}
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50">
              <Download className="h-4 w-4" /> {pick("양식", "Template")}
            </button>
            <button type="button" onClick={exportRows} className="inline-flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50">
              <Download className="h-4 w-4" /> {pick("내보내기", "Export")}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowUploadHistory(true);
                setUploadHistoryPage(1);
                void loadSourceFiles();
              }}
              className="inline-flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
            >
              {pick("업로드 이력", "Upload History")}
            </button>
            <label className="flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm font-medium">
              <span className="text-xs text-muted-foreground">{pick("적용일", "Effective")}</span>
              <input
                type="date"
                value={uploadEffectiveDate}
                onChange={(event) => setUploadEffectiveDate(event.target.value)}
                className="h-6 border-0 bg-transparent p-0 text-sm outline-none"
              />
            </label>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void previewUploadFile(file);
              }}
            />
            <button
              type="button"
              disabled={uploading || !canCreate}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-md bg-[#1a5cdb] px-3 py-2 text-sm font-medium text-white hover:bg-[#174fbf] disabled:opacity-50"
            >
              <FileUp className="h-4 w-4" /> {uploading ? pick("업로드 중...", "Uploading...") : pick("Price List 업로드", "Upload Price List")}
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="min-h-0 overflow-auto rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Plus className="h-4 w-4" /> {pick("가격 입력", "Price Entry")}
            </div>
            <div className="space-y-3">
              <label className="block text-xs font-medium">
                {pick("공장", "Factory")}
                <select value={form.factoryId} onChange={(e) => setForm((cur) => ({ ...cur, factoryId: e.target.value }))} className="mt-1 h-9 w-full rounded-md border px-2">
                  <option value="">{pick("공장 선택", "Select factory")}</option>
                  {factories.map((factory) => (
                    <option key={factory.id} value={factory.id}>{factory.factoryName}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium">
                SKU
                <input value={form.sku} onChange={(e) => setForm((cur) => ({ ...cur, sku: e.target.value.toUpperCase() }))} className="mt-1 h-9 w-full rounded-md border px-2 font-mono" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-medium">
                  {pick("적용 시작일", "Effective Date")}
                  <input type="date" value={form.effectiveDate} onChange={(e) => setForm((cur) => ({ ...cur, effectiveDate: e.target.value }))} className="mt-1 h-9 w-full rounded-md border px-2" />
                </label>
                <label className="block text-xs font-medium">
                  {pick("단가 ($)", "Unit Price ($)")}
                  <input type="number" step="0.0001" value={form.unitPrice} onChange={(e) => setForm((cur) => ({ ...cur, unitPrice: e.target.value }))} className="mt-1 h-9 w-full rounded-md border px-2" />
                </label>
              </div>
              <label className="block text-xs font-medium">
                {pick("변경 사유", "Reason")}
                <textarea value={form.reason} onChange={(e) => setForm((cur) => ({ ...cur, reason: e.target.value }))} className="mt-1 min-h-20 w-full rounded-md border px-2 py-2" />
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setForm({ ...emptyForm, factoryId: form.factoryId || factoryId })} className="rounded-md border px-3 py-2 text-sm">{pick("초기화", "Clear")}</button>
                <button type="button" onClick={() => void saveForm()} className="inline-flex items-center gap-2 rounded-md bg-[#111827] px-3 py-2 text-sm font-medium text-white">
                  <Save className="h-4 w-4" /> {pick("저장", "Save")}
                </button>
              </div>
            </div>

            <div className="mt-5 border-t pt-4">
              <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{pick("선택 SKU 이력", "Selected SKU History")}</div>
              <div className="space-y-2">
                {selectedSkuHistory.slice(0, 6).map((row) => (
                  <div key={row.id} className="rounded-md border bg-slate-50 px-3 py-2 text-xs">
                    <div className="flex justify-between gap-3">
                      <span className="font-mono font-semibold">{row.effectiveDate}</span>
                      <span>{money(row.unitPrice, row.currency)}</span>
                    </div>
                    <div className="mt-1 text-muted-foreground">{row.reason || pick("사유 없음", "No reason")}</div>
                  </div>
                ))}
                {!selectedSkuHistory.length && <div className="text-xs text-muted-foreground">{pick("SKU를 입력하거나 선택하면 이력을 볼 수 있습니다.", "Enter or select a SKU to view history.")}</div>}
              </div>
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-white shadow-sm">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold">{pick("가격 이력", "Price History")}</div>
                  <div className="text-xs text-muted-foreground">{loading ? pick("불러오는 중...", "Loading...") : pick(`${rows.length}개 행`, `${rows.length} rows`)}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{pick("행", "Rows")}</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    className="h-8 rounded-md border bg-white px-2 text-foreground"
                  >
                    {[25, 50, 100].map((size) => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                </div>
                <span>
                  {pick("페이지", "Page")} <span className="font-semibold text-foreground">{rows.length === 0 ? 0 : page}</span> / {totalPages}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage(1)}
                    className="rounded-md border bg-white p-1.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={pick("첫 페이지", "First page")}
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    className="rounded-md border bg-white p-1.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={pick("이전 페이지", "Previous page")}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    className="rounded-md border bg-white p-1.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={pick("다음 페이지", "Next page")}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage(totalPages)}
                    className="rounded-md border bg-white p-1.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={pick("마지막 페이지", "Last page")}
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">SKU</th>
                      <th className="px-3 py-2">{pick("적용일", "Effective")}</th>
                      <th className="px-3 py-2 text-right">{pick("가격", "Price")}</th>
                      <th className="px-3 py-2 text-right">{pick("이전 가격", "Previous")}</th>
                      <th className="px-3 py-2 text-right">{pick("변동액", "Change")}</th>
                      <th className="px-3 py-2 text-right">{pick("변동률", "Rate")}</th>
                      <th className="px-3 py-2">{pick("변경 사유", "Reason")}</th>
                      <th className="px-3 py-2">{pick("원본 파일", "Source")}</th>
                      <th className="px-3 py-2 text-right">{pick("작업", "Actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRows.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => editRow(row)}
                        className={`cursor-pointer border-t ${
                          form.id === row.id ? "bg-[#ebf0fd] hover:bg-[#ebf0fd]" : "hover:bg-slate-50"
                        }`}
                      >
                        <td className="px-3 py-2 font-mono font-semibold">{row.sku}</td>
                        <td className="px-3 py-2 font-mono">{row.effectiveDate}</td>
                        <td className="px-3 py-2 text-right font-semibold">{money(row.unitPrice, row.currency)}</td>
                        <td className="px-3 py-2 text-right">{money(row.previousPrice, row.currency)}</td>
                        <td className={`px-3 py-2 text-right ${row.changeAmount && row.changeAmount > 0 ? "text-red-600" : row.changeAmount && row.changeAmount < 0 ? "text-emerald-600" : ""}`}>
                          {row.changeAmount == null ? "-" : `${row.changeAmount >= 0 ? "+" : ""}${money(row.changeAmount, row.currency)}`}
                        </td>
                        <td className="px-3 py-2 text-right">{pct(row.changeRate)}</td>
                        <td className="max-w-48 truncate px-3 py-2">{row.reason || "-"}</td>
                        <td className="max-w-44 truncate px-3 py-2">
                          {row.sourceFileId ? (
                            <a
                              className="text-[#1a5cdb] hover:underline"
                              href={apiPath(`/api/production/price-history/files/${row.sourceFileId}`)}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {row.sourceFileName || `File ${row.sourceFileId}`}
                            </a>
                          ) : "-"}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                            <button type="button" disabled={!canDelete} onClick={() => void deleteRow(row.id)} className="rounded border px-2 py-1 text-xs text-red-600 disabled:opacity-40">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!rows.length && (
                      <tr>
                        <td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">{pick("가격 이력이 없습니다.", "No price history found.")}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
      {showUploadHistory ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="flex max-h-[88vh] w-[96vw] max-w-[1500px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
              <div>
                <div className="text-lg font-semibold">{pick("업로드 이력", "Upload History")}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {pick("Price List 업로드 묶음을 source_file_id 기준으로 조회하고 관리합니다.", "Manage Price List upload batches by source_file_id.")}
                </div>
              </div>
              <button type="button" onClick={() => setShowUploadHistory(false)} className="rounded-md border px-3 py-1.5 text-sm">
                {pick("닫기", "Close")}
              </button>
            </div>

            <div className="border-b bg-slate-50 px-5 py-3">
              <div className="grid gap-3 lg:grid-cols-[minmax(280px,1.5fr)_minmax(220px,1fr)_repeat(4,minmax(160px,0.8fr))_auto]">
                <label className="text-xs font-medium">
                  {pick("파일명 검색", "File Search")}
                  <input
                    value={uploadSearch}
                    onChange={(event) => {
                      setUploadSearch(event.target.value);
                      setUploadHistoryPage(1);
                    }}
                    placeholder={pick("파일명 검색", "Search file name")}
                    className="mt-1 h-9 w-full rounded-md border bg-white px-2 text-sm"
                  />
                </label>
                <label className="text-xs font-medium">
                  {pick("공장", "Factory")}
                  <select
                    value={uploadFactoryFilter}
                    onChange={(event) => {
                      setUploadFactoryFilter(event.target.value);
                      setUploadHistoryPage(1);
                    }}
                    className="mt-1 h-9 w-full rounded-md border bg-white px-2 text-sm"
                  >
                    <option value="">{pick("전체 공장", "All factories")}</option>
                    {factories.map((factory) => (
                      <option key={factory.id} value={factory.id}>{factory.factoryName}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-medium">
                  {pick("적용일 From", "Effective From")}
                  <input type="date" value={uploadEffectiveFrom} onChange={(event) => { setUploadEffectiveFrom(event.target.value); setUploadHistoryPage(1); }} className="mt-1 h-9 w-full rounded-md border bg-white px-2 text-sm" />
                </label>
                <label className="text-xs font-medium">
                  {pick("적용일 To", "Effective To")}
                  <input type="date" value={uploadEffectiveTo} onChange={(event) => { setUploadEffectiveTo(event.target.value); setUploadHistoryPage(1); }} className="mt-1 h-9 w-full rounded-md border bg-white px-2 text-sm" />
                </label>
                <label className="text-xs font-medium">
                  {pick("업로드일 From", "Upload From")}
                  <input type="date" value={uploadCreatedFrom} onChange={(event) => { setUploadCreatedFrom(event.target.value); setUploadHistoryPage(1); }} className="mt-1 h-9 w-full rounded-md border bg-white px-2 text-sm" />
                </label>
                <label className="text-xs font-medium">
                  {pick("업로드일 To", "Upload To")}
                  <input type="date" value={uploadCreatedTo} onChange={(event) => { setUploadCreatedTo(event.target.value); setUploadHistoryPage(1); }} className="mt-1 h-9 w-full rounded-md border bg-white px-2 text-sm" />
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => {
                      setUploadSearch("");
                      setUploadFactoryFilter("");
                      setUploadEffectiveFrom("");
                      setUploadEffectiveTo("");
                      setUploadCreatedFrom("");
                      setUploadCreatedTo("");
                      setUploadHistoryPage(1);
                      void loadSourceFiles();
                    }}
                    className="inline-flex h-9 items-center gap-2 rounded-md border bg-white px-3 text-sm font-medium hover:bg-slate-50"
                  >
                    <RefreshCcw className={`h-4 w-4 ${loadingFiles ? "animate-spin" : ""}`} />
                    {pick("새로고침", "Refresh")}
                  </button>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-5">
              <table className="w-full min-w-[1280px] text-left text-sm">
                <thead className="sticky top-0 bg-white text-xs uppercase text-muted-foreground shadow-[0_1px_0_0_#e5e7eb]">
                  <tr>
                    <th className="px-3 py-2">{pick("파일명", "File")}</th>
                    <th className="px-3 py-2">{pick("공장", "Factory")}</th>
                    <th className="px-3 py-2">{pick("적용일", "Effective")}</th>
                    <th className="px-3 py-2 text-right">SKU</th>
                    <th className="px-3 py-2 text-right">{pick("행", "Rows")}</th>
                    <th className="px-3 py-2 text-right">{pick("크기", "Size")}</th>
                    <th className="px-3 py-2">{pick("업로드일", "Uploaded")}</th>
                    <th className="px-3 py-2">{pick("업로드 ID", "Upload ID")}</th>
                    <th className="px-3 py-2 text-right">{pick("작업", "Actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedSourceFiles.map((file) => (
                    <tr key={file.id} className="border-t hover:bg-slate-50">
                      <td className="max-w-64 px-3 py-2">
                        <a className="block truncate font-semibold text-[#1a5cdb] hover:underline" href={apiPath(`/api/production/price-history/files/${file.id}`)} title={file.originalName}>
                          {file.originalName}
                        </a>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">source_file_id: {file.id}</div>
                      </td>
                      <td className="max-w-52 truncate px-3 py-2">{file.factoryNames || "-"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{file.firstEffectiveDate === file.lastEffectiveDate ? file.firstEffectiveDate ?? "-" : `${file.firstEffectiveDate ?? "-"} - ${file.lastEffectiveDate ?? "-"}`}</td>
                      <td className="px-3 py-2 text-right font-semibold">{file.skuCount}</td>
                      <td className="px-3 py-2 text-right font-semibold">{file.rowCount}</td>
                      <td className="px-3 py-2 text-right">{formatFileSize(file.sizeBytes)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{file.createdAt.slice(0, 16).replace("T", " ")}</td>
                      <td className="max-w-36 truncate px-3 py-2">{file.uploadedBy || "-"}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => void previewDeleteSourceFile(file, "view")} className="rounded border px-2 py-1 text-xs hover:bg-white">
                            {pick("영향 row 보기", "View Rows")}
                          </button>
                          <button type="button" disabled={!canDelete} onClick={() => void previewDeleteSourceFile(file, "delete")} className="rounded border px-2 py-1 text-xs text-red-600 disabled:opacity-40">
                            {pick("이 업로드분 삭제", "Delete Upload")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!pagedSourceFiles.length ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-12 text-center text-muted-foreground">
                        {loadingFiles ? pick("업로드 이력을 불러오는 중입니다.", "Loading upload history.") : pick("조건에 맞는 업로드 이력이 없습니다.", "No upload history matches the filters.")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-sm">
              <div className="text-muted-foreground">
                {pick("표시", "Showing")} {filteredSourceFiles.length === 0 ? 0 : (uploadHistoryPage - 1) * uploadHistoryPageSize + 1}
                {" - "}
                {Math.min(uploadHistoryPage * uploadHistoryPageSize, filteredSourceFiles.length)}
                {" / "}
                {filteredSourceFiles.length}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" disabled={uploadHistoryPage <= 1} onClick={() => setUploadHistoryPage((current) => Math.max(1, current - 1))} className="rounded-md border px-3 py-1.5 disabled:opacity-40">
                  {pick("이전", "Prev")}
                </button>
                <span className="text-muted-foreground">{uploadHistoryPage} / {uploadHistoryTotalPages}</span>
                <button type="button" disabled={uploadHistoryPage >= uploadHistoryTotalPages} onClick={() => setUploadHistoryPage((current) => Math.min(uploadHistoryTotalPages, current + 1))} className="rounded-md border px-3 py-1.5 disabled:opacity-40">
                  {pick("다음", "Next")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {uploadPreview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
              <div>
                <div className="text-lg font-semibold">{pick("업로드 전 미리보기", "Upload Preview")}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {uploadPreview.file.name} · {pick("공장명:", "Factory:")}{" "}
                  <span className="font-bold text-[#1a5cdb]">{factories.find((factory) => factory.id === factoryId)?.factoryName ?? factoryId}</span>
                  {" "}· {pick("적용일", "Effective")}{" "}
                  <span className="font-bold text-[#1a5cdb]">{uploadEffectiveDate}</span>
                  {" "}· USD
                </div>
              </div>
              <button type="button" onClick={() => { setUploadPreview(null); if (fileRef.current) fileRef.current.value = ""; }} className="rounded-md border px-3 py-1.5 text-sm">
                {pick("닫기", "Close")}
              </button>
            </div>
            <div className="max-h-[55vh] overflow-auto p-5">
              <div className="mb-3 flex flex-wrap gap-2 text-sm">
                <span className="rounded-full bg-slate-100 px-3 py-1">{pick("전체", "Total")} {uploadPreview.rows.length}</span>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">{pick("업로드 가능", "Valid")} {uploadPreview.rows.length - uploadPreview.errors.length}</span>
                <span className="rounded-full bg-red-50 px-3 py-1 text-red-700">{pick("스킵 예정", "Will skip")} {uploadPreview.errors.length}</span>
              </div>
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">{pick("적용일", "Effective")}</th>
                    <th className="px-3 py-2 text-right">{pick("단가", "Unit Price")}</th>
                    <th className="px-3 py-2">{pick("변경 사유", "Reason")}</th>
                    <th className="px-3 py-2">{pick("상태", "Status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {uploadPreview.rows.slice(0, 100).map((row) => (
                    <tr key={row.rowNo} className="border-t">
                      <td className="px-3 py-2 font-mono">{row.rowNo}</td>
                      <td className="px-3 py-2 font-mono font-semibold">{row.sku || "-"}</td>
                      <td className="px-3 py-2 font-mono">{row.effectiveDate ?? "-"}</td>
                      <td className="px-3 py-2 text-right">{row.unitPrice == null ? "-" : money(row.unitPrice, "USD")}</td>
                      <td className="max-w-56 truncate px-3 py-2">{row.reason || "-"}</td>
                      <td className={`px-3 py-2 ${row.error ? "text-red-600" : "text-emerald-700"}`}>{row.error ?? pick("가능", "Ready")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {uploadPreview.rows.length > 100 ? <div className="mt-3 text-xs text-muted-foreground">{pick("처음 100행만 미리보기로 표시합니다.", "Showing first 100 rows only.")}</div> : null}
              {uploadResult ? (
                <div className="mt-4 rounded-lg border bg-slate-50 p-3 text-sm">
                  <div className="font-semibold">{pick("업로드 결과 요약", "Upload Result Summary")}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span>{pick("신규", "New")} {uploadResult.created}</span>
                    <span>{pick("업데이트", "Updated")} {uploadResult.updated}</span>
                    <span>{pick("스킵", "Skipped")} {uploadResult.skipped}</span>
                    <span>source_file_id: {uploadResult.sourceFileId || "-"}</span>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 border-t px-5 py-4">
              <button type="button" onClick={() => { setUploadPreview(null); if (fileRef.current) fileRef.current.value = ""; }} className="rounded-md border px-4 py-2 text-sm">
                {pick("취소", "Cancel")}
              </button>
              <button type="button" disabled={uploading} onClick={() => void uploadFile(uploadPreview.file)} className="rounded-md bg-[#1a5cdb] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {uploading ? pick("업로드 중...", "Uploading...") : pick("업로드 실행", "Upload")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteImpact ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="border-b px-5 py-4">
              <div className="text-lg font-semibold">
                {deleteImpact.mode === "delete" ? pick("삭제 전 영향 row 확인", "Review Rows Before Delete") : pick("업로드 영향 row", "Upload Rows")}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">{deleteImpact.file.originalName} · source_file_id: {deleteImpact.file.id}</div>
            </div>
            <div className="max-h-[58vh] overflow-auto p-5">
              <div className="mb-3 text-sm">
                {deleteImpact.mode === "delete"
                  ? pick("아래 가격 이력 row가 함께 삭제됩니다.", "The price history rows below will be deleted.")
                  : pick("이 업로드분으로 생성 또는 업데이트된 가격 이력 row입니다.", "These price history rows were created or updated by this upload.")}
                {" "}({deleteImpact.rows.length})
              </div>
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">{pick("공장", "Factory")}</th>
                    <th className="px-3 py-2">{pick("적용일", "Effective")}</th>
                    <th className="px-3 py-2 text-right">{pick("가격", "Price")}</th>
                    <th className="px-3 py-2">{pick("변경 사유", "Reason")}</th>
                  </tr>
                </thead>
                <tbody>
                  {deleteImpact.rows.map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="px-3 py-2 font-mono font-semibold">{row.sku}</td>
                      <td className="px-3 py-2">{row.factoryName}</td>
                      <td className="px-3 py-2 font-mono">{row.effectiveDate}</td>
                      <td className="px-3 py-2 text-right">{money(row.unitPrice, row.currency)}</td>
                      <td className="max-w-64 truncate px-3 py-2">{row.reason || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 border-t px-5 py-4">
              <button type="button" onClick={() => setDeleteImpact(null)} className="rounded-md border px-4 py-2 text-sm">
                {pick("취소", "Cancel")}
              </button>
              {deleteImpact.mode === "delete" ? (
                <button type="button" onClick={() => void deleteSourceFile(deleteImpact.file)} className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white">
                  {pick("이 업로드분 삭제", "Delete Upload")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
