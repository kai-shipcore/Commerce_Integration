"use client";

import { useEffect, useRef, useState } from "react";
import { Ship } from "lucide-react";
import * as XLSX from "xlsx";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { toast } from "sonner";

type TransitRecord = {
  id: string;
  sourceWarehouseCode: string;
  destWarehouseCode: string;
  masterSku: string;
  qty: number;
  status: "in_transit" | "arrived" | "cancelled";
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type WarehouseOption = {
  warehouseCode: string;
  warehouseName: string;
  warehouseType: string;
};

type AddForm = {
  sourceWarehouseCode: string;
  destWarehouseCode: string;
  masterSku: string;
  qty: string;
  notes: string;
};

const emptyForm: AddForm = {
  sourceWarehouseCode: "",
  destWarehouseCode: "",
  masterSku: "",
  qty: "",
  notes: "",
};

type StatusTab = "all" | "in_transit" | "arrived" | "cancelled";

const STATUS_TABS: { key: StatusTab; labelKo: string; labelEn: string }[] = [
  { key: "all",        labelKo: "전체",    labelEn: "All" },
  { key: "in_transit", labelKo: "이동 중", labelEn: "In Transit" },
  { key: "arrived",    labelKo: "도착 완료", labelEn: "Arrived" },
  { key: "cancelled",  labelKo: "취소",    labelEn: "Cancelled" },
];

function statusBadge(status: string, pick: (ko: string, en: string) => string) {
  if (status === "in_transit") {
    return (
      <span style={{ background: "#EFF6FF", color: "#1A4FC0", borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 600 }}>
        {pick("이동 중", "In Transit")}
      </span>
    );
  }
  if (status === "arrived") {
    return (
      <span style={{ background: "#ECFDF5", color: "#065F46", borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 600 }}>
        {pick("도착 완료", "Arrived")}
      </span>
    );
  }
  return (
    <span style={{ background: "#F1F5F9", color: "#64748B", borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 600 }}>
      {pick("취소", "Cancelled")}
    </span>
  );
}

type ImportRow = { masterSku: string; qty: number; notes: string };

type ImportForm = {
  sourceWarehouseCode: string;
  destWarehouseCode: string;
};

const XLSX_HEADERS = ["Master SKU", "Qty", "Notes"];

function normalizeHeader(v: unknown): string {
  return String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseQty(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(1, Math.round(v));
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : null;
}

function extractImportRows(workbook: XLSX.WorkBook): ImportRow[] {
  const skuKeys  = new Set(["mastersku", "sku", "master"]);
  const qtyKeys  = new Set(["qty", "quantity", "수량"]);
  const noteKeys = new Set(["notes", "note", "memo", "비고", "메모"]);

  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1, blankrows: false, defval: "", raw: true,
    });

    for (let ri = 0; ri < matrix.length; ri++) {
      const headers = matrix[ri].map(normalizeHeader);
      const skuIdx  = headers.findIndex((h) => skuKeys.has(h) || h.includes("mastersku"));
      const qtyIdx  = headers.findIndex((h) => qtyKeys.has(h));
      const noteIdx = headers.findIndex((h) => noteKeys.has(h));
      if (skuIdx < 0 || qtyIdx < 0) continue;

      const rows: ImportRow[] = [];
      for (let di = ri + 1; di < matrix.length; di++) {
        const row = matrix[di];
        const masterSku = String(row[skuIdx] ?? "").trim().toUpperCase();
        const qty = parseQty(row[qtyIdx]);
        if (!masterSku || qty === null) continue;
        const notes = noteIdx >= 0 ? String(row[noteIdx] ?? "").trim() : "";
        rows.push({ masterSku, qty, notes });
      }
      return rows;
    }
  }
  return [];
}

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([XLSX_HEADERS, ["EXAMPLE-SKU-001", 10, "Container ABC123"]]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Transit Import");
  XLSX.writeFile(wb, "transit_import_template.xlsx");
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function TransitStockPage() {
  const { pick } = useI18n();
  const { can } = usePermissions();
  const [records, setRecords] = useState<TransitRecord[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<StatusTab>("in_transit");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<AddForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Import modal state
  const [showImport, setShowImport] = useState(false);
  const [importForm, setImportForm] = useState<ImportForm>({ sourceWarehouseCode: "", destWarehouseCode: "" });
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function fetchRecords() {
    setLoading(true);
    try {
      const res = await fetch(apiPath("/api/planning/transit-records"), { cache: "no-store" });
      const json = await res.json();
      if (json.success) {
        setRecords((json.data as TransitRecord[]).map((r) => ({ ...r, id: String(r.id) })));
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  async function fetchWarehouses() {
    try {
      const res = await fetch(apiPath("/api/planning/warehouses"), { cache: "no-store" });
      const json = await res.json();
      if (json.success) setWarehouses(json.data as WarehouseOption[]);
    } catch {
      // silently fail
    }
  }

  useEffect(() => {
    void fetchRecords();
    void fetchWarehouses();
  }, []);

  const visibleRecords = records.filter((r) => activeTab === "all" || r.status === activeTab);

  const warehouseLabel = (code: string) => {
    const w = warehouses.find((wh) => wh.warehouseCode === code);
    return w ? `${w.warehouseName}` : code;
  };

  function openModal() {
    setForm(emptyForm);
    setShowModal(true);
  }

  async function submitAdd() {
    const qty = parseInt(form.qty, 10);
    if (!form.sourceWarehouseCode) { toast.error(pick("출발 창고를 선택하세요.", "Select a source warehouse.")); return; }
    if (!form.destWarehouseCode)   { toast.error(pick("도착 창고를 선택하세요.", "Select a destination warehouse.")); return; }
    if (form.sourceWarehouseCode === form.destWarehouseCode) { toast.error(pick("출발 창고와 도착 창고는 달라야 합니다.", "Source and destination warehouses must be different.")); return; }
    if (!form.masterSku.trim())    { toast.error(pick("Master SKU를 입력하세요.", "Enter a Master SKU.")); return; }
    if (isNaN(qty) || qty < 1)     { toast.error(pick("수량은 1 이상이어야 합니다.", "Qty must be at least 1.")); return; }

    setSaving(true);
    try {
      const res = await fetch(apiPath("/api/planning/transit-records"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceWarehouseCode: form.sourceWarehouseCode,
          destWarehouseCode: form.destWarehouseCode,
          masterSku: form.masterSku.trim().toUpperCase(),
          qty,
          notes: form.notes.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) { toast.error(json.error ?? pick("저장에 실패했습니다.", "Failed to save.")); return; }
      toast.success(pick("레코드가 추가되었습니다.", "Record added."));
      setShowModal(false);
      await fetchRecords();
    } finally {
      setSaving(false);
    }
  }

  function openImport() {
    setImportForm({ sourceWarehouseCode: "", destWarehouseCode: "" });
    setImportRows([]);
    setImportFileName(null);
    setImportError(null);
    if (fileRef.current) fileRef.current.value = "";
    setShowImport(true);
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    setImportError(null);
    setImportRows([]);
    void file.arrayBuffer().then((buf) => {
      try {
        const wb = XLSX.read(buf, { type: "array" });
        const rows = extractImportRows(wb);
        if (rows.length === 0) {
          setImportError(pick("유효한 행을 찾지 못했습니다. 템플릿을 확인하세요.", "No valid rows found. Check the template."));
        } else {
          setImportRows(rows);
        }
      } catch {
        setImportError(pick("파일 파싱 오류. 템플릿을 사용하세요.", "Parse error. Please use the template."));
      }
    });
  }

  async function submitImport() {
    if (!importForm.sourceWarehouseCode) { toast.error(pick("출발 창고를 선택하세요.", "Select a source warehouse.")); return; }
    if (!importForm.destWarehouseCode)   { toast.error(pick("도착 창고를 선택하세요.", "Select a destination warehouse.")); return; }
    if (importForm.sourceWarehouseCode === importForm.destWarehouseCode) { toast.error(pick("출발 창고와 도착 창고는 달라야 합니다.", "Source and destination must differ.")); return; }
    if (importRows.length === 0) { toast.error(pick("업로드할 파일을 선택하세요.", "Select a file to upload.")); return; }

    setImporting(true);
    try {
      const res = await fetch(apiPath("/api/planning/transit-records/import"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceWarehouseCode: importForm.sourceWarehouseCode,
          destWarehouseCode: importForm.destWarehouseCode,
          rows: importRows,
        }),
      });
      const json = await res.json();
      if (!json.success) { toast.error(json.error ?? pick("가져오기에 실패했습니다.", "Import failed.")); return; }
      toast.success(pick(`${json.inserted as number}개 레코드가 추가되었습니다.`, `${json.inserted as number} records imported.`));
      setShowImport(false);
      await fetchRecords();
    } finally {
      setImporting(false);
    }
  }

  async function markArrived(record: TransitRecord) {
    if (!can("transit-stock", "status")) {
      toast.error(pick("권한이 없습니다.", "No permission.")); return;
    }
    setSavingId(record.id);
    try {
      const res = await fetch(apiPath(`/api/planning/transit-records/${record.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "arrived" }),
      });
      const json = await res.json();
      if (!json.success) { toast.error(json.error ?? pick("상태 변경에 실패했습니다.", "Failed to update status.")); return; }
      toast.success(pick("도착 완료로 변경되었습니다.", "Marked as arrived."));
      await fetchRecords();
    } finally {
      setSavingId(null);
    }
  }

  async function deleteRecord(record: TransitRecord) {
    if (!can("transit-stock", "delete")) {
      toast.error(pick("권한이 없습니다.", "No permission.")); return;
    }
    const confirmed = window.confirm(
      pick(`SKU ${record.masterSku} 레코드를 삭제하시겠습니까?`, `Delete transit record for SKU ${record.masterSku}?`)
    );
    if (!confirmed) return;
    setSavingId(record.id);
    try {
      const res = await fetch(apiPath(`/api/planning/transit-records/${record.id}`), { method: "DELETE" });
      const json = await res.json();
      if (!json.success) { toast.error(json.error ?? pick("삭제에 실패했습니다.", "Failed to delete.")); return; }
      toast.success(pick("삭제되었습니다.", "Deleted."));
      await fetchRecords();
    } finally {
      setSavingId(null);
    }
  }

  const tabCounts: Record<StatusTab, number> = {
    all:        records.length,
    in_transit: records.filter((r) => r.status === "in_transit").length,
    arrived:    records.filter((r) => r.status === "arrived").length,
    cancelled:  records.filter((r) => r.status === "cancelled").length,
  };

  return (
    <section style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 7rem)", borderRadius: 16, border: "1px solid #e2dfd8", background: "#f5f4f0", boxShadow: "0 1px 4px rgba(0,0,0,.06)", overflow: "hidden" }}>

      {/* Header */}
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, borderBottom: "1px solid #e2dfd8", background: "#fff", padding: "16px 24px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <Ship style={{ marginTop: 3, width: 20, height: 20 }} />
          <div>
            <h1 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>{pick("재고 이동 (Transit Stock)", "Transit Stock")}</h1>
            <p style={{ marginTop: 4, fontSize: 12, color: "#888", margin: 0 }}>
              {pick("창고 간 이동 중인 SKU와 수량을 관리합니다", "Manage SKUs and quantities in transit between warehouses")}
            </p>
          </div>
        </div>
        {can("transit-stock", "create") && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={openImport}
              style={{ background: "#fff", color: "#1a5cdb", border: "1px solid #1a5cdb", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              {pick("엑셀 업로드", "Import Excel")}
            </button>
            <button
              type="button"
              onClick={openModal}
              style={{ background: "#1a5cdb", color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              {pick("+ 이동 추가", "+ Add Record")}
            </button>
          </div>
        )}
      </header>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #e2dfd8", background: "#fff", padding: "0 24px" }}>
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "10px 16px",
              fontSize: 13,
              fontWeight: activeTab === tab.key ? 700 : 400,
              color: activeTab === tab.key ? "#1a5cdb" : "#64748b",
              background: "none",
              border: "none",
              borderBottom: activeTab === tab.key ? "2px solid #1a5cdb" : "2px solid transparent",
              cursor: "pointer",
              whiteSpace: "nowrap",
            } as React.CSSProperties}
          >
            {pick(tab.labelKo, tab.labelEn)}
            <span style={{ marginLeft: 6, fontSize: 11, background: "#f1f5f9", color: "#64748b", borderRadius: 10, padding: "1px 6px" }}>
              {tabCounts[tab.key]}
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{ flex: 1, background: "#fff", overflow: "auto" }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#aaa", fontSize: 13 }}>{pick("로딩 중...", "Loading...")}</div>
        ) : visibleRecords.length === 0 ? (
          <div style={{ padding: 60, textAlign: "center", color: "#aaa" }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>🚢</div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{pick("이동 중인 재고가 없습니다", "No transit records found")}</div>
            {can("transit-stock", "create") && (
              <button
                type="button"
                onClick={openModal}
                style={{ marginTop: 12, background: "#1a5cdb", color: "#fff", border: "none", borderRadius: 6, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              >
                {pick("+ 이동 추가", "+ Add Record")}
              </button>
            )}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e2dfd8", background: "#f8f9fa" }}>
                <Th>{pick("출발 창고", "Source")}</Th>
                <Th>{pick("도착 창고", "Destination")}</Th>
                <Th>{pick("Master SKU", "Master SKU")}</Th>
                <Th align="right">{pick("수량", "Qty")}</Th>
                <Th>{pick("상태", "Status")}</Th>
                <Th>{pick("메모", "Notes")}</Th>
                <Th>{pick("생성일", "Date")}</Th>
                <Th>{pick("액션", "Actions")}</Th>
              </tr>
            </thead>
            <tbody>
              {visibleRecords.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid #f0eee9" }}>
                  <td style={tdStyle}>{warehouseLabel(r.sourceWarehouseCode)}</td>
                  <td style={tdStyle}>{warehouseLabel(r.destWarehouseCode)}</td>
                  <td style={{ ...tdStyle, fontFamily: "monospace", fontWeight: 600 }}>{r.masterSku}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.qty.toLocaleString()}</td>
                  <td style={tdStyle}>{statusBadge(r.status, pick)}</td>
                  <td style={{ ...tdStyle, color: "#888", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.notes ?? "—"}</td>
                  <td style={{ ...tdStyle, color: "#888" }}>{formatDate(r.createdAt)}</td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                    {r.status === "in_transit" && can("transit-stock", "status") && (
                      <button
                        type="button"
                        disabled={savingId === r.id}
                        onClick={() => void markArrived(r)}
                        title={pick("도착 완료로 변경", "Mark as arrived")}
                        style={{ marginRight: 6, background: "#ECFDF5", color: "#065F46", border: "1px solid #A7F3D0", borderRadius: 4, padding: "3px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer", opacity: savingId === r.id ? 0.5 : 1 }}
                      >
                        ✓ {pick("도착", "Arrived")}
                      </button>
                    )}
                    {can("transit-stock", "delete") && (
                      <button
                        type="button"
                        disabled={savingId === r.id}
                        onClick={() => void deleteRecord(r)}
                        title={pick("삭제", "Delete")}
                        style={{ background: "#fff", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 4, padding: "3px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer", opacity: savingId === r.id ? 0.5 : 1 }}
                      >
                        {pick("삭제", "Del")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Modal */}
      {showModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          <div style={{ background: "#fff", borderRadius: 12, padding: "28px 32px", width: "100%", maxWidth: 480, boxShadow: "0 8px 32px rgba(0,0,0,.18)" }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 20px" }}>🚢 {pick("재고 이동 추가", "Add Transit Record")}</h2>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <ModalField label={pick("출발 창고 *", "Source Warehouse *")}>
                <select
                  className="form-input bg-white"
                  value={form.sourceWarehouseCode}
                  onChange={(e) => setForm((f) => ({
                    ...f,
                    sourceWarehouseCode: e.target.value,
                    destWarehouseCode: f.destWarehouseCode === e.target.value ? "" : f.destWarehouseCode,
                  }))}
                >
                  <option value="">{pick("선택...", "Select...")}</option>
                  {warehouses.map((w) => (
                    <option key={w.warehouseCode} value={w.warehouseCode}>
                      {w.warehouseName} ({w.warehouseCode})
                    </option>
                  ))}
                </select>
              </ModalField>

              <ModalField label={pick("도착 창고 *", "Destination Warehouse *")}>
                <select
                  className="form-input bg-white"
                  value={form.destWarehouseCode}
                  onChange={(e) => setForm((f) => ({ ...f, destWarehouseCode: e.target.value }))}
                >
                  <option value="">{pick("선택...", "Select...")}</option>
                  {warehouses.filter((w) => w.warehouseCode !== form.sourceWarehouseCode).map((w) => (
                    <option key={w.warehouseCode} value={w.warehouseCode}>
                      {w.warehouseName} ({w.warehouseCode})
                    </option>
                  ))}
                </select>
              </ModalField>

              <ModalField label={pick("Master SKU *", "Master SKU *")}>
                <input
                  className="form-input bg-white"
                  value={form.masterSku}
                  onChange={(e) => setForm((f) => ({ ...f, masterSku: e.target.value }))}
                  placeholder="e.g. ABC-123"
                />
              </ModalField>

              <ModalField label={pick("수량 *", "Qty *")}>
                <input
                  type="number"
                  min={1}
                  className="form-input bg-white"
                  value={form.qty}
                  onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))}
                  placeholder="0"
                />
              </ModalField>

              <ModalField label={pick("메모 (선택)", "Notes (optional)")}>
                <textarea
                  className="form-input bg-white"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder={pick("예) 컨테이너 ABCD123", "e.g. Container ABCD123")}
                />
              </ModalField>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 22, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                disabled={saving}
                style={{ background: "#fff", border: "1px solid #ccc", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: "pointer", opacity: saving ? 0.5 : 1 }}
              >
                {pick("취소", "Cancel")}
              </button>
              <button
                type="button"
                onClick={() => void submitAdd()}
                disabled={saving}
                style={{ background: "#1a5cdb", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: saving ? 0.5 : 1 }}
              >
                {saving ? pick("저장 중...", "Saving...") : pick("저장", "Save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}
          onClick={(e) => { if (e.target === e.currentTarget && !importing) setShowImport(false); }}
        >
          <div style={{ background: "#fff", borderRadius: 12, padding: "28px 32px", width: "100%", maxWidth: 600, boxShadow: "0 8px 32px rgba(0,0,0,.18)", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>📥 {pick("엑셀 일괄 업로드", "Import from Excel")}</h2>
              <button
                type="button"
                onClick={downloadTemplate}
                style={{ fontSize: 12, color: "#1a5cdb", background: "none", border: "1px solid #1a5cdb", borderRadius: 5, padding: "4px 10px", cursor: "pointer" }}
              >
                {pick("템플릿 다운로드", "Download Template")}
              </button>
            </div>

            {/* Step 1: Warehouses */}
            <div style={{ background: "#f8fafc", borderRadius: 8, padding: "14px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>
                {pick("STEP 1 — 창고 선택", "STEP 1 — SELECT WAREHOUSES")}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>{pick("출발 창고 *", "Source *")}</span>
                  <select
                    className="form-input bg-white"
                    value={importForm.sourceWarehouseCode}
                    onChange={(e) => setImportForm((f) => ({
                      ...f,
                      sourceWarehouseCode: e.target.value,
                      destWarehouseCode: f.destWarehouseCode === e.target.value ? "" : f.destWarehouseCode,
                    }))}
                  >
                    <option value="">{pick("선택...", "Select...")}</option>
                    {warehouses.map((w) => (
                      <option key={w.warehouseCode} value={w.warehouseCode}>{w.warehouseName}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>{pick("도착 창고 *", "Destination *")}</span>
                  <select
                    className="form-input bg-white"
                    value={importForm.destWarehouseCode}
                    onChange={(e) => setImportForm((f) => ({ ...f, destWarehouseCode: e.target.value }))}
                  >
                    <option value="">{pick("선택...", "Select...")}</option>
                    {warehouses.filter((w) => w.warehouseCode !== importForm.sourceWarehouseCode).map((w) => (
                      <option key={w.warehouseCode} value={w.warehouseCode}>{w.warehouseName}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {/* Step 2: File upload */}
            <div style={{ background: "#f8fafc", borderRadius: 8, padding: "14px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>
                {pick("STEP 2 — 파일 업로드", "STEP 2 — UPLOAD FILE")}
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>
                {pick("컬럼: Master SKU, Qty, Notes", "Columns: Master SKU, Qty, Notes")}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleImportFile}
                style={{ fontSize: 13 }}
              />
              {importFileName && (
                <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>{importFileName}</div>
              )}
              {importError && (
                <div style={{ marginTop: 6, fontSize: 12, color: "#dc2626", fontWeight: 600 }}>{importError}</div>
              )}
            </div>

            {/* Preview */}
            {importRows.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#16a34a", marginBottom: 8 }}>
                  ✓ {importRows.length}{pick("개 행 파싱 완료", " rows parsed")}
                </div>
                <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 6 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "#f1f5f9" }}>
                        <th style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, color: "#64748b" }}>Master SKU</th>
                        <th style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600, color: "#64748b" }}>Qty</th>
                        <th style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, color: "#64748b" }}>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 50).map((r, i) => (
                        <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "5px 10px", fontFamily: "monospace", fontWeight: 600 }}>{r.masterSku}</td>
                          <td style={{ padding: "5px 10px", textAlign: "right" }}>{r.qty.toLocaleString()}</td>
                          <td style={{ padding: "5px 10px", color: "#94a3b8" }}>{r.notes || "—"}</td>
                        </tr>
                      ))}
                      {importRows.length > 50 && (
                        <tr>
                          <td colSpan={3} style={{ padding: "5px 10px", color: "#94a3b8", fontStyle: "italic" }}>
                            {pick(`... 외 ${importRows.length - 50}개`, `... and ${importRows.length - 50} more`)}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setShowImport(false)}
                disabled={importing}
                style={{ background: "#fff", border: "1px solid #ccc", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: "pointer", opacity: importing ? 0.5 : 1 }}
              >
                {pick("취소", "Cancel")}
              </button>
              <button
                type="button"
                onClick={() => void submitImport()}
                disabled={importing || importRows.length === 0}
                style={{ background: "#1a5cdb", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: (importing || importRows.length === 0) ? 0.5 : 1 }}
              >
                {importing ? pick("업로드 중...", "Uploading...") : pick(`${importRows.length}개 업로드`, `Upload ${importRows.length} rows`)}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th style={{ padding: "10px 14px", textAlign: align ?? "left", fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
      {children}
    </th>
  );
}

const tdStyle: React.CSSProperties = { padding: "10px 14px", verticalAlign: "middle" };

function ModalField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</span>
      {children}
    </label>
  );
}
