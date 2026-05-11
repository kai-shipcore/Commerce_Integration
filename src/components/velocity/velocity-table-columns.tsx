"use client";

import { type ColumnDef } from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon, CaretSortIcon } from "@radix-ui/react-icons";
import { DataTableColumnHeader } from "@/components/ui/data-table/data-table-column-header";
import { cn } from "@/lib/utils";

export type VelocityRow = {
  masterSku: string;
  qtys: (number | null)[];
  customMasterSku?: string | null;
  customQtys?: (number | null)[];
  ttmCount?: number | null;
  ttmMasterSku?: string | null;
  isTotal?: boolean;
};

function QtyCell({ value, isTotal }: { value: number | null; isTotal?: boolean }) {
  if (value == null) return <PlaceholderCell />;
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

function makeQtyCol(periodIdx: number, label: string): ColumnDef<VelocityRow> {
  return {
    id: `qty_${periodIdx}`,
    accessorFn: (row) => row.qtys[periodIdx] ?? 0,
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
        <QtyCell value={row.original.qtys[periodIdx] ?? null} isTotal={row.original.isTotal} />
      </div>
    ),
    enableSorting: true,
  };
}

function makeCustomQtyCol(periodIdx: number, label: string): ColumnDef<VelocityRow> {
  return {
    id: `customQty_${periodIdx}`,
    accessorFn: (row) => row.customQtys?.[periodIdx] ?? null,
    header: () => <div className="text-right text-xs font-medium text-muted-foreground">{label}</div>,
    cell: ({ row }) => {
      const val = row.original.customQtys?.[periodIdx];
      return (
        <div className="text-right">
          {val != null ? (
            <QtyCell value={val} isTotal={row.original.isTotal} />
          ) : (
            <PlaceholderCell />
          )}
        </div>
      );
    },
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

function createGroupedVelocityColumns(
  linkGroupName: string,
  customGroupName: string,
  labels: string[]
): ColumnDef<VelocityRow>[] {
  return [
    masterSkuCol,
    {
      id: "linkGroup",
      header: linkGroupName,
      columns: labels.map((label, i) => makeQtyCol(i, label)),
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
            return (
              <div className="pl-6 border-l-2 border-border">
                {row.original.isTotal ? (
                  <span className="font-semibold text-xs">Total</span>
                ) : cSku ? (
                  <span className="font-mono text-xs">{cSku}</span>
                ) : (
                  <PlaceholderCell />
                )}
              </div>
            );
          },
          enableSorting: false,
        } as ColumnDef<VelocityRow>,
        ...labels.map((label, i) => makeCustomQtyCol(i, label)),
      ],
    },
  ];
}

export function createSalesSalesColumns(labels: string[]): ColumnDef<VelocityRow>[] {
  return createGroupedVelocityColumns("Link Sales", "Custom Sales", labels);
}

export function createTtmColumns(labels: string[]): ColumnDef<VelocityRow>[] {
  return createGroupedVelocityColumns("Link TTM", "Custom TTM", labels);
}

export function createPreOrderColumns(): ColumnDef<VelocityRow>[] {
  return [
    masterSkuCol,
    {
      id: "linkPreOrderGroup",
      header: "Link Pre Order",
      columns: [makeQtyCol(0, "Total")],
    },
    {
      id: "customPreOrderGroup",
      header: "Custom Pre Order",
      columns: [
        {
          id: "cpo_master_sku",
          header: () => (
            <div className="pl-6 border-l-2 border-border text-xs font-medium text-muted-foreground">
              Master SKU
            </div>
          ),
          cell: ({ row }: { row: { original: VelocityRow } }) => {
            const cSku = row.original.customMasterSku;
            return (
              <div className="pl-6 border-l-2 border-border">
                {row.original.isTotal ? (
                  <span className="font-semibold text-xs">Total</span>
                ) : cSku ? (
                  <span className="font-mono text-xs">{cSku}</span>
                ) : (
                  <PlaceholderCell />
                )}
              </div>
            );
          },
          enableSorting: false,
        } as ColumnDef<VelocityRow>,
        makeCustomQtyCol(0, "Total"),
      ],
    },
    {
      id: "ttmPreOrderGroup",
      header: "TTM Pre Order",
      columns: [
        {
          id: "tpo_master_sku",
          header: () => (
            <div className="pl-6 border-l-2 border-border text-xs font-medium text-muted-foreground">
              Master SKU
            </div>
          ),
          cell: ({ row }: { row: { original: VelocityRow } }) => {
            const tSku = row.original.ttmMasterSku;
            return (
              <div className="pl-6 border-l-2 border-border">
                {row.original.isTotal ? (
                  <span className="font-semibold text-xs">Total</span>
                ) : tSku ? (
                  <span className="font-mono text-xs">{tSku}</span>
                ) : (
                  <PlaceholderCell />
                )}
              </div>
            );
          },
          enableSorting: false,
        } as ColumnDef<VelocityRow>,
        {
          id: "ttmCount",
          header: () => <div className="text-right text-xs font-medium text-muted-foreground">Total</div>,
          cell: ({ row }) => (
            <div className="text-right">
              {row.original.ttmCount != null ? (
                <QtyCell value={row.original.ttmCount} isTotal={row.original.isTotal} />
              ) : (
                <PlaceholderCell />
              )}
            </div>
          ),
          enableSorting: false,
        } as ColumnDef<VelocityRow>,
      ],
    },
  ];
}

export function createChannelColumns(labels: string[]): ColumnDef<VelocityRow>[] {
  return [masterSkuCol, ...labels.map((label, i) => makeQtyCol(i, label))];
}
