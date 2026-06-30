"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { toast } from "sonner";

import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  themeQuartz,
  type ColDef,
  type RowClassParams,
} from "ag-grid-community";
import * as XLSX from "xlsx";
import { PartDialog } from "./add-part-dialog";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { ImportPartsDialog } from "./import-parts-dialog";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

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
  note: string | null;
  orderStatus: string | null;
  shipheroOrder: string | null;
  shipheroOrderId: string | null;
  shippingStatus: string | null;
  updatedAt: string;
};

const SHIPPING_STATUS_STYLE: Record<string, { background: string; color: string }> = {
  "Ready":     { background: "#DCFCE7", color: "#166534" },
  "Not Ready": { background: "#FEF3C7", color: "#92400E" },
  "Shipped":   { background: "#DBEAFE", color: "#1E40AF" },
  "Canceled":  { background: "#FEE2E2", color: "#991B1B" },
};

function ShippingStatusCell({ value }: { value: string | null }) {
  const v = value ?? "";
  const s = SHIPPING_STATUS_STYLE[v];
  if (!s) return <>{v}</>;
  return (
    <span style={{
      background: s.background,
      color: s.color,
      padding: "2px 8px",
      borderRadius: 9999,
      fontSize: 12,
      fontWeight: 600,
      whiteSpace: "nowrap",
    }}>{v}</span>
  );
}

function isOlderThan90Days(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  return new Date(dateStr) < cutoff;
}

function fmtDate(value: string | null | undefined) {
  if (!value) return "";
  const dateOnly = value.split("T")[0];
  const parts = dateOnly.split("-");
  if (parts.length !== 3) return value;
  const [y, m, d] = parts;
  return `${Number(m)}/${Number(d)}/${y}`;
}

const FILTER_LABEL: Record<string, string> = {
  "ready-not-ready": "ready_not_ready",
  shipped: "shipped",
  canceled: "canceled",
  deleted: "deleted",
};

