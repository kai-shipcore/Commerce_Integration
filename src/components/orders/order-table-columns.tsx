"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { DataTableColumnHeader } from "@/components/ui/data-table/data-table-column-header";

export type OrderTableRow = {
  id: number;
  platformSource: string;
  orderNumber: string | null;
  externalOrderId: string | null;
  orderDate: string | null;
  orderStatus: string | null;
  totalPrice: number;
  currency: string | null;
  lineCount: number;
  unitCount: number;
  webSku: string | null;
  webSkuCount: number;
  masterSku: string | null;
  masterSkuCount: number;
};

function formatCurrency(value: number, currency: string | null) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function createOrderColumns(): ColumnDef<OrderTableRow>[] {
  return [
    {
      accessorKey: "platformSource",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Platform" />
      ),
      cell: ({ row }) => (
        <Badge variant="outline">{row.original.platformSource}</Badge>
      ),
    },
    {
      accessorKey: "orderNumber",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Order" />
      ),
      cell: ({ row }) => (
        <div className="font-medium">
          {row.original.orderNumber || row.original.externalOrderId || `Order ${row.original.id}`}
        </div>
      ),
      enableHiding: false,
    },
    {
      accessorKey: "webSku",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Web SKU" />
      ),
      cell: ({ row }) => {
        const { webSku, webSkuCount } = row.original;
        if (!webSku) return <span className="text-muted-foreground">-</span>;
        return (
          <div className="flex items-center gap-1">
            <span className="font-medium tabular-nums">{webSku}</span>
            {webSkuCount > 1 && (
              <Badge variant="secondary" className="text-xs px-1 py-0">
                +{webSkuCount - 1}
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "masterSku",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Master SKU" />
      ),
      cell: ({ row }) => {
        const { masterSku, masterSkuCount } = row.original;
        if (!masterSku) return <span className="text-muted-foreground">-</span>;
        return (
          <div className="flex items-center gap-1">
            <span className="font-medium tabular-nums">{masterSku}</span>
            {masterSkuCount > 1 && (
              <Badge variant="secondary" className="text-xs px-1 py-0">
                +{masterSkuCount - 1}
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "orderDate",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Order Time" />
      ),
      cell: ({ row }) => (
        <div className="text-sm text-muted-foreground">
          {row.original.orderDate
            ? new Date(row.original.orderDate).toLocaleString()
            : "-"}
        </div>
      ),
    },
    {
      accessorKey: "orderStatus",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Order Status" />
      ),
      cell: ({ row }) => (
        <Badge variant="secondary">
          {row.original.orderStatus || "Unknown"}
        </Badge>
      ),
    },
    {
      accessorKey: "lineCount",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Lines"
          className="justify-end"
        />
      ),
      cell: ({ row }) => (
        <div className="w-full text-right tabular-nums">
          {row.original.lineCount.toLocaleString()}
        </div>
      ),
    },
    {
      accessorKey: "unitCount",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Units"
          className="justify-end"
        />
      ),
      cell: ({ row }) => (
        <div className="w-full text-right tabular-nums">
          {row.original.unitCount.toLocaleString()}
        </div>
      ),
    },
    {
      accessorKey: "totalPrice",
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Total"
          className="justify-end"
        />
      ),
      cell: ({ row }) => (
        <div className="w-full text-right font-medium tabular-nums">
          {formatCurrency(row.original.totalPrice, row.original.currency)}
        </div>
      ),
    },
  ];
}
