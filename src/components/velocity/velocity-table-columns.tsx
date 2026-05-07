"use client";

import { type ColumnDef } from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon, CaretSortIcon } from "@radix-ui/react-icons";
import { DataTableColumnHeader } from "@/components/ui/data-table/data-table-column-header";
import { cn } from "@/lib/utils";

export type VelocityRow = {
  masterSku: string;
  qty90d: number;
  qty60d: number;
  qty30d: number;
  qty15d: number;
  qty7d: number;
  customMasterSku?: string | null;
  customQty90d?: number | null;
  customQty60d?: number | null;
  customQty30d?: number | null;
  customQty15d?: number | null;
  customQty7d?: number | null;
  isTotal?: boolean;
};

function QtyCell({ value, isTotal }: { value: number; isTotal?: boolean }) {
  if (isTotal) {
    return <span className="font-semibold tabular-nums">{value.toLocaleString()}</span>;
  }
  return (
    <span
      className={cn(
        "tabular-nums",
        value === 0 && "text-muted-foreground",
        value >= 1 && value <= 2 && "text-amber-600 font-medium"
      )}
    >
      {value.toLocaleString()}
    </span>
  );
}

function PlaceholderCell() {
  return <span className="text-muted-foreground/40 tabular-nums select-none">—</span>;
}

function makeQtyCol(
  key: keyof Pick<VelocityRow, "qty90d" | "qty60d" | "qty30d" | "qty15d" | "qty7d">,
  label: string
): ColumnDef<VelocityRow> {
  return {
    accessorKey: key,
    header: ({ column }) => {
      const sorted = column.getIsSorted();
      return (
        <button
          className="ml-auto flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground focus:outline-none"
          onClick={() => column.toggleSorting(sorted === "asc")}
        >
          {label}
          {sorted === "asc" ? (
            <ArrowUpIcon className="h-3 w-3" />
          ) : sorted === "desc" ? (
            <ArrowDownIcon className="h-3 w-3" />
          ) : (
            <CaretSortIcon className="h-3 w-3" />
          )}
        </button>
      );
    },
    cell: ({ row }) => (
      <div className="text-right">
        <QtyCell value={row.original[key]} isTotal={row.original.isTotal} />
      </div>
    ),
    enableSorting: true,
  };
}

function makeCustomQtyCol(
  key: keyof Pick<VelocityRow, "customQty90d" | "customQty60d" | "customQty30d" | "customQty15d" | "customQty7d">,
  label: string
): ColumnDef<VelocityRow> {
  return {
    id: key,
    header: () => <div className="text-right text-xs font-medium text-muted-foreground">{label}</div>,
    cell: ({ row }) => (
      <div className="text-right">
        {row.original[key] != null ? (
          <QtyCell value={row.original[key] as number} isTotal={row.original.isTotal} />
        ) : (
          <PlaceholderCell />
        )}
      </div>
    ),
    enableSorting: false,
  };
}

const masterSkuCol: ColumnDef<VelocityRow> = {
  accessorKey: "masterSku",
  header: ({ column }) => <DataTableColumnHeader column={column} title="Master SKU" />,
  cell: ({ row }) => (
    <span className={cn("font-mono text-xs", row.original.isTotal && "font-semibold")}>
      {row.original.isTotal ? "Total" : row.original.masterSku}
    </span>
  ),
  enableSorting: true,
};

const linkSalesQtyCols = [
  makeQtyCol("qty90d", "90 D"),
  makeQtyCol("qty60d", "60 D"),
  makeQtyCol("qty30d", "30 D"),
  makeQtyCol("qty15d", "15 D"),
  makeQtyCol("qty7d",  "7 D"),
];

function createGroupedVelocityColumns(linkGroupName: string, customGroupName: string): ColumnDef<VelocityRow>[] {
  return [
    masterSkuCol,
    {
      id: "linkGroup",
      header: linkGroupName,
      columns: linkSalesQtyCols,
    },
    {
      id: "customGroup",
      header: customGroupName,
      columns: [
        {
          id: "cs_master_sku",
          header: () => (
            <div className="pl-6 border-l-2 border-border text-xs font-medium text-muted-foreground">
              Master SKU
            </div>
          ),
          cell: ({ row }: { row: { original: VelocityRow } }) => {
            const cSku = row.original.customMasterSku;
            const isDifferent = cSku && cSku !== row.original.masterSku;
            return (
              <div className="pl-6 border-l-2 border-border">
                {row.original.isTotal ? (
                  <span className="font-semibold text-xs">Total</span>
                ) : cSku ? (
                  <span className={cn("font-mono text-xs", isDifferent && "text-amber-500 font-medium")}>
                    {cSku}
                  </span>
                ) : (
                  <PlaceholderCell />
                )}
              </div>
            );
          },
          enableSorting: false,
        } as ColumnDef<VelocityRow>,
        makeCustomQtyCol("customQty90d", "90 D"),
        makeCustomQtyCol("customQty60d", "60 D"),
        makeCustomQtyCol("customQty30d", "30 D"),
        makeCustomQtyCol("customQty15d", "15 D"),
        makeCustomQtyCol("customQty7d",  "7 D"),
      ],
    },
  ];
}

// Sales > Sales tab
export function createSalesSalesColumns(): ColumnDef<VelocityRow>[] {
  return createGroupedVelocityColumns("Link Sales", "Custom Sales");
}

// Sales > TTM tab
export function createTtmColumns(): ColumnDef<VelocityRow>[] {
  return createGroupedVelocityColumns("Link TTM", "Custom TTM");
}

// Channel tab: simple flat columns (no grouping)
export function createChannelColumns(): ColumnDef<VelocityRow>[] {
  return [masterSkuCol, ...linkSalesQtyCols];
}
