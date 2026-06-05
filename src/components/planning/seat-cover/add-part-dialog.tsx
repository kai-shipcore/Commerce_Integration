"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import type { PartOrderRow } from "./parts-grid";

const SHIPPING_STATUSES = ["Not Ready", "Ready", "Shipped", "Canceled"] as const;

interface FormData {
  requestReceivedAt: string;
  orderNumber: string;
  partNumber: string;
  correspondingSku: string;
  qty: string;
  orderRequest: string;
  partSku: string;
  partSkuValue: string;
  note: string;
  orderStatus: string;
  shipheroOrder: string;
  shippingStatus: string;
}

const emptyForm: FormData = {
  requestReceivedAt: "",
  orderNumber: "",
  partNumber: "",
  correspondingSku: "",
  qty: "0",
  orderRequest: "",
  partSku: "",
  partSkuValue: "",
  note: "",
  orderStatus: "",
  shipheroOrder: "",
  shippingStatus: "Not Ready",
};

function rowToForm(row: PartOrderRow): FormData {
  return {
    requestReceivedAt: row.requestReceivedAt ?? "",
    orderNumber: row.orderNumber ?? "",
    partNumber: row.partNumber ?? "",
    correspondingSku: row.correspondingSku ?? "",
    qty: String(row.qty ?? 0),
    orderRequest: row.orderRequest ?? "",
    partSku: row.partSku ?? "",
    partSkuValue: row.partSkuValue ?? "",
    note: row.note ?? "",
    orderStatus: row.orderStatus ?? "",
    shipheroOrder: row.shipheroOrder ?? "",
    shippingStatus: row.shippingStatus ?? "",
  };
}

interface PartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  editData?: PartOrderRow | null;
}

export function PartDialog({ open, onOpenChange, onSuccess, editData }: PartDialogProps) {
  const isEdit = !!editData;
  const [formData, setFormData] = useState<FormData>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFormData(editData ? rowToForm(editData) : emptyForm);
      setError(null);
    }
  }, [open, editData]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setFormData((prev) => {
      const next = { ...prev, [name]: value };
      if (name === "orderNumber") {
        const expectedPrev = prev.orderNumber ? `RE-${prev.orderNumber}` : "";
        if (prev.shipheroOrder === "" || prev.shipheroOrder === expectedPrev) {
          next.shipheroOrder = value ? `RE-${value}` : "";
        }
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!formData.requestReceivedAt || !formData.orderNumber || !formData.partNumber) {
      setError("Request Received Date, Order Number, Part Number are required.");
      return;
    }

    setLoading(true);
    try {
      const url = isEdit
        ? `/api/planning/seat-cover/parts/${editData!.id}`
        : "/api/planning/seat-cover/parts";
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, qty: Number(formData.qty) || 0 }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error ?? "Failed to save.");
        return;
      }
      onOpenChange(false);
      onSuccess();
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  function handleClose(val: boolean) {
    if (!loading) onOpenChange(val);
  }

  const field = (label: string, name: keyof FormData, type = "text", required = false) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Label htmlFor={name} style={{ fontSize: 12, color: "#7A766F" }}>
        {label}{required && <span style={{ color: "#e53e3e" }}> *</span>}
      </Label>
      <Input
        id={name}
        name={name}
        type={type}
        value={formData[name]}
        onChange={handleChange}
        required={required}
        style={{ fontSize: 13, height: 32 }}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent style={{ maxWidth: 640 }}>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Part" : "Add Part"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px", padding: "8px 0 16px" }}>
            {field("Request Received Date", "requestReceivedAt", "date", true)}
            {field("Order Number", "orderNumber", "text", true)}
            {field("Part Number", "partNumber", "text", true)}
            {field("해당SKU", "correspondingSku")}
            {field("QTY", "qty", "number")}
            {field("Order Request", "orderRequest")}
            {field("PART SKU", "partSku")}
            {field("PART SKU (VALUE)", "partSkuValue")}
            {field("Note", "note")}
            {field("Order Status", "orderStatus")}
                    {field("Shiphero Order", "shipheroOrder")}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Label style={{ fontSize: 12, color: "#7A766F" }}>Shipping Status</Label>
              <Select
                value={formData.shippingStatus}
                onValueChange={(val) => setFormData((prev) => ({ ...prev, shippingStatus: val }))}
              >
                <SelectTrigger style={{ fontSize: 13, height: 32 }} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHIPPING_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error && (
            <p style={{ fontSize: 13, color: "#e53e3e", marginBottom: 12 }}>{error}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleClose(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
