"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  themeQuartz,
  type ColDef,
} from "ag-grid-community";
import { apiPath } from "@/lib/api-path";
import { VehicleEditDialog } from "./vehicle-edit-dialog";

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

const colDefs: ColDef[] = [
  { headerName: "F Number",       field: "f_number",          pinned: "left", minWidth: 180, flex: 2 },
  { headerName: "Vehicle Type",   field: "vehicle_type",      minWidth: 110, flex: 1 },
  { headerName: "Year/Gen",       field: "year_generation",   minWidth: 110, flex: 1 },
  { headerName: "Make",           field: "make",              minWidth: 120, flex: 1 },
  { headerName: "Model",          field: "model",             minWidth: 140, flex: 2 },
  { headerName: "Model 2",        field: "model_2",           minWidth: 140, flex: 2 },
  { headerName: "SM1 Label",      field: "submodel_1_label",  minWidth: 100, flex: 1 },
  { headerName: "Submodel 1",     field: "submodel_1",        minWidth: 140, flex: 2 },
  { headerName: "SM2 Label",      field: "submodel_2_label",  minWidth: 100, flex: 1 },
  { headerName: "Submodel 2",     field: "submodel_2",        minWidth: 140, flex: 2 },
  { headerName: "SM3 Label",      field: "submodel_3_label",  minWidth: 100, flex: 1 },
  { headerName: "Submodel 3",     field: "submodel_3",        minWidth: 140, flex: 2 },
  { headerName: "SM4 Label",      field: "submodel_4_label",  minWidth: 100, flex: 1 },
  { headerName: "Submodel 4",     field: "submodel_4",        minWidth: 140, flex: 2 },
  { headerName: "SM5 Label",      field: "submodel_5_label",  minWidth: 100, flex: 1 },
  { headerName: "Submodel 5",     field: "submodel_5",        minWidth: 140, flex: 2 },
  { headerName: "SM6 Label",      field: "submodel_6_label",  minWidth: 100, flex: 1 },
  { headerName: "Submodel 6",     field: "submodel_6",        minWidth: 140, flex: 2 },
  { headerName: "Updated",        field: "updated_at",        minWidth: 160, flex: 2,
    valueFormatter: (p) => p.value ? new Date(p.value as string).toLocaleString() : "" },
];

const defaultColDef: ColDef = {
  resizable: true,
  sortable: true,
  filter: "agTextColumnFilter",
  floatingFilter: true,
  suppressMovable: false,
};

export function VehicleGrid() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"add" | "edit">("edit");
  const [editData, setEditData] = useState<Record<string, unknown> | null>(null);

  const loadRows = useCallback(() => {
    setLoading(true);
    fetch(apiPath("/api/production/product-vehicles"))
      .then((r) => r.json())
      .then((json) => setRows((json as { data?: Record<string, unknown>[] }).data ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadRows(); }, [loadRows]);

  async function syncVehicles() {
    setSyncing(true);
    setMessage("");
    try {
      const res = await fetch(apiPath("/api/product-vehicles/sync"), { method: "POST" });
      const json = await res.json() as { success: boolean; upserted?: number; deleted?: number; error?: string };
      if (!json.success) throw new Error(json.error ?? "Vehicle sync failed");
      setMessage(`Sync complete — upserted: ${json.upserted ?? 0}, deleted: ${json.deleted ?? 0}`);
      loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Vehicle sync failed");
    } finally {
      setSyncing(false);
    }
  }

  const colDefsMemo = useMemo(() => colDefs, []);

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
        <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1917" }}>Vehicles</span>
        {loading && <span style={{ fontSize: 13, color: "#7A766F" }}>Loading…</span>}
        {message && <span style={{ fontSize: 13, color: "#5A8A5A" }}>{message}</span>}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: "#7A766F" }}>{rows.length.toLocaleString()} rows</span>
          <button
            onClick={() => {
              setDialogMode("add");
              setEditData(null);
              setDialogOpen(true);
            }}
            style={{
              fontSize: 13, fontWeight: 600, color: "#fff",
              background: "#2A2825", border: "1px solid #2A2825",
              borderRadius: 6, padding: "5px 14px", cursor: "pointer",
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
              fontSize: 13, fontWeight: 600,
              color: selectedRow ? "#1A1917" : "#A8A49E",
              background: selectedRow ? "#F0EEE9" : "#F7F6F3",
              border: "1px solid #D8D6CE",
              borderRadius: 6, padding: "5px 14px",
              cursor: selectedRow ? "pointer" : "not-allowed",
            }}
          >
            Edit
          </button>
          <button
            onClick={() => void syncVehicles()}
            disabled={syncing || loading}
            style={{
              fontSize: 13, fontWeight: 600, color: "#fff",
              background: "#2A2825", border: "1px solid #2A2825",
              borderRadius: 6, padding: "5px 14px",
              cursor: syncing || loading ? "not-allowed" : "pointer",
              opacity: syncing || loading ? 0.6 : 1,
            }}
          >
            {syncing ? "Syncing…" : "Sync"}
          </button>
        </div>
      </div>

      <VehicleEditDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={loadRows}
        editData={editData}
        mode={dialogMode}
      />

      {/* Grid */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div className="h-full min-h-0 w-full overflow-hidden bg-white">
          <AgGridReact
            modules={modules}
            theme={theme}
            rowData={rows}
            columnDefs={colDefsMemo}
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
