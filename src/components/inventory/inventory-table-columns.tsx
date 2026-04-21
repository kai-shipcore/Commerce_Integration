"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Warehouse } from "lucide-react";
import { DataTableColumnHeader } from "@/components/ui/data-table/data-table-column-header";

export type InventoryTableRow = {
  masterSku: string;
  onHand: number;
  allocated: number;
  available: number;
  backorder: number;
  warehouse: string | null;
  warehouseCount?: number;
  createdAt: string | null;
};

export function createInventoryColumns(
  options?: { groupedByProduct?: boolean }
): ColumnDef<InventoryTableRow>[] {
  const groupedByProduct = options?.groupedByProduct ?? false;

  return [
    {
      accessorKey: "masterSku",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Master SKU" />
      ),
      cell: ({ row }) => (
        <div className="font-mono text-sm font-medium">
          {row.original.masterSku}
        </div>
      ),
      enableHiding: false,
    },
    ...(groupedByProduct
      ? [
          {
            accessorKey: "warehouseCount",
            header: ({ column }: { column: any }) => (
              <DataTableColumnHeader column={column} title="Warehouses" />
            ),
            cell: ({ row }: { row: any }) => (
              <Badge variant="outline">{row.original.warehouseCount ?? 0}</Badge>
            ),
          } satisfies ColumnDef<InventoryTableRow>,
        ]
      : [
          {
            accessorKey: "warehouse",
            header: ({ column }: { column: any }) => (
              <DataTableColumnHeader column={column} title="Warehouse" />
            ),
            cell: ({ row }: { row: any }) => (
              <Badge variant="outline">
                <Warehouse className="h-3 w-3" />
                {row.original.warehouse || "Unspecified"}
              </Badge>
            ),
            filterFn: (row: any, id: any, value: any) => {
              return value.includes((row.getValue(id) as string | null) || "Unspecified");
            },
          } satisfies ColumnDef<InventoryTableRow>,
        ]),
    {
      accessorKey: "onHand",
      size: 68,
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="On Hand"
          className="justify-end"
        />
      ),
      cell: ({ row }) => (
        <div className="w-full text-right font-medium tabular-nums">
          {row.original.onHand.toLocaleString()}
        </div>
      ),
    },
    {
      accessorKey: "allocated",
      size: 68,
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Allocated"
          className="justify-end"
        />
      ),
      cell: ({ row }) => (
        <div className="w-full text-right tabular-nums">
          {row.original.allocated.toLocaleString()}
        </div>
      ),
    },
    {
      accessorKey: "available",
      size: 68,
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Available"
          className="justify-end"
        />
      ),
      cell: ({ row }) => (
        <div className="w-full text-right font-medium tabular-nums">
          {row.original.available.toLocaleString()}
        </div>
      ),
    },
    {
      accessorKey: "backorder",
      size: 68,
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Backorder"
          className="justify-end"
        />
      ),
      cell: ({ row }) => (
        <div className="w-full text-right tabular-nums">
          {row.original.backorder.toLocaleString()}
        </div>
      ),
    },
    {
      accessorKey: "createdAt",
      size: 180,
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title="Snapshot Time"
          className="pl-20"
        />
      ),
      cell: ({ row }) => (
        <div className="pl-20 text-sm text-muted-foreground">
          {row.original.createdAt
            ? new Date(row.original.createdAt).toLocaleString()
            : "-"}
        </div>
      ),
    },
  ];
}
