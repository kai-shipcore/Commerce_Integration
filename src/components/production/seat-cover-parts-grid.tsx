"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  themeQuartz,
  type ColDef,
} from "ag-grid-community";
import { apiPath } from "@/lib/api-path";
import { SeatCoverPartsEditDialog } from "./seat-cover-parts-edit-dialog";

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

function buildColDefs(tab: Tab): ColDef[] {
  const base: ColDef[] = [
    { headerName: "Size",          field: "size",             pinned: "left", minWidth: 160, flex: 2 },
    { headerName: "Inventory",     field: "inventory",        minWidth: 100, flex: 1 },
    { headerName: "Confirmed",     field: "confirmed",        minWidth: 100, flex: 1 },
    { headerName: "Blueprint",     field: "blueprint",        minWidth: 100, flex: 1 },
    { headerName: "Manual",        field: "manual",           minWidth: 100, flex: 1 },
    { headerName: "YMM",           field: "ymm",              minWidth: 160, flex: 2 },
  ];

  if (tab === "front" || tab === "rear") {
    base.push({ headerName: "Fitting D/P Detail", field: "fitting_dp_detail", minWidth: 130, flex: 2 });
  }
  if (tab === "rear") {
    base.push({ headerName: "Added Date", field: "added_date", minWidth: 110, flex: 1 });
  }

  base.push({ headerName: "Package", field: "package", minWidth: 100, flex: 1 });

  const partGroups: [string, string, string, string][] = [
    ["Headrest",              "headrest",        "headrest_dp_detail",     "headrest_qty"],
    ["Headrest 2",            "headrest2",       "headrest2_dp_detail",    "headrest2_qty"],
    ["Top / Body",            "top_body",        "top_body_dp_detail",     "top_body_qty"],
    ["Top / Body 2",          "top_body2",       "top_body2_dp_detail",    "top_body2_qty"],
    ["Bottom",                "bottom",          "bottom_dp_detail",       "bottom_qty"],
    ["Bottom 2",              "bottom2",         "bottom2_dp_detail",      "bottom2_qty"],
    ["Mid. Headrest",         "middle_headrest", "middle_headrest_detail", "middle_headrest_qty"],
    ["Mid. Top / Body",       "middle_top_body", "middle_top_body_detail", "middle_top_body_qty"],
    ["Mid. Bottom",           "middle_bottom",   "middle_bottom_detail",   "middle_bottom_qty"],
  ];

  for (const [label, part, detail, qty] of partGroups) {
    base.push(
      { headerName: label,         field: part,   minWidth: 130, flex: 2 },
      { headerName: "D/P Detail",  field: detail, minWidth: 130, flex: 2 },
      { headerName: "Qty",         field: qty,    minWidth: 60,  flex: 1 },
    );
  }

  if (tab === "rear" || tab === "third") {
    const extraGroups: [string, string, string, string][] = [
      ["Console",           "console",           "console_dp_detail",            "console_qty"],
      ["Backrest Storage",  "backrest_storage",  "backrest_storage_dp_detail",   "backrest_storage_qty"],
      ["Backrest Storage 2","backrest_storage2", "backrest_storage2_dp_detail",  "backrest_storage2_qty"],
    ];
    for (const [label, part, detail, qty] of extraGroups) {
      base.push(
        { headerName: label,        field: part,   minWidth: 140, flex: 2 },
        { headerName: "D/P Detail", field: detail, minWidth: 130, flex: 2 },
        { headerName: "Qty",        field: qty,    minWidth: 60,  flex: 1 },
      );
    }
  }

  const armGroups: [string, string, string, string][] = [
    ["Armrest",   "armrest",  "armrest_detail",  "armrest_qty"],
    ["Armrest 2", "armrest2", "armrest2_detail", "armrest2_qty"],
  ];
  for (const [label, part, detail, qty] of armGroups) {
    base.push(
      { headerName: label,        field: part,   minWidth: 110, flex: 2 },
      { headerName: "D/P Detail", field: detail, minWidth: 130, flex: 2 },
      { headerName: "Qty",        field: qty,    minWidth: 60,  flex: 1 },
    );
  }

  if (tab === "rear" || tab === "third") {
    const subGroups: [string, string, string, string][] = [
      ["Subpart",   "subpart",  "subpart_dp_detail",  "subpart_qty"],
      ["Subpart 2", "subpart2", "subpart2_dp_detail", "subpart2_qty"],
    ];
    for (const [label, part, detail, qty] of subGroups) {
      base.push(
        { headerName: label,        field: part,   minWidth: 110, flex: 2 },
        { headerName: "D/P Detail", field: detail, minWidth: 130, flex: 2 },
        { headerName: "Qty",        field: qty,    minWidth: 60,  flex: 1 },
      );
    }
  }

  base.push({ headerName: "Note", field: "note", minWidth: 160, flex: 3 });

  return base;
}

export function SeatCoverPartsGrid() {
  const [activeTab, setActiveTab] = useState<Tab>("front");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"add" | "edit">("edit");
  const [editData, setEditData] = useState<Record<string, unknown> | null>(null);

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

  const colDefs = useMemo(() => buildColDefs(activeTab), [activeTab]);

  const defaultColDef = useMemo<ColDef>(
    () => ({
      resizable: true,
      sortable: true,
      filter: "agTextColumnFilter",
      floatingFilter: true,
      suppressMovable: false,
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
