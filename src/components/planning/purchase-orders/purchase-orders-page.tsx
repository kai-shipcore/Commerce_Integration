"use client";

import { useState } from "react";
import { mockPurchaseOrders } from "@/features/planning/mock-data";

export function PurchaseOrdersPage() {
  const [selectedId, setSelectedId] = useState(mockPurchaseOrders[0].id);
  const selectedOrder =
    mockPurchaseOrders.find((order) => order.id === selectedId) ?? mockPurchaseOrders[0];
  const totalCbm = selectedOrder.items.reduce((sum, item) => sum + item.qty * item.cbm, 0);

  return (
    <section className="grid min-h-[calc(100vh-8rem)] gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="planning-panel overflow-hidden rounded-xl border">
        <div className="flex items-center justify-between border-b p-4">
          <h1 className="text-sm font-semibold">Purchase Orders</h1>
          <span className="text-xs text-muted-foreground">{mockPurchaseOrders.length} total</span>
        </div>
        <div className="space-y-2 p-3">
          {mockPurchaseOrders.map((order) => (
            <button
              key={order.id}
              onClick={() => setSelectedId(order.id)}
              className={`w-full rounded-lg border p-3 text-left ${
                order.id === selectedId ? "border-[#1a5cdb] bg-[#ebf0fd]" : "bg-background"
              }`}
            >
              <div className="font-medium">{order.number}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {order.factory} · {order.eta}
              </div>
            </button>
          ))}
        </div>
      </aside>

      <div className="min-w-0 space-y-4">
        <header className="planning-panel rounded-xl border p-5">
          <h2 className="text-2xl font-semibold tracking-tight">{selectedOrder.number}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {selectedOrder.factory} · ETA {selectedOrder.eta} · {selectedOrder.destination}
          </p>
        </header>

        <div className="grid gap-3 md:grid-cols-3">
          {[
            ["Order Date", selectedOrder.date],
            ["Manager", selectedOrder.manager],
            ["Status", selectedOrder.status],
          ].map(([label, value]) => (
            <div key={label} className="planning-panel rounded-xl border p-4">
              <div className="text-xs uppercase text-muted-foreground">{label}</div>
              <div className="mt-2 font-semibold">{value}</div>
            </div>
          ))}
        </div>

        <div className="planning-panel overflow-hidden rounded-xl border">
          <div className="planning-muted grid grid-cols-5 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span>Master SKU</span>
            <span>MOQ</span>
            <span>Qty</span>
            <span>CBM / Unit</span>
            <span>Total CBM</span>
          </div>
          {selectedOrder.items.map((item) => (
            <div key={item.sku} className="grid grid-cols-5 border-t px-4 py-3 text-sm">
              <span>{item.sku}</span>
              <span>{item.moq}</span>
              <span>{item.qty}</span>
              <span>{item.cbm}</span>
              <span>{(item.qty * item.cbm).toFixed(2)}</span>
            </div>
          ))}
        </div>

        <div className="planning-panel rounded-xl border p-5">
          <div className="text-sm text-muted-foreground">CBM Simulation</div>
          <div className="mt-2 text-3xl font-semibold">{totalCbm.toFixed(2)} m³</div>
          <div className="planning-muted mt-4 h-3 overflow-hidden rounded-full border">
            <div
              className="h-full bg-[#1a5cdb]"
              style={{ width: `${Math.min((totalCbm / 67.5) * 100, 100)}%` }}
            />
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Recommended loading range: 80–95%
          </div>
        </div>
      </div>
    </section>
  );
}
