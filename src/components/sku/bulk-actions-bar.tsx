"use client";

/**
 * Code Guide:
 * SKU management component.
 * This file supports SKU listing, editing, bulk actions, or master-SKU workflows in the catalog screens.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Trash2, Download, Loader2, AlertTriangle } from "lucide-react";

interface SKUData {
  id: string;
  skuCode: string;
  name: string;
}

interface BulkActionsBarProps {
  selectedRows: SKUData[];
  onDelete: () => void;
  onExport: () => void;
}

export function BulkActionsBar({
  selectedRows,
  onDelete,
  onExport,
}: BulkActionsBarProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBulkDelete = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/skus/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedRows.map((r) => r.id) }),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.error || "Failed to delete SKUs");
        return;
      }

      setDeleteDialogOpen(false);
      onDelete();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  if (selectedRows.length === 0) {
    return null;
  }

  return (
    <>
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">
            {selectedRows.length} item{selectedRows.length > 1 ? "s" : ""} selected
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onExport}>
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteDialogOpen(true)}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>
      </Card>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Confirm Deletion
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {selectedRows.length} SKU
              {selectedRows.length > 1 ? "s" : ""}? This action cannot be undone.
              All related sales records and inventory data will be
              permanently removed.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-sm">
              {error}
            </div>
          )}

          <div className="max-h-40 overflow-y-auto border rounded-md p-2">
            <ul className="space-y-1 text-sm">
              {selectedRows.slice(0, 10).map((row) => (
                <li key={row.id} className="flex items-center gap-2">
                  <span className="font-mono text-xs bg-muted px-1 rounded">
                    {row.skuCode}
                  </span>
                  <span className="text-muted-foreground truncate">
                    {row.name}
                  </span>
                </li>
              ))}
              {selectedRows.length > 10 && (
                <li className="text-muted-foreground">
                  ...and {selectedRows.length - 10} more
                </li>
              )}
            </ul>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete {selectedRows.length} SKU{selectedRows.length > 1 ? "s" : ""}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