function exportToExcel(rows: PartOrderRow[], tabKey: string) {
  const data = rows.map((r) => ({
    "Request Received Date": fmtDate(r.requestReceivedAt),
    "Order Number": r.orderNumber,
    "Part Number": r.partNumber,
    "해당SKU": r.correspondingSku ?? "",
    QTY: r.qty,
    "Order Request": r.orderRequest ?? "",
    "PART SKU": r.partSku ?? "",
    Note: r.note ?? "",
    "Order Status": r.orderStatus ?? "",
    "Shiphero Order": r.shipheroOrder ?? "",
    "Shipping Status": r.shippingStatus ?? "",
    "Last Updated Date": fmtDate(r.updatedAt),
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Parts");
  XLSX.writeFile(wb, `parts_${FILTER_LABEL[tabKey] ?? tabKey}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

type FilterKey = "ready-not-ready" | "shipped" | "canceled" | "deleted";


export function PartsGrid() {
  const { pick } = useI18n();
  const { can } = usePermissions();

  const FILTER_BUTTONS: { key: FilterKey; label: string }[] = useMemo(() => [
    { key: "ready-not-ready", label: pick("준비 / 미준비", "Ready / Not Ready") },
    { key: "shipped", label: pick("발송", "Shipped") },
    { key: "canceled", label: pick("취소", "Canceled") },
    { key: "deleted", label: pick("삭제됨", "Deleted") },
  ], [pick]);

  const [rows, setRows] = useState<PartOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editData, setEditData] = useState<PartOrderRow | null>(null);
  const [selectedRow, setSelectedRow] = useState<PartOrderRow | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("ready-not-ready");
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  const loadRows = useCallback(() => {
    setLoading(true);
    const url = apiPath(activeFilter === "deleted"
      ? "/api/planning/seat-cover/parts?deleted=true"
      : "/api/planning/seat-cover/parts");
    fetch(url)
      .then((r) => r.json())
      .then((json) => setRows(json.data ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [activeFilter]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const filteredRows = useMemo(() => {
    if (activeFilter === "ready-not-ready")
      return rows.filter((r) => r.shippingStatus === "Ready" || r.shippingStatus === "Not Ready");
    if (activeFilter === "shipped")
      return rows.filter((r) => r.shippingStatus === "Shipped");
    if (activeFilter === "canceled")
      return rows.filter((r) => r.shippingStatus === "Canceled");
    return rows; // deleted — API already filtered by deleteYN='Y'
  }, [rows, activeFilter]);

  const getRowStyle = useCallback(
    (params: RowClassParams<PartOrderRow>) => {
      if (activeFilter !== "ready-not-ready") return undefined;
      if (isOlderThan90Days(params.data?.requestReceivedAt)) {
        return { background: "#FFF3E0" };
      }
      return undefined;
    },
    [activeFilter]
  );

  const numFilterParams = {
    filterOptions: ["greaterThan", "equals", "notEqual", "lessThan", "inRange"],
    defaultOption: "greaterThan",
  };

  const colDefs = useMemo<ColDef<PartOrderRow>[]>(
    () => [
      {
        headerName: pick("접수일", "Request Received Date"),
        field: "requestReceivedAt",
        flex: 2,
        minWidth: 140,
        sort: "asc",
        valueFormatter: (p) => fmtDate(p.value),
      },
      {
        headerName: pick("주문번호", "Order Number"),
        field: "orderNumber",
        flex: 2,
        minWidth: 110,
      },
      {
        headerName: pick("파트 번호", "Part Number"),
        field: "partNumber",
        flex: 2,
        minWidth: 110,
      },
      {
        headerName: pick("해당 SKU", "Related SKU"),
        field: "correspondingSku",
        flex: 2,
        minWidth: 110,
      },
      {
        headerName: pick("수량", "QTY"),
        field: "qty",
        flex: 1,
        minWidth: 60,
        filter: "agNumberColumnFilter",
        filterParams: numFilterParams,
      },
      {
        headerName: pick("주문 요청", "Order Request"),
        field: "orderRequest",
        flex: 2,
        minWidth: 110,
        filter: "agNumberColumnFilter",
        filterParams: numFilterParams,
      },
      {
        headerName: "PART SKU",
        field: "partSku",
        flex: 2,
        minWidth: 110,
      },
      {
        headerName: pick("메모", "Note"),
        field: "note",
        flex: 3,
        minWidth: 140,
      },
      {
        headerName: pick("주문 상태", "Order Status"),
        field: "orderStatus",
        flex: 2,
        minWidth: 110,
      },
      {
        headerName: pick("Shiphero 주문", "Shiphero Order"),
        field: "shipheroOrder",
        flex: 2,
        minWidth: 110,
      },
      {
        headerName: pick("배송 상태", "Shipping Status"),
        field: "shippingStatus",
        flex: 2,
        minWidth: 110,
        cellRenderer: ShippingStatusCell,
      },
      {
        headerName: pick("최종 수정일", "Last Updated Date"),
        field: "updatedAt",
        flex: 2,
        minWidth: 140,
        valueFormatter: (p) => fmtDate(p.value),
      },
    ],
    [pick]
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
        <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1917" }}>{pick("부품 주문", "Parts")}</span>
        {loading && (
          <span style={{ fontSize: 13, color: "#7A766F" }}>{pick("로딩 중...", "Loading…")}</span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button
            onClick={() => exportToExcel(filteredRows, activeFilter)}
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#1A1917",
              background: "#F0EEE9",
              border: "1px solid #D8D6CE",
              borderRadius: 6,
              padding: "5px 12px",
              cursor: "pointer",
            }}
          >
            {pick("내보내기", "Export")}
          </button>
          {activeFilter === "ready-not-ready" && (
            <button
              onClick={() => setImportDialogOpen(true)}
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#1A1917",
                background: "#F0EEE9",
                border: "1px solid #D8D6CE",
                borderRadius: 6,
                padding: "5px 12px",
                cursor: "pointer",
              }}
            >
              {pick("가져오기", "Import")}
            </button>
          )}
          {activeFilter !== "deleted" && (
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
                  {pick("삭제", "Delete")}
                </button>
              }
              title={pick("부품 삭제", "Delete Part")}
              description={`Order #${selectedRow?.orderNumber ?? ""} ` + pick("행을 삭제합니다. 되돌릴 수 없습니다.", "row will be permanently deleted.")}
              onConfirm={async () => {
                if (!can("parts", "delete")) {
                  toast.error(pick("이 작업을 수행할 권한이 없습니다.", "You don't have permission to perform this action."));
                  return;
                }
                await fetch(apiPath(`/api/planning/seat-cover/parts/${selectedRow!.id}`), {
                  method: "DELETE",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ orderNumber: selectedRow!.orderNumber }),
                });
                setSelectedRow(null);
                loadRows();
              }}
            />
          )}
          {activeFilter !== "deleted" && (
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
              {pick("수정", "Edit")}
            </button>
          )}
          {activeFilter === "ready-not-ready" && (
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
              {pick("+ 행 추가", "+ Add Row")}
            </button>
          )}
        </div>
      </div>

      <PartDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={loadRows}
        editData={editData}
      />
      <ImportPartsDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onSuccess={loadRows}
      />

      {/* Filter Bar */}
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
        {FILTER_BUTTONS.map(({ key, label }) => {
          const active = activeFilter === key;
          return (
            <button
              key={key}
              onClick={() => {
                setActiveFilter(key);
                setSelectedRow(null);
              }}
              style={{
                fontSize: 13,
                fontWeight: active ? 700 : 500,
                color: active ? "#fff" : "#1A1917",
                background: active ? "#2A2825" : "#F0EEE9",
                border: "1px solid #D8D6CE",
                borderRadius: 6,
                padding: "4px 12px",
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Grid */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div className="h-full min-h-0 w-full overflow-x-auto overflow-y-hidden bg-white">
          <div className="h-full min-h-0">
            <AgGridReact<PartOrderRow>
              modules={modules}
              theme={theme}
              rowData={filteredRows}
              columnDefs={colDefs}
              defaultColDef={defaultColDef}
              getRowStyle={getRowStyle}
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
