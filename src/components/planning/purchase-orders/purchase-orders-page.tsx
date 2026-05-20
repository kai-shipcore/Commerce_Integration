"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  mockSkus,
} from "@/features/planning/mock-data";

type PurchaseOrderStatus = "draft" | "pending" | "approved" | "sent";

type PurchaseOrderItem = {
  id: string;
  sku: string;
  moq: number;
  qty: number;
  cbm: number;
  totalCbm: number;
  unitPrice: number | null;
};

type PurchaseOrderRecord = {
  id: string;
  number: string;
  date: string | null;
  eta: string | null;
  factory: string | null;
  origin: string | null;
  destination: string | null;
  manager: string | null;
  note: string | null;
  status: PurchaseOrderStatus;
  sentAt: string | null;
  itemCount: number;
  totalQty: number;
  totalCbm: number;
  items: PurchaseOrderItem[];
};

type WarehouseOption = {
  id: string;
  warehouseCode: string;
  warehouseName: string;
  isActive: boolean;
};

type FactoryOption = {
  id: string;
  factoryCode: string | null;
  factoryName: string;
  origin: string | null;
  isActive: boolean;
};

type PoDraftItem = {
  sku: string;
  moq: string;
  qty: string;
  dailyAvg: string;
  stock: string;
  cbm: string;
};

type PoFormState = {
  number: string;
  date: string;
  eta: string;
  factory: string;
  destination: string;
  manager: string;
  note: string;
  status: PurchaseOrderStatus;
};

const today = new Date().toISOString().slice(0, 10);

