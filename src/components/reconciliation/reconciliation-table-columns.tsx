"use client";

import { type ColumnDef } from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon, CaretSortIcon } from "@radix-ui/react-icons";
import { cn } from "@/lib/utils";
import type { ReconciliationRow, ReconciliationStatus } from "@/app/api/reconciliation/route";

export type { ReconciliationRow };

const STATUS_STYLES: Record<ReconciliationStatus, string> = {
  match:          "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  mismatch:       "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  velocity_only:  "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400",
  orders_only:    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
};

const STATUS_LABELS: Record<ReconciliationStatus, string> = {
  match:          "Match",
  mismatch:       "Mismatch",
  velocity_only:  "Velocity Only",
  orders_only:    "Orders Only",
};

function makeSortableHeader(label: string) {
  return function SortableHeader({ column }: { column: { getIsSorted: () => false | "asc" | "desc"; toggleSorting: (asc: boolean) => void } }) {
    const sorted = column.getIsSorted();
    return (
      <button
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground focus:outline-none"
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
  };
}

function makeRightSortableHeader(label: string) {
  return function SortableHeader({ column }: { column: { getIsSorted: () => false | "asc" | "desc"; toggleSorting: (asc: boolean) => void } }) {
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
  };
}

export function createReconciliationColumns(): ColumnDef<ReconciliationRow>[] {
  return [
    {
      accessorKey: "masterSku",
      header: makeSortableHeader("Master SKU"),
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.masterSku}</span>
      ),
      enableSorting: true,
    },
    {
      accessorKey: "platformSource",
      header: makeSortableHeader("Channel"),
      cell: ({ row }) => (
        <span className="text-sm">{row.original.platformSource}</span>
      ),
      enableSorting: true,
    },
    {
      accessorKey: "velocityQty",
      header: makeRightSortableHeader("Velocity Qty"),
      cell: ({ row }) => (
        <div className="text-right tabular-nums text-sm">
          {row.original.velocityQty.toLocaleString()}
        </div>
      ),
      enableSorting: true,
    },
    {
      accessorKey: "ordersQty",
      header: makeRightSortableHeader("Orders Qty"),
      cell: ({ row }) => (
        <div className="text-right tabular-nums text-sm">
          {row.original.ordersQty.toLocaleString()}
        </div>
      ),
      enableSorting: true,
    },
    {
      accessorKey: "diff",
      header: makeRightSortableHeader("Diff"),
      cell: ({ row }) => {
        const { diff, status } = row.original;
        if (status === "match") {
          return <div className="text-right tabular-nums text-sm text-muted-foreground">0</div>;
        }
        return (
          <div
            className={cn(
              "text-right tabular-nums text-sm font-medium",
              diff > 0 ? "text-sky-600 dark:text-sky-400" : "text-red-600 dark:text-red-400"
            )}
          >
            {diff > 0 ? "+" : ""}{diff.toLocaleString()}
          </div>
        );
      },
      enableSorting: true,
    },
    {
      accessorKey: "diffPct",
      header: () => <div className="text-right text-xs font-medium text-muted-foreground">Diff %</div>,
      cell: ({ row }) => {
        const { diffPct, status } = row.original;
        if (status === "match") {
          return <div className="text-right text-sm text-muted-foreground">0%</div>;
        }
        if (diffPct === null) {
          return <div className="text-right text-sm text-muted-foreground">—</div>;
        }
        return (
          <div
            className={cn(
              "text-right tabular-nums text-sm",
              diffPct > 0 ? "text-sky-600 dark:text-sky-400" : "text-red-600 dark:text-red-400"
            )}
          >
            {diffPct > 0 ? "+" : ""}{diffPct}%
          </div>
        );
      },
      enableSorting: false,
    },
    {
      accessorKey: "status",
      header: () => <div className="text-xs font-medium text-muted-foreground">Status</div>,
      cell: ({ row }) => {
        const status = row.original.status;
        return (
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
              STATUS_STYLES[status]
            )}
          >
            {STATUS_LABELS[status]}
          </span>
        );
      },
      enableSorting: false,
    },
  ];
}
