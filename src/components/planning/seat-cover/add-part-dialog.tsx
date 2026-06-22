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
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

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

const PART_COLUMN_MAP: Record<string, string> = {
  "Front Headrest (Driver)":            "front_headrest_1",
  "Front Headrest (Passenger)":         "front_headrest_2",
  "Front Top Body (Driver)":            "front_top_body_part_1",
  "Front Top Body (Passenger)":         "front_top_body_part_2",
  "Front Bottom (Driver)":              "front_bottom_part_1",
  "Front Bottom (Passenger)":           "front_bottom_part_2",
  "Front Middle Headrest":              "front_middle_headrest",
  "Front Middle Top Body":              "front_middle_top_body_part",
  "Front Middle Bottom":                "front_middle_bottom_part",
  "Front Arm (Driver)":                 "front_armrest_1",
  "Front Arm (Passenger)":              "front_armrest_2",
  "Rear Headrest (Driver)":             "rear_headrest_1",
  "Rear Headrest (Passenger)":          "rear_headrest_2",
  "Rear Top Body (Driver)":             "rear_top_body_part_1",
  "Rear Top Body (Passenger)":          "rear_top_body_part_2",
  "Rear Bottom (Driver)":               "rear_bottom_part_1",
  "Rear Bottom (Passenger)":            "rear_bottom_part_2",
  "Rear Middle Headrest":               "rear_middle_headrest",
  "Rear Middle Top Body":               "rear_middle_top_body_part",
  "Rear Middle Bottom":                 "rear_middle_bottom_part",
  "Rear Console":                       "rear_console",
  "Rear Back Storage (Driver)":         "rear_backrest_storage_1",
  "Rear Back Storage (Passenger)":      "rear_backrest_storage_2",
  "Rear Arm (Driver)":                  "rear_armrest_1",
  "Rear Arm (Passenger)":               "rear_armrest_2",
  "Rear Sub-part (Driver)":             "rear_subpart_1",
  "Rear Sub-part (Passenger)":          "rear_subpart_2",
  "Third Row Headrest (Driver)":        "third_row_headrest_1",
  "Third Row Headrest (Passenger)":     "third_row_headrest_2",
  "Third Row Top Body (Driver)":        "third_row_top_body_part_1",
  "Third Row Top Body (Passenger)":     "third_row_top_body_part_2",
  "Third Row Bottom (Driver)":          "third_row_bottom_part_1",
  "Third Row Bottom (Passenger)":       "third_row_bottom_part_2",
  "Third Row Middle Headrest":          "third_row_middle_headrest",
  "Third Row Middle Top Body":          "third_row_middle_top_body_part",
  "Third Row Middle Bottom":            "third_row_middle_bottom_part",
  "Third Row Console":                  "third_row_console",
  "Third Row Back Storage (Driver)":    "third_row_backrest_storage_1",
  "Third Row Back Storage (Passenger)": "third_row_backrest_storage_2",
  "Third Row Arm (Driver)":             "third_row_armrest_1",
  "Third Row Arm (Passenger)":          "third_row_armrest_2",
  "Third Row Sub-part (Driver)":        "third_row_subpart_1",
  "Third Row Sub-part (Passenger)":     "third_row_subpart_2",
};

function getFNumber(sku: string): string | null {
  const matches = sku.match(/\d{5}/g);
  return matches ? matches[matches.length - 1] : null;
}

const STITCH_COLORS = new Set(["BKRD", "BKWH"]);

