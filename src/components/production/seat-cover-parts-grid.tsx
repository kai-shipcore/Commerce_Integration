"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  themeQuartz,
  type ColDef,
  type ColGroupDef,
  type ICellRendererParams,
} from "ag-grid-community";
import * as XLSX from "xlsx";
import { apiPath } from "@/lib/api-path";
import { SeatCoverPartsEditDialog } from "./seat-cover-parts-edit-dialog";

function UrlCellRenderer({ value }: ICellRendererParams) {
  if (!value) return null;
  const str = String(value);
  if (str.startsWith("http://") || str.startsWith("https://")) {
    return (
      <a
        href={str}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        style={{
          color: "#1a5cdb",
          textDecoration: "underline",
          fontSize: 12,
          whiteSpace: "nowrap",
        }}
      >
        View
      </a>
    );
  }
  return <span>{str}</span>;
}

function DpDetailCellRenderer({ value }: ICellRendererParams) {
  if (!value) return null;
  const str = String(value);
  if (str === "Driver 기준 대칭" || str.endsWith("-p"))
    return <span style={{ color: "#1a5cdb", fontSize: 12, fontWeight: 500 }}>Driver 기준 대칭</span>;
  if (str === "Passenger 기준 대칭" || str.endsWith("-d"))
    return <span style={{ color: "#b45309", fontSize: 12, fontWeight: 500 }}>Passenger 기준 대칭</span>;
  if (str === "동일")
    return <span style={{ color: "#16a34a", fontSize: 12, fontWeight: 500 }}>동일</span>;
  return <span>{str}</span>;
}

const modules = [AllCommunityModule];

const theme = themeQuartz.withParams({
  backgroundColor: "#fff",
  borderColor: "#D8D6CE",
  browserColorScheme: "light",
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  fontSize: 13,
  foregroundColor: "#1A1917",
  headerBackgroundColor: "#2A2825",
  headerFontSize: 12,
  headerTextColor: "rgba(255,255,255,.82)",
  oddRowBackgroundColor: "#FAFAF7",
  rowBorder: { color: "#D8D6CE" },
  selectedRowBackgroundColor: "#DCEAFF",
  spacing: 4,
});

type Tab = "front" | "rear" | "third";

const TABS: { key: Tab; label: string }[] = [
  { key: "front", label: "Front" },
  { key: "rear",  label: "Rear"  },
  { key: "third", label: "Third" },
];

const GUEST_HIDDEN_FIELDS = new Set(["inventory", "confirmed", "ymm", "fitting_dp_detail", "added_date"]);

function buildColDefs(tab: Tab, isGuest: boolean): (ColDef | ColGroupDef)[] {
  const hide = (f: string) => isGuest && GUEST_HIDDEN_FIELDS.has(f);

  function paired(headerName: string, driverField: string, dpField: string, passengerField: string): ColGroupDef {
    return {
      headerName,
      children: [
        { headerName: "Driver",    field: driverField,    minWidth: 130, flex: 2 },
        { headerName: "Passenger", field: passengerField, minWidth: 130, flex: 2 },
        { headerName: "D/P",       field: dpField,        minWidth: 140, flex: 2, cellRenderer: DpDetailCellRenderer },
      ],
    };
  }

  const cols: (ColDef | ColGroupDef)[] = [
    { headerName: "Size",      field: "size",      pinned: "left", minWidth: 160, flex: 2 },
    { headerName: "Inventory", field: "inventory", minWidth: 100,  flex: 1, hide: hide("inventory") },
    { headerName: "Confirmed", field: "confirmed", minWidth: 100,  flex: 1, hide: hide("confirmed") },
    { headerName: "Blueprint", field: "blueprint", minWidth: 100,  flex: 1 },
    { headerName: "Manual",    field: "manual",    minWidth: 100,  flex: 1 },
    { headerName: "YMM",       field: "ymm",       minWidth: 160,  flex: 2, hide: hide("ymm") },
  ];

  if (tab === "front" || tab === "rear") {
    cols.push({ headerName: "Fitting D/P", field: "fitting_dp_detail", minWidth: 130, flex: 2, hide: hide("fitting_dp_detail"), cellRenderer: DpDetailCellRenderer });
  }
  if (tab === "rear") {
    cols.push({ headerName: "Added Date", field: "added_date", minWidth: 110, flex: 1, hide: hide("added_date") });
  }

  cols.push({ headerName: "Package", field: "package", minWidth: 840, flex: 12 });

  cols.push(
    paired("Headrest",   "headrest", "headrest_dp_detail", "headrest2"),
    paired("Top / Body", "top_body", "top_body_dp_detail", "top_body2"),
    paired("Bottom",     "bottom",   "bottom_dp_detail",   "bottom2"),
  );

  cols.push({
    headerName: "Middle",
    children: [
      { headerName: "Headrest",   field: "middle_headrest", minWidth: 130, flex: 2 },
      { headerName: "Top / Body", field: "middle_top_body", minWidth: 130, flex: 2 },
      { headerName: "Bottom",     field: "middle_bottom",   minWidth: 130, flex: 2 },
    ],
  });

  if (tab === "rear" || tab === "third") {
    cols.push(
      { headerName: "Console", field: "console", minWidth: 130, flex: 2 },
      paired("Backrest Storage", "backrest_storage", "backrest_storage_dp_detail", "backrest_storage2"),
    );
  }

  cols.push(paired("Armrest", "armrest", "armrest_detail", "armrest2"));

  if (tab === "rear" || tab === "third") {
    cols.push(paired("Subpart", "subpart", "subpart_dp_detail", "subpart2"));
  }

  cols.push({ headerName: "Note", field: "note", minWidth: 160, flex: 3 });

  return cols;
}

