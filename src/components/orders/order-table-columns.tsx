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
  financialStatus: string | null;
  salesChannel: string | null;
  shippingCountry: string | null;
  buyerEmail: string | null;
  totalPrice: number;
  currency: string | null;
  lineCount: number;
  unitCount: number;
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
      accessorKey: "orderNumber",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Order" />
      ),
      cell: ({ row }) => (
        <div className="space-y-1">
          <div className="font-medium">
            {row.original.orderNumber || `Order ${row.original.id}`}
          </div>
          <div className="text-xs text-muted-foreground">
            {row.original.externalOrderId || `Internal ID ${row.original.id}`}
          </div>
        </div>
      ),
      enableHiding: false,
    },
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
      accessorKey: "financialStatus",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Financial" />
      ),
      cell: ({ row }) => (
        <div className="text-sm">{row.original.financialStatus || "-"}</div>
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
    {
      accessorKey: "salesChannel",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Sales Channel" />
      ),
      cell: ({ row }) => (
        <div className="text-sm text-muted-foreground">
          {row.original.salesChannel || "-"}
        </div>
      ),
    },
    {
      accessorKey: "shippingCountry",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Country" />
      ),
      cell: ({ row }) => (
        <div className="text-sm">{row.original.shippingCountry || "-"}</div>
      ),
    },
    {
      accessorKey: "buyerEmail",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Buyer" />
      ),
      cell: ({ row }) => (
        <div className="max-w-[220px] truncate text-sm text-muted-foreground">
          {row.original.buyerEmail || "-"}
        </div>
      ),
    },
  ];
}
