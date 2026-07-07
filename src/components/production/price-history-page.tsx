"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Download, FileUp, Plus, RefreshCcw, Save, Search, Trash2 } from "lucide-react";
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

export function PriceHistoryPage() {
  const { pick } = useI18n();
  const { can, ready } = usePermissions();
  const canCreate = ready && can("invoice-price-control", "create");
  const canEdit = ready && can("invoice-price-control", "edit");
  const canDelete = ready && can("invoice-price-control", "delete");
  const fileRef = useRef<HTMLInputElement>(null);
  const [factories, setFactories] = useState<Factory[]>([]);
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [factoryId, setFactoryId] = useState("");
  const [asOfDate, setAsOfDate] = useState("");
  const [currentOnly, setCurrentOnly] = useState(false);
  const [form, setForm] = useState<PriceForm>(emptyForm);

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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : pick("가격 이력을 불러오지 못했습니다.", "Failed to load price history"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFactories();
  }, []);

  useEffect(() => {
    if (!ready) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRows();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, factoryId, currentOnly]);

  const currentRows = useMemo(() => {
    const map = new Map<string, PriceRow>();
    for (const row of rows) {
      const key = `${row.factoryId}::${row.sku}`;
      const existing = map.get(key);
      if (!existing || row.effectiveDate > existing.effectiveDate) map.set(key, row);
    }
    return Array.from(map.values()).sort((a, b) => a.sku.localeCompare(b.sku));
  }, [rows]);

  const selectedSkuHistory = useMemo(() => {
    if (!form.sku.trim()) return [];
    const sku = form.sku.trim().toUpperCase();
    return rows.filter((row) => row.sku.toUpperCase() === sku);
  }, [form.sku, rows]);

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
        currency: form.currency,
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
    await loadRows();
  }

  async function uploadFile(file: File) {
    if (!canCreate) return toast.error(pick("Price List를 업로드할 권한이 없습니다.", "No permission to upload price lists"));
    if (!factoryId) return toast.error(pick("업로드 전에 공장을 선택하세요.", "Select a factory before upload"));
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("factoryId", factoryId);
      formData.append("currency", "USD");
      const res = await fetch(apiPath("/api/production/price-history"), { method: "PATCH", body: formData });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || pick("업로드에 실패했습니다.", "Upload failed"));
      const errors = json.data?.errors ?? [];
      toast.success(pick(
        `${json.data?.imported ?? 0}개 행을 가져왔습니다${errors.length ? `, ${errors.length}개 건너뜀` : ""}`,
        `Imported ${json.data?.imported ?? 0} rows${errors.length ? `, ${errors.length} skipped` : ""}`
      ));
      if (errors.length) console.warn("Price list import errors", errors);
      await loadRows();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : pick("업로드에 실패했습니다.", "Upload failed"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
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
        factory_id: factoryId || "1",
        sku: "CN15D",
        effective_date: "2026-07-06",
        unit_price: 32.1,
        currency: "USD",
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
      currency: row.currency,
      reason: row.reason ?? "",
    });
  }

  return (
    <div className="min-h-[calc(100vh-64px)] bg-[#f6f7f9] px-5 py-5 text-[#1a1917]">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{pick("Invoice & Price Control", "Invoice & Price Control")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{pick("Invoice 검수를 위한 SKU 가격 이력 마스터입니다.", "SKU price history master for invoice validation.")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50">
              <Download className="h-4 w-4" /> {pick("양식", "Template")}
            </button>
            <button type="button" onClick={exportRows} className="inline-flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50">
              <Download className="h-4 w-4" /> {pick("내보내기", "Export")}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv,.pdf"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadFile(file);
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

        <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="rounded-lg border bg-white p-4 shadow-sm">
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
                  {pick("통화", "Currency")}
                  <input value={form.currency} onChange={(e) => setForm((cur) => ({ ...cur, currency: e.target.value.toUpperCase() }))} className="mt-1 h-9 w-full rounded-md border px-2" />
                </label>
              </div>
              <label className="block text-xs font-medium">
                {pick("단가", "Unit Price")}
                <input type="number" step="0.0001" value={form.unitPrice} onChange={(e) => setForm((cur) => ({ ...cur, unitPrice: e.target.value }))} className="mt-1 h-9 w-full rounded-md border px-2" />
              </label>
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

          <div className="flex min-w-0 flex-col gap-4">
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-end gap-3">
                <label className="block min-w-52 flex-1 text-xs font-medium">
                  {pick("공장", "Factory")}
                  <select value={factoryId} onChange={(e) => setFactoryId(e.target.value)} className="mt-1 h-9 w-full rounded-md border px-2">
                    <option value="">{pick("전체 공장", "All factories")}</option>
                    {factories.map((factory) => (
                      <option key={factory.id} value={factory.id}>{factory.factoryName}</option>
                    ))}
                  </select>
                </label>
                <label className="block min-w-56 flex-1 text-xs font-medium">
                  {pick("SKU 검색", "SKU Search")}
                  <div className="mt-1 flex h-9 items-center rounded-md border bg-white px-2">
                    <Search className="mr-2 h-4 w-4 text-muted-foreground" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void loadRows(); }} className="w-full outline-none" placeholder="CN15D" />
                  </div>
                </label>
                <label className="block text-xs font-medium">
                  {pick("기준 날짜", "As Of Date")}
                  <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="mt-1 h-9 rounded-md border px-2" />
                </label>
                <label className="mb-2 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={currentOnly} onChange={(e) => setCurrentOnly(e.target.checked)} />
                  {pick("현재 가격만", "Current only")}
                </label>
                <button type="button" onClick={() => void loadRows()} className="inline-flex h-9 items-center gap-2 rounded-md border bg-white px-3 text-sm font-medium hover:bg-slate-50">
                  <RefreshCcw className="h-4 w-4" /> {pick("새로고침", "Refresh")}
                </button>
              </div>
            </div>

            <div className="rounded-lg border bg-white shadow-sm">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="text-sm font-semibold">{pick("가격 이력", "Price History")}</div>
                <div className="text-xs text-muted-foreground">{loading ? pick("불러오는 중...", "Loading...") : pick(`${rows.length}개 행`, `${rows.length} rows`)}</div>
              </div>
              <div className="max-h-[640px] overflow-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">SKU</th>
                      <th className="px-3 py-2">{pick("공장", "Factory")}</th>
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
                    {rows.map((row) => (
                      <tr key={row.id} className="border-t hover:bg-slate-50">
                        <td className="px-3 py-2 font-mono font-semibold">{row.sku}</td>
                        <td className="px-3 py-2">{row.factoryName}</td>
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
                            <a className="text-[#1a5cdb] hover:underline" href={apiPath(`/api/production/price-history/files/${row.sourceFileId}`)}>
                              {row.sourceFileName || `File ${row.sourceFileId}`}
                            </a>
                          ) : "-"}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-2">
                            <button type="button" onClick={() => editRow(row)} className="rounded border px-2 py-1 text-xs">{pick("수정", "Edit")}</button>
                            <button type="button" disabled={!canDelete} onClick={() => void deleteRow(row.id)} className="rounded border px-2 py-1 text-xs text-red-600 disabled:opacity-40">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!rows.length && (
                      <tr>
                        <td colSpan={10} className="px-3 py-10 text-center text-muted-foreground">{pick("가격 이력이 없습니다.", "No price history found.")}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="mb-3 text-sm font-semibold">{pick("현재 가격 요약", "Current Price Snapshot")}</div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {currentRows.slice(0, 12).map((row) => (
                  <button key={`${row.factoryId}-${row.sku}`} type="button" onClick={() => editRow(row)} className="rounded-md border p-3 text-left hover:bg-slate-50">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-sm font-semibold">{row.sku}</span>
                      <span className="text-sm font-bold">{money(row.unitPrice, row.currency)}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{row.factoryName} · {pick("적용 시작일", "since")} {row.effectiveDate}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