export function SeatCoverPartsGrid({ role }: { role?: string }) {
  const isGuest = role === "guest";
  const [activeTab, setActiveTab] = useState<Tab>("front");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"add" | "edit">("edit");
  const [editData, setEditData] = useState<Record<string, unknown> | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!selectedRow?.id) return;
    const size = selectedRow.size ?? selectedRow.id;
    if (!window.confirm(`Delete "${size}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(
        apiPath(`/api/production/seat-cover-parts/${selectedRow.id}?tab=${activeTab}`),
        { method: "DELETE" }
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Delete failed");
      setSelectedRow(null);
      loadRows(activeTab);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }
  function flatLeafCols(defs: (ColDef | ColGroupDef)[]): ColDef[] {
    const out: ColDef[] = [];
    for (const c of defs) {
      if ("children" in c) {
        out.push(...flatLeafCols(c.children as (ColDef | ColGroupDef)[]));
      } else {
        out.push(c as ColDef);
      }
    }
    return out;
  }

  function handleExport() {
    const visibleCols = flatLeafCols(colDefs).filter((c) => !c.hide && c.field && c.headerName);
    const sheetData = rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const col of visibleCols) {
        out[col.headerName as string] = row[col.field as string] ?? "";
      }
      return out;
    });
    const ws = XLSX.utils.json_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, activeTab);
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `seat-cover-parts-${activeTab}-${today}.xlsx`);
  }

  const loadRows = useCallback((tab: Tab) => {
    setLoading(true);
    fetch(apiPath(`/api/production/seat-cover-parts?tab=${tab}`))
      .then((r) => r.json())
      .then((json) => setRows(json.data ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadRows(activeTab);
  }, [activeTab, loadRows]);

  const colDefs = useMemo(() => buildColDefs(activeTab, isGuest), [activeTab, isGuest]);

  const defaultColDef = useMemo<ColDef>(
    () => ({
      resizable: true,
      sortable: true,
      filter: "agTextColumnFilter",
      floatingFilter: true,
      suppressMovable: false,
      cellRenderer: UrlCellRenderer,
    }),
    []
  );

  return (
    <div
      style={{
        position: "fixed",
        top: "var(--app-header-height, 56px)",
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        flexDirection: "column",
        background: "#F0EEE9",
        overflow: "hidden",
        zIndex: 10,
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          background: "#fff",
          borderBottom: "1px solid #D8D6CE",
          height: 42,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1917" }}>
          Seat Cover Parts
        </span>
        {loading && (
          <span style={{ fontSize: 13, color: "#7A766F" }}>Loading…</span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: "#7A766F" }}>
            {rows.length.toLocaleString()} rows
          </span>
          <button
            onClick={handleExport}
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#1A1917",
              background: "#F0EEE9",
              border: "1px solid #D8D6CE",
              borderRadius: 6,
              padding: "5px 14px",
              cursor: "pointer",
            }}
          >
            Export
          </button>
          {!isGuest && (
            <>
              <button
                onClick={() => {
                  setDialogMode("add");
                  setEditData(null);
                  setDialogOpen(true);
                }}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#fff",
                  background: "#2A2825",
                  border: "1px solid #2A2825",
                  borderRadius: 6,
                  padding: "5px 14px",
                  cursor: "pointer",
                }}
              >
                Add
              </button>
              <button
                onClick={() => {
                  setDialogMode("edit");
                  setEditData(selectedRow);
                  setDialogOpen(true);
                }}
                disabled={!selectedRow}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: selectedRow ? "#1A1917" : "#A8A49E",
                  background: selectedRow ? "#F0EEE9" : "#F7F6F3",
                  border: "1px solid #D8D6CE",
                  borderRadius: 6,
                  padding: "5px 14px",
                  cursor: selectedRow ? "pointer" : "not-allowed",
                }}
              >
                Edit
              </button>
              <button
                onClick={handleDelete}
                disabled={!selectedRow || deleting}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: selectedRow && !deleting ? "#fff" : "#A8A49E",
                  background: selectedRow && !deleting ? "#C0392B" : "#F7F6F3",
                  border: `1px solid ${selectedRow && !deleting ? "#C0392B" : "#D8D6CE"}`,
                  borderRadius: 6,
                  padding: "5px 14px",
                  cursor: selectedRow && !deleting ? "pointer" : "not-allowed",
                }}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tab Bar */}
      <div
        style={{
          background: "#fff",
          borderBottom: "1px solid #D8D6CE",
          height: 40,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          gap: 6,
        }}
      >
        {TABS.map(({ key, label }) => {
          const active = activeTab === key;
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              style={{
                fontSize: 13,
                fontWeight: active ? 700 : 500,
                color: active ? "#fff" : "#1A1917",
                background: active ? "#2A2825" : "#F0EEE9",
                border: "1px solid #D8D6CE",
                borderRadius: 6,
                padding: "4px 14px",
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <SeatCoverPartsEditDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={() => loadRows(activeTab)}
        editData={editData}
        tab={activeTab}
        mode={dialogMode}
      />

      {/* Grid */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div className="h-full min-h-0 w-full overflow-hidden bg-white">
          <AgGridReact
            key={activeTab}
            modules={modules}
            theme={theme}
            rowData={rows}
            columnDefs={colDefs}
            defaultColDef={defaultColDef}
            suppressCellFocus={false}
            enableCellTextSelection
            rowSelection="single"
            onSelectionChanged={(e) => {
              const sel = e.api.getSelectedRows();
              setSelectedRow(sel[0] ?? null);
            }}
          />
        </div>
      </div>
    </div>
  );
}
