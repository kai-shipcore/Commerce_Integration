"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Boxes } from "lucide-react";
import * as XLSX from "xlsx";
import { apiPath } from "@/lib/api-path";

type StockSourceType = "remaining" | "mistake";
type StockSortColumn = "referenceNo" | "plNo" | "masterSku" | "totalQty" | "allocatedQty" | "availableQty" | "cbm" | "totalCbm" | "note";
type SortDirection = "asc" | "desc";

type AvailableStockRow = {
  id: string;
  sourceType: StockSourceType;
  referenceNo: string;
  plNo: string | null;
  masterSku: string;
  totalQty: number;
  availableQty: number;
  allocatedToContainer: number;
  cbm: number;
  note: string | null;
};

type StockForm = {
  referenceNo: string;
  plNo: string;
  masterSku: string;
  totalQty: string;
  cbm: string;
  note: string;
};

const emptyForm: StockForm = {
  referenceNo: "",
  plNo: "",
  masterSku: "",
  totalQty: "",
  cbm: "",
  note: "",
};

function allocatedQty(row: AvailableStockRow) {
  return row.totalQty - row.availableQty;
}

function stockSortValue(row: AvailableStockRow, column: StockSortColumn) {
  switch (column) {
    case "allocatedQty":
      return allocatedQty(row);
    case "totalCbm":
      return row.totalQty * row.cbm;
    case "plNo":
      return row.plNo ?? "";
    case "note":
      return row.note ?? "";
    default:
      return row[column];
  }
}

function compareStockRows(a: AvailableStockRow, b: AvailableStockRow, column: StockSortColumn) {
  const left = stockSortValue(a, column);
  const right = stockSortValue(b, column);
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}

function parseForm(form: StockForm) {
  const totalQty = Number.parseInt(form.totalQty, 10);
  const cbm = Number.parseFloat(form.cbm);
  if (!form.referenceNo.trim() || !form.masterSku.trim() || !Number.isInteger(totalQty) || totalQty <= 0 || !Number.isFinite(cbm) || cbm <= 0) {
    return null;
  }
  return {
    referenceNo: form.referenceNo.trim(),
    plNo: form.plNo.trim(),
    masterSku: form.masterSku.trim().toUpperCase(),
    totalQty,
    cbm,
    note: form.note.trim(),
  };
}

type ImportRow = {
  sourceType: StockSourceType;
  referenceNo: string;
  plNo: string;
  masterSku: string;
  totalQty: number;
  cbm?: number;
};

type SkuMasterLookup = {
  masterSku: string;
  cbmPerUnit: number;
};

function normalizeHeader(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function readAvailableStockWorkbook(workbook: XLSX.WorkBook): ImportRow[] {
  const importedRows: ImportRow[] = [];
  for (const sheetName of workbook.SheetNames) {
    const normalizedName = sheetName.toLowerCase();
    const sourceType: StockSourceType | null = normalizedName.includes("mistake")
      ? "mistake"
      : normalizedName.includes("remaining")
        ? "remaining"
        : null;
    if (!sourceType) continue;

    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      blankrows: false,
      defval: "",
      raw: true,
    });
    const headerIndex = rows.findIndex((row) => {
      const headers = row.map(normalizeHeader);
      return headers.includes("thnumber") && headers.includes("quantity") && (headers.includes("skg") || headers.includes("mastersku"));
    });
    if (headerIndex < 0) continue;
    const headers = rows[headerIndex].map(normalizeHeader);
    const referenceIndex = headers.indexOf("thnumber");
    const plIndex = headers.indexOf("pinumber");
    const skuIndex = headers.includes("skg") ? headers.indexOf("skg") : headers.indexOf("mastersku");
    const qtyIndex = headers.indexOf("quantity");
    const cbmIndex = headers.indexOf("cbm");

    for (const row of rows.slice(headerIndex + 1)) {
      const referenceNo = String(row[referenceIndex] ?? "").trim();
      const plNo = plIndex >= 0 ? String(row[plIndex] ?? "").trim() : "";
      const masterSku = String(row[skuIndex] ?? "").trim().toUpperCase();
      const totalQty = Number(row[qtyIndex]);
      if (!referenceNo || !masterSku || !Number.isInteger(totalQty) || totalQty <= 0) continue;
      const rowTotalCbm = cbmIndex >= 0 ? Number(row[cbmIndex]) : 0;
      const cbm = Number.isFinite(rowTotalCbm) && rowTotalCbm > 0 ? rowTotalCbm / totalQty : undefined;
      importedRows.push({ sourceType, referenceNo, plNo, masterSku, totalQty, cbm });
    }
  }
  return importedRows;
}

