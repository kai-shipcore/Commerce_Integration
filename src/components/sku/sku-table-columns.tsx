"use client";

/**
 * Code Guide:
 * SKU management component.
 * This file supports SKU listing, editing, bulk actions, or master-SKU workflows in the catalog screens.
 */
import { ColumnDef } from "@tanstack/react-table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { MoreHorizontal, Eye, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import Link from "next/link";
import { DataTableColumnHeader } from "@/components/ui/data-table/data-table-column-header";

export type SKUTableData = {
  id: string;
  skuCode: string;
  masterSkuCode: string | null;
  name: string;
  description: string | null;
  category: string | null;
  currentStock: number;
  inventory: {
    onHand: number;
    reserved: number;
    allocated: number;
    backorder: number;
    inbound: number;
    available: number;
  };
  reorderPoint: number | null;
  unitCost: string | null;
  retailPrice: string | null;
  webSkuCount?: number;
  _count: {
    salesRecords: number;
  };
  salesSummary: {
    totalQuantity: number;
    days: number;
  };
};

export const PERIOD_OPTIONS = [
  { value: "30", label: "30d" },
  { value: "60", label: "60d" },
  { value: "90", label: "90d" },
  { value: "365", label: "1y" },
];

interface ColumnOptions {
  salesPeriod: string;
  onSalesPeriodChange: (value: string) => void;
}

export function createSkuColumns(options: ColumnOptions): ColumnDef<SKUTableData>[] {
  const { salesPeriod, onSalesPeriodChange } = options;

  return [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
          className="translate-y-[2px]"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
          className="translate-y-[2px]"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: "masterSkuCode",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Master SKU" />
      ),
      cell: ({ row }) => {
        const masterSku = row.getValue("masterSkuCode") as string | null;
        if (!masterSku) return <span className="text-muted-foreground">-</span>;
        return (
          <Link
            href={`/skus/${masterSku}`}
            className="font-mono text-sm font-medium hover:underline"
          >
            {masterSku}
          </Link>
        );
      },
      enableSorting: true,
      enableHiding: false,
    },
    {
      accessorKey: "webSkuCount",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Variants" />
      ),
      cell: ({ row }) => {
        const count = row.original.webSkuCount || 0;
        return (
          <div className="text-center">
            <Badge variant="secondary" className="font-mono">
              {count}
            </Badge>
          </div>
        );
      },
      enableSorting: true,
    },
    {
      accessorKey: "name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Name" />
      ),
      cell: ({ row }) => {
        const needsReorder =
          row.original.reorderPoint &&
          row.original.inventory.available <= row.original.reorderPoint;

        return (
          <div className="flex items-center gap-2">
            <span className="max-w-[300px] truncate font-medium">
              {row.getValue("name")}
            </span>
            {needsReorder && (
              <Badge variant="destructive" className="text-xs">
                Low Stock
              </Badge>
            )}
          </div>
        );
      },
      enableSorting: true,
    },
    {
      accessorKey: "category",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Category" />
      ),
      cell: ({ row }) => {
        const category = row.getValue("category") as string | null;
        return (
          <div className="max-w-[150px] truncate">
            {category || <span className="text-muted-foreground">-</span>}
          </div>
        );
      },
      filterFn: (row, id, value) => {
        return value.includes(row.getValue(id));
      },
      enableSorting: true,
    },
    {
      accessorKey: "currentStock",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Available" />
      ),
      cell: ({ row }) => {
        const stock = row.original.inventory.available;
        const reorderPoint = row.original.reorderPoint;
        const isLow = reorderPoint && stock <= reorderPoint;

        return (
          <div className={`space-y-1 ${isLow ? "text-destructive" : ""}`}>
            <div className="font-medium">
              {stock}
              {reorderPoint && (
                <span className="ml-1 text-xs text-muted-foreground">
                  / {reorderPoint}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              OH {row.original.inventory.onHand} | R {row.original.inventory.reserved} | B{" "}
              {row.original.inventory.backorder}
            </div>
          </div>
        );
      },
      enableSorting: true,
    },
    {
      accessorKey: "retailPrice",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Price" />
      ),
      cell: ({ row }) => {
        const price = row.getValue("retailPrice") as string | null;
        return (
          <div className="font-medium">
            {price ? `$${parseFloat(price).toFixed(2)}` : <span className="text-muted-foreground">-</span>}
          </div>
        );
      },
      enableSorting: true,
    },
    {
      id: "salesRecords",
      accessorFn: (row) => row.salesSummary.totalQuantity,
      header: ({ column }) => (
        <div className="flex items-center justify-center gap-1">
          <Select value={salesPeriod} onValueChange={onSalesPeriodChange}>
            <SelectTrigger className="h-7 min-w-[80px] justify-center gap-1 border-0 bg-transparent px-2 text-xs hover:bg-muted/50">
              <span>Sales</span>
              <span className="text-muted-foreground">
                ({PERIOD_OPTIONS.find((option) => option.value === salesPeriod)?.label})
              </span>
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => {
              const currentSort = column.getIsSorted();
              if (!currentSort) {
                column.toggleSorting(true);
              } else if (currentSort === "desc") {
                column.toggleSorting(false);
              } else {
                column.clearSorting();
              }
            }}
          >
            {column.getIsSorted() === "desc" ? (
              <ArrowDown className="h-4 w-4" />
            ) : column.getIsSorted() === "asc" ? (
              <ArrowUp className="h-4 w-4" />
            ) : (
              <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        </div>
      ),
      cell: ({ row }) => {
        const { totalQuantity } = row.original.salesSummary;

        if (totalQuantity === 0) {
          return <div className="w-full text-center text-muted-foreground">-</div>;
        }

        return (
          <div className="w-full text-center">
            <span className="font-medium">{totalQuantity.toLocaleString()}</span>
          </div>
        );
      },
      enableSorting: true,
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const sku = row.original;

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => navigator.clipboard.writeText(sku.masterSkuCode || sku.skuCode)}
              >
                Copy Master SKU
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={`/skus/${sku.id}`}>
                  <Eye className="mr-2 h-4 w-4" />
                  View details
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}
