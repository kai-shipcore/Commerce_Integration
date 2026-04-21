"use client";

/**
 * Code Guide:
 * Collection management component.
 * It handles the UI needed to group multiple SKUs into a reusable business collection.
 */
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, X } from "lucide-react";

interface CollectionFormData {
  name: string;
  description: string;
  colorCode: string;
  isPinned: boolean;
  skuIds: string[];
}

interface SKU {
  id: string;
  skuCode: string;
  name: string;
}

interface CollectionFormDialogProps {
  onSuccess?: () => void;
  trigger?: React.ReactNode;
  editData?: CollectionFormData & { id: string };
}

const PRESET_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#f59e0b", // amber
  "#84cc16", // lime
  "#10b981", // emerald
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
];

export function CollectionFormDialog({
  onSuccess,
  trigger,
  editData,
}: CollectionFormDialogProps) {
  const isEditMode = !!editData;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [skus, setSKUs] = useState<SKU[]>([]);
  const [selectedSKUs, setSelectedSKUs] = useState<string[]>(editData?.skuIds || []);
  const [formData, setFormData] = useState<CollectionFormData>(
    editData || {
      name: "",
      description: "",
      colorCode: PRESET_COLORS[0],
      isPinned: false,
      skuIds: [],
    }
  );

  // Fetch SKUs when dialog opens
  useEffect(() => {
    if (open) {
      fetch("/api/skus?limit=100")
        .then((res) => res.json())
        .then((result) => {
          if (result.success) {
            setSKUs(result.data);
          }
        });
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const url = isEditMode ? `/api/collections/${editData.id}` : "/api/collections";
      const method = isEditMode ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          skuIds: selectedSKUs,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setOpen(false);
        if (!isEditMode) {
          setFormData({
            name: "",
            description: "",
            colorCode: PRESET_COLORS[0],
            isPinned: false,
            skuIds: [],
          });
          setSelectedSKUs([]);
        }
        onSuccess?.();
      } else {
        alert(`Error: ${result.error}`);
      }
    } catch (error) {
      alert(`Failed to ${isEditMode ? "update" : "create"} collection`);
    } finally {
      setLoading(false);
    }
  };

  const toggleSKU = (skuId: string) => {
    setSelectedSKUs((prev) =>
      prev.includes(skuId)
        ? prev.filter((id) => id !== skuId)
        : [...prev, skuId]
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Collection
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditMode ? "Edit Collection" : "Create Collection"}</DialogTitle>
          <DialogDescription>
            {isEditMode ? "Update collection information" : "Organize your SKUs into collections"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-6 py-4">
            {/* Collection Name */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">
                Name *
              </Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, name: e.target.value }))
                }
                className="col-span-3"
                required
                placeholder="e.g., Best Sellers"
              />
            </div>

            {/* Description */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="description" className="text-right">
                Description
              </Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                className="col-span-3"
                placeholder="Collection description"
              />
            </div>

            {/* Color Code */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Color</Label>
              <div className="col-span-3 flex gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`w-8 h-8 rounded-full border-2 ${
                      formData.colorCode === color
                        ? "border-black"
                        : "border-transparent"
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() =>
                      setFormData((prev) => ({ ...prev, colorCode: color }))
                    }
                  />
                ))}
              </div>
            </div>

            {/* Pin Collection */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="isPinned" className="text-right">
                Pin Collection
              </Label>
              <div className="col-span-3">
                <input
                  id="isPinned"
                  type="checkbox"
                  checked={formData.isPinned}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      isPinned: e.target.checked,
                    }))
                  }
                  className="h-4 w-4"
                />
              </div>
            </div>

            {/* SKU Selection */}
            <div className="grid grid-cols-4 items-start gap-4">
              <Label className="text-right pt-2">SKUs</Label>
              <div className="col-span-3 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Select SKUs to add to this collection
                </p>

                {/* Selected SKUs */}
                {selectedSKUs.length > 0 && (
                  <div className="flex flex-wrap gap-2 p-3 bg-muted rounded-lg">
                    {selectedSKUs.map((skuId) => {
                      const sku = skus.find((s) => s.id === skuId);
                      if (!sku) return null;
                      return (
                        <Badge
                          key={skuId}
                          variant="secondary"
                          className="gap-1"
                        >
                          {sku.skuCode}
                          <button
                            type="button"
                            onClick={() => toggleSKU(skuId)}
                            className="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      );
                    })}
                  </div>
                )}

                {/* SKU List */}
                <div className="max-h-60 overflow-y-auto border rounded-lg">
                  {skus.map((sku) => (
                    <label
                      key={sku.id}
                      className="flex items-center gap-3 p-3 hover:bg-muted cursor-pointer border-b last:border-0"
                    >
                      <input
                        type="checkbox"
                        checked={selectedSKUs.includes(sku.id)}
                        onChange={() => toggleSKU(sku.id)}
                        className="h-4 w-4"
                      />
                      <div className="flex-1">
                        <p className="font-medium text-sm">{sku.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {sku.skuCode}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading
                ? isEditMode
                  ? "Updating..."
                  : "Creating..."
                : isEditMode
                ? "Update Collection"
                : "Create Collection"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