const defaultPoForm: PoFormState = {
  number: "PO-2026-041",
  date: today,
  eta: "2026-07-18",
  factory: "Guangzhou A Factory",
  destination: "",
  manager: "Mina",
  note: "",
  status: "draft",
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function orderCbm(order: PurchaseOrderRecord) {
  return order.totalCbm || order.items.reduce((sum, item) => sum + item.qty * item.cbm, 0);
}

function orderQty(order: PurchaseOrderRecord) {
  return order.totalQty || order.items.reduce((sum, item) => sum + item.qty, 0);
}

function parseNumber(value: string) {
  const parsed = Number.parseFloat(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

const statusClasses: Record<PurchaseOrderStatus, string> = {
  draft: "bg-[#fce4ec] text-[#880e4f]",
  pending: "bg-[#fef3e2] text-[#8a5300]",
  approved: "bg-[#fef3e2] text-[#8a5300]",
  sent: "bg-[#ebf0fd] text-[#1a4db0]",
};

export function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<PurchaseOrderRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [loadingWarehouses, setLoadingWarehouses] = useState(true);
  const [factories, setFactories] = useState<FactoryOption[]>([]);
  const [loadingFactories, setLoadingFactories] = useState(true);
  const [savingFactory, setSavingFactory] = useState(false);
  const [savingPo, setSavingPo] = useState(false);
  const [query, setQuery] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<PoFormState>(defaultPoForm);
  const [draftItems, setDraftItems] = useState<PoDraftItem[]>([
    { sku: "", moq: "5", qty: "", dailyAvg: "", stock: "", cbm: "" },
  ]);

  const filteredOrders = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return orders;

    return orders.filter((order) =>
      [
        order.number,
        order.factory,
        order.destination,
        order.manager,
        order.status,
        ...order.items.map((item) => item.sku),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [orders, query]);

  const selectedOrder =
    orders.find((order) => order.id === selectedId) ??
    filteredOrders[0] ??
    null;

  const draftTotals = useMemo(() => {
    const validItems = draftItems.filter((item) => item.sku.trim() || parseNumber(item.qty) > 0);
    const totalQty = draftItems.reduce((sum, item) => sum + parseNumber(item.qty), 0);
    const totalCbm = draftItems.reduce(
      (sum, item) => sum + parseNumber(item.qty) * (parseNumber(item.cbm) || inferSkuCbm(item.sku)),
      0
    );
    return { validCount: validItems.length, totalQty, totalCbm };
  }, [draftItems]);

  const stats = {
    total: orders.length,
    totalUnits: orders.reduce((sum, order) => sum + orderQty(order), 0),
    totalCbm: orders.reduce((sum, order) => sum + orderCbm(order), 0),
    sent: orders.filter((order) => order.status === "sent").length,
  };

  const warehouseNameByCode = useMemo(
    () => new Map(warehouses.map((warehouse) => [warehouse.warehouseCode, warehouse.warehouseName])),
    [warehouses]
  );

  async function fetchOrders() {
    setLoadingOrders(true);
    setOrdersError(null);
    try {
      const response = await fetch("/api/purchase-orders", { cache: "no-store" });
      const json = await response.json();

      if (!json.success) {
        throw new Error(json.error ?? "Failed to fetch purchase orders");
      }

      const nextOrders = json.data as PurchaseOrderRecord[];
      setOrders(nextOrders);
      setSelectedId((current) => {
        if (current && nextOrders.some((order) => order.id === current)) return current;
        return nextOrders[0]?.id ?? "";
      });
    } catch (error) {
      setOrdersError(error instanceof Error ? error.message : "Failed to fetch purchase orders");
      setOrders([]);
      setSelectedId("");
    } finally {
      setLoadingOrders(false);
    }
  }

  async function fetchWarehouses() {
    setLoadingWarehouses(true);
    try {
      const response = await fetch("/api/warehouses?active=true", { cache: "no-store" });
      const json = await response.json();
      if (json.success) {
        setWarehouses((json.data as WarehouseOption[]).filter((warehouse) => warehouse.isActive));
      } else {
        setWarehouses([]);
      }
    } catch {
      setWarehouses([]);
    } finally {
      setLoadingWarehouses(false);
    }
  }

  async function fetchFactories() {
    setLoadingFactories(true);
    try {
      const response = await fetch("/api/factories?active=true", { cache: "no-store" });
      const json = await response.json();
      if (json.success) {
        setFactories((json.data as FactoryOption[]).filter((factory) => factory.isActive));
      } else {
        setFactories([]);
      }
    } catch {
      setFactories([]);
    } finally {
      setLoadingFactories(false);
    }
  }

  async function ensureFactory(factoryName: string) {
    const trimmed = factoryName.trim();
    if (!trimmed) return;
    if (factories.some((factory) => factory.factoryName.toLowerCase() === trimmed.toLowerCase())) return;

    setSavingFactory(true);
    try {
      const response = await fetch("/api/factories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factoryName: trimmed }),
      });
      const json = await response.json();
      if (json.success) {
        setFactories((current) => {
          const exists = current.some(
            (factory) => factory.factoryName.toLowerCase() === json.data.factoryName.toLowerCase()
          );
          return exists ? current : [...current, json.data].sort((a, b) => a.factoryName.localeCompare(b.factoryName));
        });
      }
    } finally {
      setSavingFactory(false);
    }
  }

  function buildSavePayload(nextStatus: PurchaseOrderStatus = "draft") {
    const items = draftItems
      .map((item) => {
        const sku = item.sku.trim();
        const qty = Math.trunc(parseNumber(item.qty));
        const moq = Math.trunc(parseNumber(item.moq)) || 5;
        const cbm = parseNumber(item.cbm) || inferSkuCbm(sku);
        return { sku, qty, moq, cbm };
      })
      .filter((item) => item.sku && item.qty > 0);

    return {
      number: form.number.trim(),
      date: form.date,
      eta: form.eta,
      factory: form.factory.trim(),
      destination: form.destination,
      manager: form.manager.trim(),
      note: form.note.trim(),
      status: nextStatus,
      items,
    };
  }

  async function savePurchaseOrder(nextStatus: PurchaseOrderStatus = "draft") {
    const payload = buildSavePayload(nextStatus);

    if (!payload.number) {
      window.alert("Please enter a PO number.");
      return;
    }
    if (!payload.date || !payload.eta) {
      window.alert("Please enter order date and ETA date.");
      return;
    }
    if (!payload.factory) {
      window.alert("Please enter a factory.");
      return;
    }
    if (payload.items.length === 0) {
      window.alert("Please add at least one SKU with quantity.");
      return;
    }

    setSavingPo(true);
    try {
      const response = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await response.json();

      if (!json.success) {
        window.alert(json.error ?? "Failed to save purchase order.");
        return;
      }

      await fetchOrders();
      await fetchFactories();
      setSelectedId(json.data.id);
      setIsCreating(false);
    } finally {
      setSavingPo(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchOrders();
    void fetchWarehouses();
    void fetchFactories();
  }, []);

  useEffect(() => {
    if (!isCreating || form.destination || !warehouses[0]) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm((current) => ({ ...current, destination: warehouses[0].warehouseCode }));
  }, [form.destination, isCreating, warehouses]);

  function startCreate() {
    setIsCreating(true);
    setForm({
      ...defaultPoForm,
      destination: warehouses[0]?.warehouseCode ?? "",
    });
    setDraftItems([{ sku: "", moq: "5", qty: "", dailyAvg: "", stock: "", cbm: "" }]);
  }

  function updateForm<K extends keyof PoFormState>(key: K, value: PoFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateDraftItem(index: number, patch: Partial<PoDraftItem>) {
    setDraftItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const next = { ...item, ...patch };
        if (patch.sku && !item.cbm) next.cbm = String(inferSkuCbm(patch.sku));
        return next;
      })
    );
  }

  function addDraftItem() {
    setDraftItems((current) => [...current, { sku: "", moq: "5", qty: "", dailyAvg: "", stock: "", cbm: "" }]);
  }

  function removeDraftItem(index: number) {
    setDraftItems((current) =>
      current.length === 1 ? [{ sku: "", moq: "5", qty: "", dailyAvg: "", stock: "", cbm: "" }] : current.filter((_, itemIndex) => itemIndex !== index)
    );
  }

  return (
    <section className="purchase-orders-fullbleed flex min-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0] shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] bg-white px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Purchase Orders</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Review factory purchase orders, SKU quantities, CBM totals, and order status.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="form-input h-9 w-72 bg-white"
            placeholder="Search PO / SKU / factory..."
          />
          <button
            type="button"
            onClick={startCreate}
            className="rounded-md bg-[#1a5cdb] px-3 py-2 text-sm font-medium text-white hover:bg-[#1650c4]"
          >
            + Add PO
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 border-b border-[#e2dfd8] bg-[#f0eee9] md:grid-cols-4">
        <PoStat label="Total POs" value={stats.total} sub="Registered orders" />
        <PoStat label="Total Units" value={formatNumber(stats.totalUnits)} sub="Across all SKUs" />
        <PoStat label="Total CBM" value={stats.totalCbm.toFixed(2)} sub="Planned volume" />
        <PoStat label="Sent Orders" value={stats.sent} sub="Sent to factory" />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 bg-white lg:grid-cols-[420px_1fr]">
        <aside className="border-r border-[#e2dfd8] bg-white">
          <div className="flex items-center justify-between border-b border-[#e2dfd8] px-4 py-3">
            <span className="text-sm font-semibold text-muted-foreground">
              {filteredOrders.length} purchase orders
            </span>
            <div className="hidden items-center gap-3 text-[11px] text-muted-foreground sm:flex">
              <StatusLegend color="#d4537e" label="Draft" />
              <StatusLegend color="#ef9f27" label="Pending" />
              <StatusLegend color="#378add" label="Sent" />
            </div>
          </div>

          <div className="h-full overflow-y-auto">
            {loadingOrders ? (
              <div className="p-5 text-center text-xs text-muted-foreground">
                Loading purchase orders from database...
              </div>
            ) : ordersError ? (
              <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-700">
                {ordersError}
              </div>
            ) : filteredOrders.length > 0 ? (
              filteredOrders.map((order) => {
                const totalQty = orderQty(order);
                const totalCbm = orderCbm(order);
                return (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(order.id);
                      setIsCreating(false);
                    }}
                    className={`flex w-full items-start gap-3 border-b border-[#e2dfd8] px-4 py-3 text-left transition-colors hover:bg-[#f0eee9] ${
                      !isCreating && selectedOrder?.id === order.id ? "border-l-4 border-l-[#1a5cdb] bg-[#ebf0fd]" : ""
                    }`}
                  >
                    <span
                      className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-black/10"
                      style={{
                        backgroundColor:
                          order.status === "sent"
                            ? "#378add"
                            : order.status === "approved" || order.status === "pending"
                              ? "#ef9f27"
                              : "#d4537e",
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-bold">{order.number}</span>
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${statusClasses[order.status]}`}>
                          {order.status}
                        </span>
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {order.factory} / {order.destination}
                      </span>
                      <span className="mt-1 block text-[10px] text-muted-foreground">
                        ETA {order.eta} / {order.items.length} SKUs / {formatNumber(totalQty)} units / {totalCbm.toFixed(1)} CBM
                      </span>
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="p-5">
                <button
                  type="button"
                  onClick={startCreate}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#cccac4] bg-[#f0eee9] p-10 text-center text-muted-foreground transition-colors hover:border-[#1a5cdb] hover:bg-[#ebf0fd] hover:text-[#1a4db0]"
                >
                  <span className="text-3xl">+</span>
                  <span className="text-sm font-semibold">No purchase orders found in Database</span>
                  <span className="text-xs">Click + Add PO to create a new purchase order</span>
                </button>
              </div>
            )}
          </div>
        </aside>

        <main className="min-w-0 bg-white">
          {isCreating ? (
            <PurchaseOrderCreateForm
              form={form}
              draftItems={draftItems}
              totals={draftTotals}
              warehouses={warehouses}
              loadingWarehouses={loadingWarehouses}
              factories={factories}
              loadingFactories={loadingFactories}
              savingFactory={savingFactory}
              savingPo={savingPo}
              onChange={updateForm}
              onEnsureFactory={ensureFactory}
              onSave={() => savePurchaseOrder("draft")}
              onRequestReview={() => savePurchaseOrder("pending")}
              onUpdateItem={updateDraftItem}
              onAddItem={addDraftItem}
              onRemoveItem={removeDraftItem}
              onCancel={() => setIsCreating(false)}
            />
          ) : loadingOrders ? (
            <div className="flex h-full min-h-[520px] flex-col items-center justify-center gap-3 text-muted-foreground">
              <div className="text-sm font-medium">Loading purchase order details...</div>
              <div className="text-xs">Reading fc_purchase_orders and fc_purchase_order_items</div>
            </div>
          ) : selectedOrder ? (
            <PurchaseOrderDetail order={selectedOrder} warehouseNameByCode={warehouseNameByCode} />
          ) : (
            <div className="flex h-full min-h-[520px] flex-col items-center justify-center gap-3 text-muted-foreground">
              <div className="text-5xl opacity-50">▦</div>
              <div className="text-sm font-medium">Select a purchase order or add a new one</div>
              <div className="text-xs">Click a PO in the left list to view SKU details</div>
              <button
                type="button"
                onClick={startCreate}
                className="mt-2 rounded-md bg-[#1a5cdb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1650c4]"
              >
                + Add PO
              </button>
            </div>
          )}
        </main>
      </div>
    </section>
  );
}

function inferSkuCbm(sku: string) {
  return mockSkus.find((item) => item.id === sku)?.cbmUnit ?? 0;
}

function StatusLegend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function PoStat({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return (
    <div className="border-r border-[#e2dfd8] px-5 py-3 last:border-r-0">
      <div className="text-[10px] uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function PurchaseOrderCreateForm({
  form,
  draftItems,
  totals,
  warehouses,
  loadingWarehouses,
  factories,
  loadingFactories,
  savingFactory,
  savingPo,
  onChange,
  onEnsureFactory,
  onSave,
  onRequestReview,
  onUpdateItem,
  onAddItem,
  onRemoveItem,
  onCancel,
}: {
  form: PoFormState;
  draftItems: PoDraftItem[];
  totals: { validCount: number; totalQty: number; totalCbm: number };
  warehouses: WarehouseOption[];
  loadingWarehouses: boolean;
  factories: FactoryOption[];
  loadingFactories: boolean;
  savingFactory: boolean;
  savingPo: boolean;
  onChange: <K extends keyof PoFormState>(key: K, value: PoFormState[K]) => void;
  onEnsureFactory: (factoryName: string) => void | Promise<void>;
  onSave: () => void | Promise<void>;
  onRequestReview: () => void | Promise<void>;
  onUpdateItem: (index: number, patch: Partial<PoDraftItem>) => void;
  onAddItem: () => void;
  onRemoveItem: (index: number) => void;
  onCancel: () => void;
}) {
  const cbmUsage = Math.min((totals.totalCbm / 67.5) * 100, 100);
  const neededContainers = totals.totalCbm > 0 ? Math.ceil(totals.totalCbm / 67.5) : 0;

  return (
    <div className="flex h-full min-h-[720px] flex-col bg-[#f5f4f0]">
      <div className="border-b border-[#e2dfd8] bg-white px-6 py-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <StepPill active>Drafting</StepPill>
          <span>→</span>
          <StepPill>Under Review</StepPill>
          <span>→</span>
          <StepPill>Approved</StepPill>
          <span>→</span>
          <StepPill>Sent to Factory</StepPill>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <FormCard
          title="Purchase Order Details"
          right={<span className="rounded-full bg-[#f0eee9] px-2 py-1 text-[11px] font-semibold text-muted-foreground">Draft</span>}
        >
          <div className="grid gap-3 md:grid-cols-3">
            <FormField label="PO Number">
              <div className="rounded-md px-0 py-2 font-mono text-sm text-[#1a5cdb]">{form.number}</div>
            </FormField>
            <FormField label="Order Date">
              <input className="form-input bg-white" type="date" value={form.date} onChange={(event) => onChange("date", event.target.value)} />
            </FormField>
            <FormField label="ETA Date">
              <input className="form-input bg-white" type="date" value={form.eta} onChange={(event) => onChange("eta", event.target.value)} />
            </FormField>
            <FormField label="Factory">
              <input
                className="form-input bg-white"
                list="po-factory-list"
                value={form.factory}
                onChange={(event) => onChange("factory", event.target.value)}
                onBlur={() => void onEnsureFactory(form.factory)}
                placeholder={loadingFactories ? "Loading factories..." : "Factory name"}
              />
              <datalist id="po-factory-list">
                {factories.map((factory) => (
                  <option key={factory.id} value={factory.factoryName} />
                ))}
              </datalist>
              {savingFactory ? (
                <span className="text-[11px] text-muted-foreground">Saving new factory...</span>
              ) : null}
            </FormField>
            <FormField label="Destination Warehouse">
              <select className="form-input bg-white" value={form.destination} onChange={(event) => onChange("destination", event.target.value)}>
                {loadingWarehouses ? (
                  <option value="">Loading warehouses...</option>
                ) : warehouses.length > 0 ? (
                  warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.warehouseCode}>
                      {warehouse.warehouseName}
                    </option>
                  ))
                ) : (
                  <option value="">No active warehouses</option>
                )}
              </select>
            </FormField>
            <FormField label="Manager">
              <input className="form-input bg-white" value={form.manager} onChange={(event) => onChange("manager", event.target.value)} />
            </FormField>
            <div className="md:col-span-3">
              <FormField label="Memo">
                <textarea
                  className="form-input min-h-14 bg-white"
                  value={form.note}
                  onChange={(event) => onChange("note", event.target.value)}
                  placeholder="Notes..."
                />
              </FormField>
            </div>
          </div>
        </FormCard>

        <FormCard
          title="SKU Order Quantities"
          right={
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{totals.validCount}</span>
              <button type="button" className="rounded-md border border-[#8fb8ff] bg-[#ebf0fd] px-3 py-1.5 text-xs font-semibold text-[#1a5cdb]">
                Auto-fill Shortage SKUs
              </button>
              <button type="button" className="rounded-md border border-[#9ed8c8] bg-[#e6f5f0] px-3 py-1.5 text-xs font-semibold text-[#0a5e45]">
                CSV/Excel Import
              </button>
              <button type="button" className="rounded-md border border-[#cccac4] bg-white px-3 py-1.5 text-xs text-muted-foreground">
                Download Template
              </button>
            </div>
          }
        >
          <div className="overflow-hidden rounded-lg border border-[#e2dfd8]">
            <div className="grid grid-cols-[2fr_0.8fr_0.8fr_0.8fr_0.9fr_0.8fr_64px] bg-[#f0eee9] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
              <div>Master SKU</div>
              <div>MOQ</div>
              <div>Order Qty</div>
              <div>Daily Avg</div>
              <div>Current Stock</div>
              <div>CBM</div>
              <div className="text-right">Delete</div>
            </div>
            {draftItems.map((item, index) => (
              <div key={index} className="grid grid-cols-[2fr_0.8fr_0.8fr_0.8fr_0.9fr_0.8fr_64px] items-center gap-2 border-t bg-white px-3 py-2 text-sm">
                <input
                  className="form-input h-9 bg-white font-mono text-xs"
                  list="po-sku-list"
                  value={item.sku}
                  onChange={(event) => onUpdateItem(index, { sku: event.target.value })}
                  placeholder="Master SKU..."
                />
                <input className="form-input h-9 bg-white" value={item.moq} onChange={(event) => onUpdateItem(index, { moq: event.target.value })} />
                <input className="form-input h-9 bg-white" value={item.qty} onChange={(event) => onUpdateItem(index, { qty: event.target.value })} placeholder="Qty" />
                <input className="form-input h-9 bg-white" value={item.dailyAvg} onChange={(event) => onUpdateItem(index, { dailyAvg: event.target.value })} placeholder="per day" />
                <input className="form-input h-9 bg-white" value={item.stock} onChange={(event) => onUpdateItem(index, { stock: event.target.value })} placeholder="Stock" />
                <input className="form-input h-9 bg-white" value={item.cbm} onChange={(event) => onUpdateItem(index, { cbm: event.target.value })} placeholder="0.048" />
                <button type="button" onClick={() => onRemoveItem(index)} className="text-right text-xs font-semibold text-[#c42b2b]">
                  Delete
                </button>
              </div>
            ))}
            <datalist id="po-sku-list">
              {mockSkus.map((sku) => <option key={sku.id} value={sku.id} />)}
            </datalist>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <button type="button" onClick={onAddItem} className="rounded-md bg-[#1a5cdb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1650c4]">
              + Add
            </button>
            <div className="flex flex-wrap gap-6 text-sm">
              <span>Total SKUs: <strong>{totals.validCount}</strong></span>
              <span>Total Qty: <strong>{formatNumber(totals.totalQty)}</strong></span>
              <span>Total CBM: <strong>{totals.totalCbm.toFixed(2)} m3</strong></span>
            </div>
          </div>
        </FormCard>

        <FormCard title="CBM Simulation">
          <div className="grid gap-3 md:grid-cols-3">
            <MetricBox label="Total CBM" value={`${totals.totalCbm.toFixed(1)} m3`} />
            <MetricBox label="Load Rate" value={`${cbmUsage.toFixed(0)}%`} />
            <MetricBox label="Containers Needed" value={`${neededContainers}`} />
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            Based on 67.5 m3 per container / recommended load rate 80-95%
          </div>
        </FormCard>
      </div>

      <div className="flex items-center justify-between border-t border-[#e2dfd8] bg-white px-5 py-3">
        <div className="font-mono text-xs text-muted-foreground">{form.number} · Draft</div>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border border-[#cccac4] bg-white px-4 py-2 text-sm font-medium hover:bg-[#f0eee9]">
            Cancel
          </button>
          <button
            type="button"
            disabled={savingPo}
            onClick={() => void onSave()}
            className="rounded-md border border-[#cccac4] bg-white px-4 py-2 text-sm font-medium hover:bg-[#f0eee9] disabled:opacity-50"
          >
            {savingPo ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            disabled={savingPo}
            onClick={() => void onRequestReview()}
            className="rounded-md bg-[#1a5cdb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1650c4] disabled:opacity-50"
          >
            Request Review
          </button>
          <button type="button" onClick={onCancel} className="rounded-md bg-[#c42b2b] px-4 py-2 text-sm font-medium text-white hover:bg-[#9b2020]">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function StepPill({ active = false, children }: { active?: boolean; children: ReactNode }) {
  return (
    <span className={`rounded-full border px-3 py-1 font-semibold ${active ? "border-[#1a5cdb] bg-[#ebf0fd] text-[#1a5cdb]" : "border-[#cccac4] bg-white text-muted-foreground"}`}>
      {children}
    </span>
  );
}

function FormCard({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[#e2dfd8] bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-[#e2dfd8] pb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#e2dfd8] bg-white p-3">
      <div className="text-[11px] font-semibold text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-bold text-[#1a5cdb]">{value}</div>
    </div>
  );
}

function PurchaseOrderDetail({
  order,
  warehouseNameByCode,
}: {
  order: PurchaseOrderRecord;
  warehouseNameByCode: Map<string, string>;
}) {
  const totalQty = orderQty(order);
  const totalCbm = orderCbm(order);
  const cbmUsage = Math.min((totalCbm / 67.5) * 100, 100);
  const destinationLabel = warehouseNameByCode.get(order.destination ?? "") ?? order.destination;

  return (
    <div className="h-full overflow-y-auto px-7 py-6">
      <article className="overflow-hidden rounded-xl border border-[#e2dfd8] bg-white shadow-sm">
        <div className="flex w-full items-center gap-4 px-5 py-4 text-left">
          <div className="min-w-[120px] font-mono text-sm font-semibold">{order.number}</div>

          <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 md:grid-cols-4">
            <PoMeta label="Factory">{order.factory}</PoMeta>
            <PoMeta label="Destination">{destinationLabel}</PoMeta>
            <PoMeta label="SKU">
              {order.items.length} kinds / {formatNumber(totalQty)} units
            </PoMeta>
            <PoMeta label="CBM">{totalCbm.toFixed(1)} / 67.5 m3</PoMeta>
          </div>

          <div className="hidden font-mono text-sm font-semibold text-[#1a5cdb] lg:block">
            ETA {order.eta}
          </div>

          <span className={`hidden rounded-full px-3 py-1 text-xs font-semibold xl:inline-flex ${statusClasses[order.status]}`}>
            {order.status}
          </span>
        </div>

        <div className="border-t">
          <div className="grid grid-cols-[2.2fr_0.7fr_0.8fr_0.9fr_0.9fr] bg-[#f0eee9] px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            <div>Master SKU</div>
            <div>MOQ</div>
            <div>Qty</div>
            <div>CBM / Unit</div>
            <div>Total CBM</div>
          </div>

          {order.items.map((item) => (
            <div key={item.sku} className="grid grid-cols-[2.2fr_0.7fr_0.8fr_0.9fr_0.9fr] items-center border-t px-5 py-3 text-sm hover:bg-[#f8f7f4]">
              <div className="truncate font-mono text-xs font-medium">{item.sku}</div>
              <div>{formatNumber(item.moq)}</div>
              <div className="font-semibold">{formatNumber(item.qty)} units</div>
              <div className="text-xs text-muted-foreground">{item.cbm.toFixed(3)} m3</div>
              <div className="font-semibold">{(item.qty * item.cbm).toFixed(2)} m3</div>
            </div>
          ))}

          <div className="flex flex-col gap-3 border-t bg-[#f0eee9] px-5 py-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
            <div className="flex gap-5">
              <span>
                Total Qty: <strong className="text-foreground">{formatNumber(totalQty)} units</strong>
              </span>
              <span>
                CBM: <strong className="text-foreground">{totalCbm.toFixed(2)} m3</strong>
              </span>
            </div>
            <div className="text-xs">
              Manager {order.manager} / Order Date {order.date}
            </div>
          </div>

          <div className="px-5 pb-4 pt-3">
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>CBM simulation</span>
              <span>
                {cbmUsage.toFixed(0)}% ({totalCbm.toFixed(2)} / 67.5 m3)
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded border border-[#e2dfd8] bg-[#f0eee9]">
              <div className="h-full rounded bg-[#1a5cdb]" style={{ width: `${cbmUsage}%` }} />
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              Recommended loading range: 80-95%
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}

function PoMeta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 text-xs">
      <div className="text-[10px] uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
      <div className="truncate font-medium text-foreground">{children}</div>
    </div>
  );
}