export function AvailableStockPage() {
  const [rows, setRows] = useState<AvailableStockRow[]>([]);
  const [sourceType, setSourceType] = useState<StockSourceType>("remaining");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  const [createForm, setCreateForm] = useState<StockForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<StockForm>(emptyForm);
  const [sortColumn, setSortColumn] = useState<StockSortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const importInputRef = useRef<HTMLInputElement | null>(null);

  async function loadRows() {
    setLoading(true);
    try {
      const response = await fetch(apiPath("/api/container-available-stock"), { cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error ?? "Failed to load available stock.");
      setRows(json.data as AvailableStockRow[]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load available stock.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRows();
  }, []);

  const tabRows = useMemo(() => rows.filter((row) => row.sourceType === sourceType), [rows, sourceType]);
  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return tabRows;
    return tabRows.filter((row) =>
      `${row.referenceNo} ${row.masterSku} ${row.note ?? ""}`.toLowerCase().includes(normalized)
    );
  }, [query, tabRows]);
  const sortedRows = useMemo(() => {
    if (!sortColumn) return visibleRows;
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...visibleRows].sort((left, right) => {
      const compared = compareStockRows(left, right, sortColumn);
      return compared === 0 ? left.id.localeCompare(right.id) : compared * direction;
    });
  }, [sortColumn, sortDirection, visibleRows]);
  const tabTotals = useMemo(
    () => ({
      masterSkuCount: new Set(tabRows.map((row) => row.masterSku)).size,
      totalQty: tabRows.reduce((sum, row) => sum + row.totalQty, 0),
      availableQty: tabRows.reduce((sum, row) => sum + row.availableQty, 0),
      allocatedQty: tabRows.reduce((sum, row) => sum + allocatedQty(row), 0),
    }),
    [tabRows]
  );

  function switchTab(next: StockSourceType) {
    setSourceType(next);
    setEditingId(null);
    setMessage("");
  }

  function toggleSort(column: StockSortColumn) {
    if (sortColumn === column) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }
    setSortColumn(column);
    setSortDirection("asc");
  }

  async function lookupSkuMaster(masterSku: string): Promise<SkuMasterLookup | null> {
    const sku = masterSku.trim().toUpperCase();
    if (!sku) return null;
    try {
      const response = await fetch(apiPath(`/api/planning/sku-master?masterSku=${encodeURIComponent(sku)}`), {
        cache: "no-store",
      });
      const json = await response.json();
      return response.ok && json.success ? (json.data as SkuMasterLookup) : null;
    } catch {
      return null;
    }
  }

  async function validateCreateSku() {
    const sku = createForm.masterSku.trim().toUpperCase();
    if (!sku) return;
    const found = await lookupSkuMaster(sku);
    if (!found) {
      setCreateForm((form) => ({ ...form, masterSku: sku }));
      setMessage(`SKU not found in SKU Master: ${sku}`);
      return;
    }
    setCreateForm((form) => ({
      ...form,
      masterSku: found.masterSku,
      cbm: form.cbm || String(found.cbmPerUnit),
    }));
    setMessage("");
  }

  async function validateEditSku() {
    const sku = editForm.masterSku.trim().toUpperCase();
    if (!sku) return;
    const found = await lookupSkuMaster(sku);
    if (!found) {
      setEditForm((form) => ({ ...form, masterSku: sku }));
      setMessage(`SKU not found in SKU Master: ${sku}`);
      return;
    }
    setEditForm((form) => ({
      ...form,
      masterSku: found.masterSku,
      cbm: form.cbm || String(found.cbmPerUnit),
    }));
    setMessage("");
  }

  async function createStock() {
    const parsed = parseForm(createForm);
    if (!parsed) {
      setMessage("Reference, Master SKU, positive quantity, and CBM are required.");
      return;
    }
    const found = await lookupSkuMaster(parsed.masterSku);
    if (!found) {
      setMessage(`SKU not found in SKU Master: ${parsed.masterSku}`);
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(apiPath("/api/container-available-stock"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceType, ...parsed }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error ?? "Failed to register stock.");
      setCreateForm(emptyForm);
      setMessage("Available stock registered.");
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to register stock.");
    } finally {
      setSaving(false);
    }
  }

  function beginEdit(row: AvailableStockRow) {
    setEditingId(row.id);
    setEditForm({
      referenceNo: row.referenceNo,
      plNo: row.plNo ?? "",
      masterSku: row.masterSku,
      totalQty: String(row.totalQty),
      cbm: String(row.cbm),
      note: row.note ?? "",
    });
    setMessage("");
  }

  async function updateStock(row: AvailableStockRow) {
    const parsed = parseForm(editForm);
    if (!parsed) {
      setMessage("Reference, Master SKU, positive quantity, and CBM are required.");
      return;
    }
    const found = await lookupSkuMaster(parsed.masterSku);
    if (!found) {
      setMessage(`SKU not found in SKU Master: ${parsed.masterSku}`);
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(apiPath("/api/container-available-stock"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, sourceType: row.sourceType, ...parsed }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error ?? "Failed to update stock.");
      setEditingId(null);
      setMessage("Available stock updated.");
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update stock.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteStock(row: AvailableStockRow) {
    if (!window.confirm(`Delete ${row.referenceNo} / ${row.masterSku}?`)) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(apiPath(`/api/container-available-stock?stockId=${encodeURIComponent(row.id)}`), {
        method: "DELETE",
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error ?? "Failed to delete stock.");
      if (editingId === row.id) setEditingId(null);
      setMessage("Available stock deleted.");
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete stock.");
    } finally {
      setSaving(false);
    }
  }

  async function importExcel(file: File) {
    setImporting(true);
    setMessage("");
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const importRows = readAvailableStockWorkbook(workbook);
      if (importRows.length === 0) {
        throw new Error("No valid Remaining or Mistake Order stock rows were found in the Excel file.");
      }
      const response = await fetch(apiPath("/api/container-available-stock"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import", rows: importRows }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error ?? "Failed to import Excel.");
      setMessage(`Imported ${json.data.inserted} rows. Skipped ${json.data.skipped} existing rows.`);
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to import Excel.");
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  function downloadTemplate() {
    const mistakeRows = [
      ["Mistaker orders(REMARK:NO PACKAGING)", "", "", ""],
      ["TH Number", "PI Number", "SKG", "quantity"],
    ];
    const remainingRows = [
      ["remained goods from previous orders (remark: already packaged)", "", "", "", "", "", "", ""],
      ["TH Number", "PI Number", "SKG", "quantity", "", "", "", "CBM"],
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(mistakeRows), "Mistake");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(remainingRows), "Remaining");
    XLSX.writeFile(workbook, "Remaining Stock list for Kai-template.xlsx");
  }

  return (
    <section className="available-stock-fullbleed flex min-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] px-6 py-4">
        <div className="flex items-start gap-2">
          <Boxes className="mt-1 h-5 w-5" />
          <div>
            <h1 className="text-lg font-semibold">Available Stock Management</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Manage produced stock held in Remaining and Mistake Order lists before container allocation.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="form-input h-9 w-64 bg-white text-sm"
            placeholder="Search SKU / reference..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
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
          <button type="button" onClick={downloadTemplate} className="h-9 rounded-md border border-[#cccac4] bg-white px-3 text-xs font-medium hover:bg-[#f0eee9]">
            Download Template
          </button>
          <button type="button" disabled={importing || saving} onClick={() => importInputRef.current?.click()} className="h-9 rounded-md bg-[#1a5cdb] px-4 text-xs font-semibold text-white hover:bg-[#1650c4] disabled:opacity-50">
            {importing ? "Importing..." : "Excel Import"}
          </button>
        </div>
      </header>

      <div className="flex border-b border-[#e2dfd8] px-6 pt-3">
        {(["remaining", "mistake"] as StockSourceType[]).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => switchTab(type)}
            className={`mr-2 rounded-t-lg border px-5 py-2 text-sm font-semibold ${
              sourceType === type
                ? "border-[#1a5cdb] border-b-white bg-white text-[#1a5cdb]"
                : "border-[#e2dfd8] bg-[#f0eee9] text-muted-foreground"
            }`}
          >
            {type === "remaining" ? "Remaining List" : "Mistake Order List"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-4 border-b border-[#e2dfd8] bg-[#f8f7f4]">
        <StockStat label="Master SKUs" value={tabTotals.masterSkuCount} />
        <StockStat label="Total Units" value={tabTotals.totalQty} />
        <StockStat label="Available Units" value={tabTotals.availableQty} />
        <StockStat label="Allocated Units" value={tabTotals.allocatedQty} />
      </div>

      <div className="border-b border-[#e2dfd8] bg-[#f8f7f4] px-5 py-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
          Register {sourceType === "remaining" ? "Remaining" : "Mistake Order"} Stock
        </div>
        <div className="grid gap-2 md:grid-cols-[125px_125px_1fr_90px_100px_1fr_auto]">
          <StockInput placeholder="Reference No." value={createForm.referenceNo} onChange={(value) => setCreateForm((form) => ({ ...form, referenceNo: value }))} />
          <StockInput placeholder="PI Number" value={createForm.plNo} onChange={(value) => setCreateForm((form) => ({ ...form, plNo: value }))} />
          <StockInput mono placeholder="Master SKU" value={createForm.masterSku} onChange={(value) => setCreateForm((form) => ({ ...form, masterSku: value }))} onBlur={() => void validateCreateSku()} />
          <StockInput type="number" placeholder="Qty" value={createForm.totalQty} onChange={(value) => setCreateForm((form) => ({ ...form, totalQty: value }))} />
          <StockInput type="number" placeholder="CBM" value={createForm.cbm} onChange={(value) => setCreateForm((form) => ({ ...form, cbm: value }))} />
          <StockInput placeholder="Note (optional)" value={createForm.note} onChange={(value) => setCreateForm((form) => ({ ...form, note: value }))} />
          <button type="button" disabled={saving} onClick={() => void createStock()} className="rounded-md border border-[#1a5cdb] bg-white px-4 text-xs font-semibold text-[#1a5cdb] disabled:opacity-50">
            Register
          </button>
        </div>
      </div>

      {message ? <div className="border-b border-[#e2dfd8] px-6 py-2 text-xs text-[#8a5300]">{message}</div> : null}

      <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
        <div className="grid grid-cols-[48px_120px_120px_minmax(200px,1fr)_85px_85px_85px_95px_105px_minmax(140px,1fr)_125px] bg-[#f0eee9] px-3 py-2 text-[11px] font-semibold uppercase text-muted-foreground">
          <span>No.</span>
          <StockSortHeader label="Reference" column="referenceNo" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
          <StockSortHeader label="PI Number" column="plNo" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
          <StockSortHeader label="Master SKU" column="masterSku" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
          <StockSortHeader label="Total Qty" column="totalQty" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
          <StockSortHeader label="Allocated" column="allocatedQty" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
          <StockSortHeader label="Available" column="availableQty" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
          <StockSortHeader label="CBM" column="cbm" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
          <StockSortHeader label="Total CBM" column="totalCbm" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
          <StockSortHeader label="Note" column="note" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} />
          <span>Actions</span>
        </div>
        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">Loading available stock...</div>
        ) : sortedRows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No available stock registered for this list.</div>
        ) : (
          sortedRows.map((row, index) => {
            const allocated = allocatedQty(row);
            const editing = editingId === row.id;
            return (
              <div key={row.id} className="grid grid-cols-[48px_120px_120px_minmax(200px,1fr)_85px_85px_85px_95px_105px_minmax(140px,1fr)_125px] items-center border-b border-[#e2dfd8] px-3 py-2 text-sm">
                <span className="font-mono text-xs text-muted-foreground">{index + 1}</span>
                {editing ? <StockInput value={editForm.referenceNo} onChange={(value) => setEditForm((form) => ({ ...form, referenceNo: value }))} /> : <span className="text-xs font-semibold">{row.referenceNo}</span>}
                {editing ? <StockInput value={editForm.plNo} onChange={(value) => setEditForm((form) => ({ ...form, plNo: value }))} /> : <span className="text-xs">{row.plNo || "-"}</span>}
                {editing ? <StockInput mono disabled={allocated > 0} value={editForm.masterSku} onChange={(value) => setEditForm((form) => ({ ...form, masterSku: value }))} onBlur={() => void validateEditSku()} /> : <span className="font-mono text-xs">{row.masterSku}</span>}
                {editing ? <StockInput type="number" value={editForm.totalQty} onChange={(value) => setEditForm((form) => ({ ...form, totalQty: value }))} /> : <span>{row.totalQty}</span>}
                <span className={allocated > 0 ? "font-semibold text-[#8a5300]" : ""}>{allocated}</span>
                <span className="font-semibold">{row.availableQty}</span>
                {editing ? <StockInput type="number" disabled={allocated > 0} value={editForm.cbm} onChange={(value) => setEditForm((form) => ({ ...form, cbm: value }))} /> : <span>{row.cbm.toFixed(4)}</span>}
                <span>{(row.totalQty * row.cbm).toFixed(2)}</span>
                {editing ? <StockInput value={editForm.note} onChange={(value) => setEditForm((form) => ({ ...form, note: value }))} /> : <span className="truncate text-xs text-muted-foreground">{row.note || "-"}</span>}
                <div className="flex gap-2">
                  {editing ? (
                    <>
                      <button type="button" disabled={saving} onClick={() => void updateStock(row)} className="text-xs font-semibold text-[#1a5cdb]">Save</button>
                      <button type="button" onClick={() => setEditingId(null)} className="text-xs font-semibold text-muted-foreground">Cancel</button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => beginEdit(row)} className="text-xs font-semibold text-[#1a5cdb]">Edit</button>
                      <button type="button" disabled={saving} onClick={() => void deleteStock(row)} className="text-xs font-semibold text-[#c42b2b]">Delete</button>
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

function StockStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-r border-[#e2dfd8] px-6 py-3 last:border-r-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{new Intl.NumberFormat("en-US").format(value)}</div>
    </div>
  );
}

function StockSortHeader({
  label,
  column,
  activeColumn,
  direction,
  onSort,
}: {
  label: string;
  column: StockSortColumn;
  activeColumn: StockSortColumn | null;
  direction: SortDirection;
  onSort: (column: StockSortColumn) => void;
}) {
  const active = activeColumn === column;
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      className={`flex items-center gap-1 text-left uppercase hover:text-foreground ${active ? "text-[#1a5cdb]" : ""}`}
      aria-label={`Sort by ${label} ${active && direction === "asc" ? "descending" : "ascending"}`}
    >
      <span>{label}</span>
      {active ? <span aria-hidden="true">{direction === "asc" ? "\u25B2" : "\u25BC"}</span> : null}
    </button>
  );
}

function StockInput({
  value,
  onChange,
  placeholder,
  type = "text",
  mono = false,
  disabled = false,
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "number";
  mono?: boolean;
  disabled?: boolean;
  onBlur?: () => void;
}) {
  return (
    <input
      className={`form-input h-8 w-full bg-white text-xs ${mono ? "font-mono" : ""}`}
      type={type}
      step={type === "number" ? "any" : undefined}
      min={type === "number" ? "0" : undefined}
      disabled={disabled}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
    />
  );
}
