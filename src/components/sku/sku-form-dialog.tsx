"use client";

/**
 * Code Guide:
 * SKU management component.
 * This file supports SKU listing, editing, bulk actions, or master-SKU workflows in the catalog screens.
 */
import { useState } from "react";
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
import { Plus } from "lucide-react";

interface SKUFormData {
  skuCode: string;
  name: string;
  description: string;
  category: string;
  currentStock: number;
  reorderPoint: number;
  unitCost: number;
  retailPrice: number;
}

interface SKUFormDialogProps {
  onSuccess?: () => void;
  trigger?: React.ReactNode;
  editData?: SKUFormData & { id: string };
}

export function SKUFormDialog({ onSuccess, trigger, editData }: SKUFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const isEditMode = !!editData;
  const [formData, setFormData] = useState<SKUFormData>(
    editData || {
      skuCode: "",
      name: "",
      description: "",
      category: "",
      currentStock: 0,
      reorderPoint: 0,
      unitCost: 0,
      retailPrice: 0,
    }
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const url = isEditMode ? `/api/skus/${editData.id}` : "/api/skus";
      const method = isEditMode ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const result = await response.json();

      if (result.success) {
        setOpen(false);
        if (!isEditMode) {
          setFormData({
            skuCode: "",
            name: "",
            description: "",
            category: "",
            currentStock: 0,
            reorderPoint: 0,
            unitCost: 0,
            retailPrice: 0,
          });
        }
        onSuccess?.();
      } else {
        alert(`Error: ${result.error}`);
      }
    } catch {
      alert(`Failed to ${isEditMode ? "update" : "create"} SKU`);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field: keyof SKUFormData, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Product
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditMode ? "Edit Product" : "Create New Product"}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? "Update product information"
              : "Add a new product to your catalog"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            {/* SKU Code */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="skuCode" className="text-right">
                SKU Code *
              </Label>
              <Input
                id="skuCode"
                value={formData.skuCode}
                onChange={(e) => handleChange("skuCode", e.target.value)}
                className="col-span-3"
                required
                placeholder="e.g., WIDGET-001"
              />
            </div>

            {/* Name */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">
                Name *
              </Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => handleChange("name", e.target.value)}
                className="col-span-3"
                required
                placeholder="Product name"
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
                onChange={(e) => handleChange("description", e.target.value)}
                className="col-span-3"
                placeholder="Product description"
              />
            </div>

            {/* Category */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="category" className="text-right">
                Category
              </Label>
              <Input
                id="category"
                value={formData.category}
                onChange={(e) => handleChange("category", e.target.value)}
                className="col-span-3"
                placeholder="e.g., Electronics"
              />
            </div>

            {/* Stock & Reorder Point */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="currentStock" className="text-right">
                On Hand
              </Label>
              <Input
                id="currentStock"
                type="number"
                value={formData.currentStock}
                onChange={(e) =>
                  handleChange("currentStock", parseInt(e.target.value) || 0)
                }
                className="col-span-3"
                min="0"
              />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="reorderPoint" className="text-right">
                Reorder Point
              </Label>
              <Input
                id="reorderPoint"
                type="number"
                value={formData.reorderPoint}
                onChange={(e) =>
                  handleChange("reorderPoint", parseInt(e.target.value) || 0)
                }
                className="col-span-3"
                min="0"
              />
            </div>

            {/* Pricing */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="unitCost" className="text-right">
                Unit Cost
              </Label>
              <Input
                id="unitCost"
                type="number"
                step="0.01"
                value={formData.unitCost}
                onChange={(e) =>
                  handleChange("unitCost", parseFloat(e.target.value) || 0)
                }
                className="col-span-3"
                min="0"
                placeholder="0.00"
              />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="retailPrice" className="text-right">
                Retail Price
              </Label>
              <Input
                id="retailPrice"
                type="number"
                step="0.01"
                value={formData.retailPrice}
                onChange={(e) =>
                  handleChange("retailPrice", parseFloat(e.target.value) || 0)
                }
                className="col-span-3"
                min="0"
                placeholder="0.00"
              />
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
                ? "Update Product"
                : "Create Product"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
