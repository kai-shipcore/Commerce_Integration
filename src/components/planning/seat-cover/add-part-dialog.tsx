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

const PART_OPTIONS: Record<"F" | "B" | "E", string[]> = {
  F: [
    "Front Headrest (Driver)",
    "Front Headrest (Passenger)",
    "Front Top Body (Driver)",
    "Front Top Body (Passenger)",
    "Front Bottom (Driver)",
    "Front Bottom (Passenger)",
    "Front Middle Headrest",
    "Front Middle Top Body",
    "Front Middle Bottom",
    "Front Arm (Driver)",
    "Front Arm (Passenger)",
  ],
  B: [
    "Rear Headrest (Driver)",
    "Rear Headrest (Passenger)",
    "Rear Top Body (Driver)",
    "Rear Top Body (Passenger)",
    "Rear Bottom (Driver)",
    "Rear Bottom (Passenger)",
    "Rear Middle Headrest",
    "Rear Middle Top Body",
    "Rear Middle Bottom",
    "Rear Console",
    "Rear Back Storage (Driver)",
    "Rear Back Storage (Passenger)",
    "Rear Arm (Driver)",
    "Rear Arm (Passenger)",
    "Rear Sub-part (Driver)",
    "Rear Sub-part (Passenger)",
  ],
  E: [
    "Third Row Headrest (Driver)",
    "Third Row Headrest (Passenger)",
    "Third Row Top Body (Driver)",
    "Third Row Top Body (Passenger)",
    "Third Row Bottom (Driver)",
    "Third Row Bottom (Passenger)",
    "Third Row Middle Headrest",
    "Third Row Middle Top Body",
    "Third Row Middle Bottom",
    "Third Row Console",
    "Third Row Back Storage (Driver)",
    "Third Row Back Storage (Passenger)",
    "Third Row Arm (Driver)",
    "Third Row Arm (Passenger)",
    "Third Row Sub-part (Driver)",
    "Third Row Sub-part (Passenger)",
  ],
};

function getPrefix(size: string): "F" | "B" | "E" | null {
  const p = size[0];
  if (p === "F") return "F";
  if (p === "B" || p === "R") return "B";
  if (p === "E") return "E";
  return null;
}

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

interface OrderItem {
  sku: string;
  productName: string;
}

interface SizeOption {
  size: string;
  componentSku: string;
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

  const [lookupLoading, setLookupLoading] = useState(false);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [selectedOrderSku, setSelectedOrderSku] = useState<string | null>(null);
  const [sizeOptions, setSizeOptions] = useState<SizeOption[]>([]);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [partSearch, setPartSearch] = useState("");

  useEffect(() => {
    if (open) {
      setFormData(editData ? rowToForm(editData) : emptyForm);
      setError(null);
      setOrderItems([]);
      setSelectedOrderSku(null);
      setSizeOptions([]);
      setSelectedSize(null);
      setSelectedPart(null);
      setPartSearch("");
    }
  }, [open, editData]);

