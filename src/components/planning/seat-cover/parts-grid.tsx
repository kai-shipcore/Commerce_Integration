"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  themeQuartz,
  type ColDef,
} from "ag-grid-community";
import { PartDialog } from "./add-part-dialog";
import { DeleteDialog } from "@/components/ui/delete-dialog";

const modules = [AllCommunityModule];

const theme = themeQuartz.withParams({
  backgroundColor: "#fff",
  borderColor: "#D8D6CE",
  browserColorScheme: "light",
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  fontSize: 14,
  foregroundColor: "#1A1917",
  headerBackgroundColor: "#2A2825",
  headerFontSize: 13,
  headerTextColor: "rgba(255,255,255,.82)",
  oddRowBackgroundColor: "#FAFAF7",
  rowBorder: { color: "#D8D6CE" },
  selectedRowBackgroundColor: "#DCEAFF",
  spacing: 4,
});

export type PartOrderRow = {
  id: string;
  requestReceivedAt: string;
  orderNumber: string;
  partNumber: string;
  correspondingSku: string | null;
  qty: number;
  orderRequest: string | null;
  partSku: string | null;
  partSkuValue: string | null;
  note: string | null;
  orderStatus: string | null;
  shipheroOrder: string | null;
  shippingStatus: string | null;
  updatedAt: string;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function fmtDate(value: string | null | undefined) {
  if (!value) return "";
  try {
    return dateFormatter.format(new Date(value));
  } catch {
    return value;
  }
}

export function PartsGrid() {
  const [rows, setRows] = useState<PartOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editData, setEditData] = useState<PartOrderRow | null>(null);
  const [selectedRow, setSelectedRow] = useState<PartOrderRow | null>(null);

  const loadRows = useCallback(() => {
    setLoading(true);
    fetch("/api/planning/seat-cover/parts")
      .then((r) => r.json())
      .then((json) => setRows(json.data ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const numFilterParams = {
    filterOptions: ["greaterThan", "equals", "notEqual", "lessThan", "inRange"],
    defaultOption: "greaterThan",
  };

  const colDefs = useMemo<ColDef<PartOrderRow>[]>(
    () => [
      {
        headerName: "Request Received Date",
        field: "requestReceivedAt",
        width: 170,
        sort: "asc",
        valueFormatter: (p) => fmtDate(p.value),
      },
      {
        headerName: "Order Number",
        field: "orderNumber",
        width: 140,
      },
      {
        headerName: "Part Number",
        field: "partNumber",
        width: 130,
      },
      {
        headerName: "해당SKU",
        field: "correspondingSku",
        width: 130,
      },
      {
        headerName: "QTY",
        field: "qty",
        width: 80,
        filter: "agNumberColumnFilter",
        filterParams: numFilterParams,
      },
      {
        headerName: "Order Request",
        field: "orderRequest",
        width: 160,
        filter: "agNumberColumnFilter",
        filterParams: numFilterParams,
      },
      {
        headerName: "PART SKU",
        field: "partSku",
        width: 130,
      },
      {
        headerName: "PART SKU(VALUE)",
        field: "partSkuValue",
        width: 150,
      },
      {
        headerName: "Note",
        field: "note",
        width: 180,
      },
      {
        headerName: "Order Status",
        field: "orderStatus",
        width: 130,
      },
      {
        headerName: "Shiphero Order",
        field: "shipheroOrder",
        width: 140,
      },
      {
        headerName: "Shipping Status",
        field: "shippingStatus",
        width: 140,
      },
      {
        headerName: "Last Updated Date",
        field: "updatedAt",
        width: 160,
        valueFormatter: (p) => fmtDate(p.value),
      },
    ],
    []
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({
      resizable: true,
      sortable: true,
      suppressMovable: false,
      cellStyle: { textAlign: "left" },
      filter: "agTextColumnFilter",
      floatingFilter: true,
    }),
    []
  );

  return (
    <div
      style={{
        position: "fixed",
        top: 56,
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
        <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1917" }}>Parts</span>
        {loading && (
          <span style={{ fontSize: 13, color: "#7A766F" }}>Loading…</span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <DeleteDialog
            trigger={
              <button
                disabled={!selectedRow}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: selectedRow ? "#c0392b" : "#A8A49E",
                  background: selectedRow ? "#FEF2F2" : "#F7F6F3",
                  border: `1px solid ${selectedRow ? "#FECACA" : "#D8D6CE"}`,
                  borderRadius: 6,
                  padding: "5px 12px",
                  cursor: selectedRow ? "pointer" : "not-allowed",
                }}
              >
                Delete
              </button>
            }
            title="Delete Part"
            description={`Order #${selectedRow?.orderNumber ?? ""} 행을 삭제합니다. 되돌릴 수 없습니다.`}
            onConfirm={async () => {
              await fetch(`/api/planning/seat-cover/parts/${selectedRow!.id}`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ orderNumber: selectedRow!.orderNumber }),
              });
              setSelectedRow(null);
              loadRows();
            }}
          />
          <button
            onClick={() => {
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
              padding: "5px 12px",
              cursor: selectedRow ? "pointer" : "not-allowed",
            }}
          >
            Edit
          </button>
          <button
            onClick={() => {
              setEditData(null);
              setDialogOpen(true);
            }}
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#fff",
              background: "#2A2825",
              border: "none",
              borderRadius: 6,
              padding: "5px 12px",
              cursor: "pointer",
            }}
          >
            + Add Row
          </button>
        </div>
      </div>

      <PartDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={loadRows}
        editData={editData}
      />

      {/* Grid */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div className="h-full min-h-0 w-full overflow-x-auto overflow-y-hidden bg-white">
          <div className="h-full min-h-0">
            <AgGridReact<PartOrderRow>
              modules={modules}
              theme={theme}
              rowData={rows}
              columnDefs={colDefs}
              defaultColDef={defaultColDef}
              suppressCellFocus={false}
              enableCellTextSelection
              rowSelection="single"
              onSelectionChanged={(e) => {
                const selected = e.api.getSelectedRows();
                setSelectedRow(selected[0] ?? null);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