function getColorSuffix(size: string): string {
  const parts = size.split("-");
  if (parts.length < 3) return "";
  const color = parts[parts.length - 1];
  return STITCH_COLORS.has(color) ? `-${color}-STI` : `-${color}`;
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

interface WarehouseStock {
  warehouse: string;
  available: number;
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
  const { pick } = useI18n();
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
  const [partLookupLoading, setPartLookupLoading] = useState(false);
  const [partNotFound, setPartNotFound] = useState(false);
  const [inventoryWarehouses, setInventoryWarehouses] = useState<WarehouseStock[] | null>(null);
  const [inventoryQueried, setInventoryQueried] = useState(false);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [createOrderLoading, setCreateOrderLoading] = useState(false);
  const [createOrderError, setCreateOrderError] = useState<string | null>(null);
  const [createOrderSuccess, setCreateOrderSuccess] = useState<string | null>(null);

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
      setPartLookupLoading(false);
      setPartNotFound(false);
      setInventoryWarehouses(null);
      setInventoryQueried(false);
      setInventoryLoading(false);
      setCreateOrderLoading(false);
      setCreateOrderError(null);
      setCreateOrderSuccess(null);
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
        apiPath(`/api/planning/seat-cover/parts/lookup?orderNumber=${encodeURIComponent(formData.orderNumber)}`)
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
        apiPath(`/api/planning/seat-cover/parts/lookup?sku=${encodeURIComponent(sku)}`)
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
          next.shipheroOrder = value ? `RE-${value.replace(/^#/, "")}` : "";
        }
      }
      if (name === "partNumber") {
        const colorSuffix = prev.correspondingSku ? getColorSuffix(prev.correspondingSku) : "";
        const expectedPartSku = prev.partNumber ? `CA-SC-PART-${prev.partNumber}${colorSuffix}` : "";
        const newPartSku = value ? `CA-SC-PART-${value}${colorSuffix}` : "";
        if (prev.partSku === "" || prev.partSku === expectedPartSku) {
          next.partSku = newPartSku;
          if (prev.partSkuValue === "" || prev.partSkuValue === prev.partSku || prev.partSkuValue === expectedPartSku) {
            next.partSkuValue = newPartSku;
          }
        }
      }
      if (name === "qty" && inventoryQueried && inventoryWarehouses !== null) {
        const totalInv = inventoryWarehouses.reduce((sum, w) => sum + w.available, 0);
        next.orderRequest = String(Math.max(0, (Number(value) || 0) - totalInv));
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
        ? apiPath(`/api/planning/seat-cover/parts/${editData!.id}`)
        : apiPath("/api/planning/seat-cover/parts");
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          qty: Number(formData.qty) || 0,
          ...(isEdit && { shipheroOrderId: editData?.shipheroOrderId ?? null }),
        }),
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
    if (!loading && !createOrderLoading) onOpenChange(val);
  }

  async function handleSaveAndCreate() {
    setCreateOrderError(null);
    setCreateOrderSuccess(null);

    if (!formData.requestReceivedAt || !formData.orderNumber || !formData.partNumber) {
      setCreateOrderError("Request Received Date, Order Number, Part Number are required.");
      return;
    }
    if (!formData.partSku) {
      setCreateOrderError("Part SKU is required to create a ShipHero order.");
      return;
    }
    if (!formData.shipheroOrder) {
      setCreateOrderError("Shiphero Order number is required.");
      return;
    }
    const qtyNum = parseInt(formData.orderRequest, 10);
    if (!qtyNum || qtyNum < 1) {
      setCreateOrderError("Order Request quantity must be a positive integer.");
      return;
    }

    setCreateOrderLoading(true);
    try {
      const url = isEdit
        ? apiPath(`/api/planning/seat-cover/parts/${editData!.id}`)
        : apiPath("/api/planning/seat-cover/parts");
      const method = isEdit ? "PATCH" : "POST";

      const saveRes = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          qty: Number(formData.qty) || 0,
          createShipHeroOrder: !isEdit,
        }),
      });
      const saveJson = await saveRes.json();
      if (!saveJson.success) {
        setCreateOrderError(saveJson.error ?? "Failed to save part record.");
        return;
      }

      if (saveJson.shipHeroError) {
        setCreateOrderError(`Part saved, but ShipHero order failed: ${saveJson.shipHeroError}`);
        onSuccess();
        return;
      }

      setCreateOrderSuccess(`ShipHero order ${saveJson.shipHeroOrderNumber} created successfully.`);
      onSuccess();
      setTimeout(() => onOpenChange(false), 1500);
    } catch {
      setCreateOrderError("Network error while creating order.");
    } finally {
      setCreateOrderLoading(false);
    }
  }

  const field = (label: string, name: keyof FormData, type = "text", required = false, placeholder?: string) => (
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
        placeholder={placeholder}
        style={{ fontSize: 13, height: 32 }}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent style={{ maxWidth: 1040 }}>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Part" : "Add Part"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          {!isEdit ? (
            /* ── Add 모드: 좌우 분리 ── */
            <div style={{ display: "flex", gap: 24, alignItems: "flex-start", padding: "12px 0 20px" }}>

              {/* 왼쪽: 조회 패널 */}
              <div style={{ width: 340, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
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
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        void handleOrderNumberBlur();
                      }}
                      required
                      style={{ fontSize: 13, height: 32 }}
                    />
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
                      {lookupLoading ? pick("조회 중…", "Searching…") : pick("조회", "Search")}
                    </button>
                  </div>
                </div>

                {(lookupLoading || orderItems.length > 0) && (
                  <div style={{
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
                        <span style={{ fontSize: 12, color: "#7A766F" }}>{pick("조회 중…", "Searching…")}</span>
                      </div>
                    )}

                    {!lookupLoading && orderItems.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#7A766F", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                          {pick("SKU / 상품 선택", "Select SKU / Product")}
                        </span>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
                          {orderItems.filter((item) => item.sku.includes("SC")).map((item) => {
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
                          {pick("해당 SKU 선택", "Select Related SKU")}
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
                          <span style={{ fontSize: 12, color: "#A8A49E" }}>{pick("해당 SKU의 component 없음", "No components for this SKU")}</span>
                        )}
                      </div>
                    )}

                    {selectedSize && getPrefix(selectedSize) && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#7A766F", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                            {pick("Part 선택", "Select Part")}
                          </span>
                          {partLookupLoading && (
                            <span style={{ fontSize: 11, color: "#7A766F" }}>{pick("조회 중…", "Searching…")}</span>
                          )}
                        </div>
                        <input
                          type="text"
                          placeholder={pick("검색…", "Search…")}
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
                        <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 200, overflowY: "auto" }}>
                          {PART_OPTIONS[getPrefix(selectedSize)!]
                            .filter((part) => part.toLowerCase().includes(partSearch.toLowerCase()))
                            .map((part) => {
                              const active = selectedPart === part;
                              return (
                                <button
                                  key={part}
                                  type="button"
                                  onClick={async () => {
                                    setSelectedPart(part);
                                    setPartNotFound(false);
                                    setFormData((prev) => ({ ...prev, partNumber: "", partSku: "", partSkuValue: "" }));
                                    const fNumber = selectedOrderSku ? getFNumber(selectedOrderSku) : null;
                                    const column = PART_COLUMN_MAP[part];
                                    if (!fNumber || !column) return;
                                    setPartLookupLoading(true);
                                    try {
                                      const res = await fetch(
                                        apiPath(`/api/planning/seat-cover/parts/part-sku?f_number=${fNumber}&column=${encodeURIComponent(column)}`)
                                      );
                                      const json = await res.json();
                                      if (json.partNumber) {
                                        const pn = json.partNumber as string;
                                        const colorSuffix = selectedSize ? getColorSuffix(selectedSize) : "";
                                        const ps = `CA-SC-PART-${pn}${colorSuffix}`;
                                        setFormData((prev) => ({ ...prev, partNumber: pn, partSku: ps, partSkuValue: ps }));
                                      } else {
                                        setPartNotFound(true);
                                      }
                                    } catch { /* silently ignore */ }
                                    finally { setPartLookupLoading(false); }
                                  }}
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
              </div>

              {/* 구분선 */}
              <div style={{ width: 1, background: "#E5E3DC", alignSelf: "stretch" }} />

              {/* 오른쪽: 폼 필드 */}
              <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", alignContent: "start" }}>
                {field("Request Received Date", "requestReceivedAt", "date", true)}
                <div />
                {field("Part Number", "partNumber", "text", true, partNotFound ? pick("해당 되는 Part Number 없음", "No matching Part Number") : undefined)}
                {field(pick("해당 SKU", "Related SKU"), "correspondingSku")}
                {field("QTY", "qty", "number")}
                {field("Order Request", "orderRequest")}
                {field("PART SKU", "partSku")}
                {field("PART SKU (VALUE)", "partSkuValue")}
                <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 4 }}>
                  <Label style={{ fontSize: 12, color: "#7A766F" }}>Shiphero Inventory</Label>
                  <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <div style={{
                      flex: 1, minHeight: 32, padding: "6px 10px",
                      border: "1px solid #D8D6CE", borderRadius: 6,
                      background: "#F7F6F3", display: "flex", flexDirection: "column", gap: 2,
                      fontSize: 13,
                    }}>
                      {inventoryLoading ? (
                        <span style={{ color: "#A8A49E" }}>{pick("조회 중…", "Searching…")}</span>
                      ) : !inventoryQueried ? (
                        <span style={{ color: "#A8A49E" }}>—</span>
                      ) : inventoryWarehouses === null ? (
                        <span style={{ color: "#c0392b", fontWeight: 600 }}>{pick("찾을 수 없음", "Not found")}</span>
                      ) : (
                        (() => {
                          const nonZero = inventoryWarehouses.filter((w) => w.available > 0);
                          if (nonZero.length === 0) return <span style={{ color: "#c0392b", fontWeight: 600 }}>0{pick("개", "")}</span>;
                          return nonZero.map((w) => (
                            <span key={w.warehouse} style={{ color: "#166534", fontWeight: 600 }}>
                              {w.warehouse}: {w.available}{pick("개", "")}
                            </span>
                          ));
                        })()
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!formData.partSku || inventoryLoading) return;
                        setInventoryLoading(true);
                        setInventoryWarehouses(null);
                        setInventoryQueried(false);
                        try {
                          const res = await fetch(
                            apiPath(`/api/planning/seat-cover/parts/inventory?sku=${encodeURIComponent(formData.partSku)}`)
                          );
                          const json = await res.json();
                          const warehouses: WarehouseStock[] | null = json.warehouses ?? null;
                          setInventoryWarehouses(warehouses);
                          setInventoryQueried(true);
                          if (warehouses !== null) {
                            const totalInv = warehouses.reduce((sum, w) => sum + w.available, 0);
                            const qty = Number(formData.qty) || 0;
                            setFormData((prev) => ({
                              ...prev,
                              orderRequest: String(Math.max(0, qty - totalInv)),
                            }));
                          }
                        } catch {
                          setInventoryWarehouses(null);
                          setInventoryQueried(true);
                        } finally {
                          setInventoryLoading(false);
                        }
                      }}
                      disabled={!formData.partSku || inventoryLoading}
                      style={{
                        fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0,
                        color: formData.partSku && !inventoryLoading ? "#fff" : "#A8A49E",
                        background: formData.partSku && !inventoryLoading ? "#2A2825" : "#F0EEE9",
                        border: "1px solid #D8D6CE", borderRadius: 6,
                        padding: "0 12px", height: 32,
                        cursor: formData.partSku && !inventoryLoading ? "pointer" : "not-allowed",
                      }}
                    >
                      {pick("재고 확인", "Check Stock")}
                    </button>
                  </div>
                </div>
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
            </div>

          ) : (
            /* ── Edit 모드: 2열 그리드 ── */
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px", padding: "8px 0 16px" }}>
              {field("Request Received Date", "requestReceivedAt", "date", true)}
              {field("Order Number", "orderNumber", "text", true)}
              {field("Part Number", "partNumber", "text", true)}
              {field(pick("해당 SKU", "Related SKU"), "correspondingSku")}
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
          )}

          {error && (
            <p style={{ fontSize: 13, color: "#e53e3e", marginBottom: 8 }}>{error}</p>
          )}
          {createOrderError && (
            <p style={{ fontSize: 13, color: "#e53e3e", marginBottom: 8 }}>{createOrderError}</p>
          )}
          {createOrderSuccess && (
            <p style={{ fontSize: 13, color: "#166534", fontWeight: 600, marginBottom: 8 }}>{createOrderSuccess}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleClose(false)} disabled={loading || createOrderLoading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || createOrderLoading}>
              {loading ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              onClick={handleSaveAndCreate}
              disabled={loading || createOrderLoading}
              style={{ background: "#1d4ed8", color: "#fff" }}
            >
              {createOrderLoading ? "Creating Order…" : "Save and Create Order"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