  async function handleOrderNumberBlur() {
    if (!formData.orderNumber) return;
    setLookupLoading(true);
    setOrderItems([]);
    setSelectedOrderSku(null);
    setSizeOptions([]);
    setSelectedSize(null);
    try {
      const res = await fetch(
        `/api/planning/seat-cover/parts/lookup?orderNumber=${encodeURIComponent(formData.orderNumber)}`
      );
      const json = await res.json();
      setOrderItems(json.items ?? []);
    } catch {
      // silently ignore
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleSkuSelect(sku: string) {
    setSelectedOrderSku(sku);
    setSizeOptions([]);
    setSelectedSize(null);
    try {
      const res = await fetch(
        `/api/planning/seat-cover/parts/lookup?sku=${encodeURIComponent(sku)}`
      );
      const json = await res.json();
      setSizeOptions(json.sizes ?? []);
    } catch {
      // silently ignore
    }
  }

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
      if (name === "partNumber") {
        const expectedPartSku = prev.partNumber ? `CA-SC-PART-${prev.partNumber}` : "";
        const newPartSku = value ? `CA-SC-PART-${value}` : "";
        if (prev.partSku === "" || prev.partSku === expectedPartSku) {
          next.partSku = newPartSku;
          if (prev.partSkuValue === "" || prev.partSkuValue === prev.partSku || prev.partSkuValue === expectedPartSku) {
            next.partSkuValue = newPartSku;
          }
        }
      }
      if (name === "partSku") {
        if (prev.partSkuValue === "" || prev.partSkuValue === prev.partSku) {
          next.partSkuValue = value;
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
            {/* Order Number with lookup button */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Label htmlFor="orderNumber" style={{ fontSize: 12, color: "#7A766F" }}>
                Order Number<span style={{ color: "#e53e3e" }}> *</span>
              </Label>
              <div style={{ display: "flex", gap: 6 }}>
                <Input
                  id="orderNumber"
                  name="orderNumber"
                  type="text"
                  value={formData.orderNumber}
                  onChange={handleChange}
                  required
                  style={{ fontSize: 13, height: 32 }}
                />
                {!isEdit && (
                  <button
                    type="button"
                    onClick={handleOrderNumberBlur}
                    disabled={!formData.orderNumber || lookupLoading}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: formData.orderNumber && !lookupLoading ? "#fff" : "#A8A49E",
                      background: formData.orderNumber && !lookupLoading ? "#2A2825" : "#F0EEE9",
                      border: "1px solid #D8D6CE",
                      borderRadius: 6,
                      padding: "0 10px",
                      cursor: formData.orderNumber && !lookupLoading ? "pointer" : "not-allowed",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {lookupLoading ? "조회 중…" : "조회"}
                  </button>
                )}
              </div>
            </div>

            {/* Lookup results — full-width, only in Add mode */}
            {!isEdit && (lookupLoading || orderItems.length > 0) && (
              <div style={{
                gridColumn: "1 / -1",
                background: "#F7F6F3",
                border: "1px solid #E5E3DC",
                borderRadius: 8,
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}>
                {lookupLoading && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div className="animate-spin" style={{
                      width: 14, height: 14, borderRadius: "50%",
                      border: "2px solid #D8D6CE", borderTopColor: "#2A2825",
                    }} />
                    <span style={{ fontSize: 12, color: "#7A766F" }}>조회 중…</span>
                  </div>
                )}

                {!lookupLoading && orderItems.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#7A766F", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      SKU / 상품 선택
                    </span>
                    <div style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      maxHeight: 200,
                      overflowY: "auto",
                    }}>
                      {orderItems.map((item) => {
                        const active = selectedOrderSku === item.sku;
                        return (
                          <button
                            key={item.sku}
                            type="button"
                            onClick={() => handleSkuSelect(item.sku)}
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "flex-start",
                              gap: 2,
                              padding: "8px 10px",
                              background: active ? "#2A2825" : "#fff",
                              border: `1px solid ${active ? "#2A2825" : "#E5E3DC"}`,
                              borderRadius: 6,
                              cursor: "pointer",
                              textAlign: "left",
                              transition: "background 0.1s",
                            }}
                          >
                            <span style={{ fontSize: 12, fontWeight: 600, color: active ? "#fff" : "#1A1917", lineHeight: 1.3 }}>
                              {item.productName || item.sku}
                            </span>
                            {item.productName && (
                              <span style={{ fontSize: 11, color: active ? "rgba(255,255,255,0.55)" : "#A8A49E", fontFamily: "monospace" }}>
                                {item.sku}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {selectedOrderSku && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#7A766F", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      해당SKU 선택
                    </span>
                    {sizeOptions.length > 0 ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {sizeOptions.map((opt) => {
                          const active = selectedSize === opt.size;
                          return (
                            <button
                              key={`${opt.componentSku}-${opt.size}`}
                              type="button"
                              onClick={() => {
                                setSelectedSize(opt.size);
                                setFormData((prev) => ({ ...prev, correspondingSku: opt.size }));
                                setSelectedPart(null);
                                setPartSearch("");
                              }}
                              style={{
                                fontSize: 13,
                                fontWeight: 700,
                                color: active ? "#fff" : "#1A1917",
                                background: active ? "#2A2825" : "#fff",
                                border: `1.5px solid ${active ? "#2A2825" : "#D8D6CE"}`,
                                borderRadius: 20,
                                padding: "4px 14px",
                                cursor: "pointer",
                                letterSpacing: "0.02em",
                              }}
                            >
                              {opt.size}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, color: "#A8A49E" }}>해당 SKU의 component 없음</span>
                    )}
                  </div>
                )}

                {selectedSize && getPrefix(selectedSize) && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#7A766F", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      Part 선택
                    </span>
                    <input
                      type="text"
                      placeholder="검색…"
                      value={partSearch}
                      onChange={(e) => setPartSearch(e.target.value)}
                      style={{
                        fontSize: 12,
                        height: 30,
                        padding: "0 8px",
                        border: "1px solid #D8D6CE",
                        borderRadius: 6,
                        outline: "none",
                        background: "#fff",
                        color: "#1A1917",
                        width: "100%",
                        boxSizing: "border-box",
                      }}
                    />
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 180, overflowY: "auto" }}>
                      {PART_OPTIONS[getPrefix(selectedSize)!]
                        .filter((part) => part.toLowerCase().includes(partSearch.toLowerCase()))
                        .map((part) => {
                        const active = selectedPart === part;
                        return (
                          <button
                            key={part}
                            type="button"
                            onClick={() => setSelectedPart(part)}
                            style={{
                              padding: "7px 10px",
                              background: active ? "#2A2825" : "#fff",
                              border: `1px solid ${active ? "#2A2825" : "#E5E3DC"}`,
                              borderRadius: 6,
                              cursor: "pointer",
                              textAlign: "left",
                              fontSize: 12,
                              fontWeight: active ? 600 : 400,
                              color: active ? "#fff" : "#1A1917",
                            }}
                          >
                            {part}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

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
