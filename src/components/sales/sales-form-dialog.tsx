"use client";

/**
 * Code Guide:
 * Sales management component.
 * It helps users create, import, or inspect sales records before those records are sent to API routes.
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShoppingCart } from "lucide-react";

interface SalesFormData {
  skuId: string;
  platform: string;
  orderId: string;
  saleDate: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  fulfilled: boolean;
}

interface SKU {
  id: string;
  skuCode: string;
  name: string;
}

interface SalesFormDialogProps {
  onSuccess?: () => void;
  trigger?: React.ReactNode;
}

export function SalesFormDialog({ onSuccess, trigger }: SalesFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [skus, setSKUs] = useState<SKU[]>([]);
  const [formData, setFormData] = useState<SalesFormData>({
    skuId: "",
    platform: "manual",
    orderId: "",
    saleDate: new Date().toISOString().split("T")[0],
    quantity: 1,
    unitPrice: 0,
    totalAmount: 0,
    fulfilled: true,
  });

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

  // Auto-calculate total amount
  useEffect(() => {
    const total = formData.quantity * formData.unitPrice;
    setFormData((prev) => ({ ...prev, totalAmount: total }));
  }, [formData.quantity, formData.unitPrice]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          orderType: "actual_sale",
        }),
      });

      const result = await response.json();

      if (result.success) {
        setOpen(false);
        setFormData({
          skuId: "",
          platform: "manual",
          orderId: "",
          saleDate: new Date().toISOString().split("T")[0],
          quantity: 1,
          unitPrice: 0,
          totalAmount: 0,
          fulfilled: true,
        });
        onSuccess?.();
      } else {
        alert(`Error: ${result.error}`);
      }
    } catch (error) {
      alert("Failed to create sales record");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field: keyof SalesFormData, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <ShoppingCart className="mr-2 h-4 w-4" />
            Add Sale
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Record New Sale</DialogTitle>
          <DialogDescription>Add a sales record manually</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            {/* SKU Selection */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="skuId" className="text-right">
                SKU *
              </Label>
              <Select
                value={formData.skuId}
                onValueChange={(value) => handleChange("skuId", value)}
                required
              >
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Select a SKU" />
                </SelectTrigger>
                <SelectContent>
                  {skus.map((sku) => (
                    <SelectItem key={sku.id} value={sku.id}>
                      {sku.skuCode} - {sku.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Platform */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="platform" className="text-right">
                Platform *
              </Label>
              <Select
                value={formData.platform}
                onValueChange={(value) => handleChange("platform", value)}
              >
                <SelectTrigger className="col-span-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="shopify">Shopify</SelectItem>
                  <SelectItem value="walmart">Walmart</SelectItem>
                  <SelectItem value="ebay">eBay</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Order ID */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="orderId" className="text-right">
                Order ID *
              </Label>
              <Input
                id="orderId"
                value={formData.orderId}
                onChange={(e) => handleChange("orderId", e.target.value)}
                className="col-span-3"
                required
                placeholder="e.g., ORD-12345"
              />
            </div>

            {/* Sale Date */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="saleDate" className="text-right">
                Sale Date *
              </Label>
              <Input
                id="saleDate"
                type="date"
                value={formData.saleDate}
                onChange={(e) => handleChange("saleDate", e.target.value)}
                className="col-span-3"
                required
              />
            </div>

            {/* Quantity */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="quantity" className="text-right">
                Quantity *
              </Label>
              <Input
                id="quantity"
                type="number"
                value={formData.quantity}
                onChange={(e) =>
                  handleChange("quantity", parseInt(e.target.value) || 1)
                }
                className="col-span-3"
                min="1"
                required
              />
            </div>

            {/* Unit Price */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="unitPrice" className="text-right">
                Unit Price *
              </Label>
              <Input
                id="unitPrice"
                type="number"
                step="0.01"
                value={formData.unitPrice}
                onChange={(e) =>
                  handleChange("unitPrice", parseFloat(e.target.value) || 0)
                }
                className="col-span-3"
                min="0"
                required
              />
            </div>

            {/* Total Amount (auto-calculated) */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Total Amount</Label>
              <div className="col-span-3 text-2xl font-bold">
                ${formData.totalAmount.toFixed(2)}
              </div>
            </div>

            {/* Fulfilled Status */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="fulfilled" className="text-right">
                Fulfilled
              </Label>
              <Select
                value={formData.fulfilled.toString()}
                onValueChange={(value) =>
                  handleChange("fulfilled", value === "true")
                }
              >
                <SelectTrigger className="col-span-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Yes</SelectItem>
                  <SelectItem value="false">No</SelectItem>
                </SelectContent>
              </Select>
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
              {loading ? "Creating..." : "Create Sale"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
