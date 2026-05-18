"use client";

import { useState } from "react";
import {
  containerStatusLabels,
  mockContainers,
  type MockContainer,
} from "@/features/planning/mock-data";

export function ContainerPlanningPage() {
  const [expandedId, setExpandedId] = useState<string | null>(mockContainers[0].id);

  const totalUnits = mockContainers.reduce(
    (sum, container) => sum + container.items.reduce((inner, item) => inner + item.qty, 0),
    0
  );
  const totalCbm = mockContainers.reduce(
    (sum, container) =>
      sum + container.items.reduce((inner, item) => inner + item.qty * item.cbm, 0),
    0
  );

  return (
    <section className="space-y-4">
      <header className="planning-panel flex flex-col gap-4 rounded-xl border p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Container Planning</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sample inbound containers with SKU quantities and arrival status.
          </p>
        </div>
          <button className="rounded-md bg-[#1a5cdb] px-3 py-2 text-sm font-medium text-white">
          Add Container
        </button>
      </header>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Total Containers", mockContainers.length],
          ["Inbound Units", totalUnits],
          ["Total CBM", totalCbm.toFixed(2)],
          ["Active Containers", mockContainers.length],
        ].map(([label, value]) => (
          <div key={label} className="planning-panel rounded-xl border p-4">
            <div className="text-xs uppercase text-muted-foreground">{label}</div>
            <div className="mt-2 text-2xl font-semibold">{value}</div>
          </div>
        ))}
      </div>

      <div className="planning-panel flex flex-wrap gap-4 rounded-xl border p-4 text-sm">
        {[
          ["Container Draft (Pre-Plan)", "#d4537e"],
          ["Final List Sent to Factory", "#ef9f27"],
          ["Packing List Received / Shipped", "#378add"],
        ].map(([label, color]) => (
          <div key={label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {mockContainers.map((container) => (
          <ContainerCard
            key={container.id}
            container={container}
            expanded={expandedId === container.id}
            onToggle={() => setExpandedId(expandedId === container.id ? null : container.id)}
          />
        ))}
      </div>
    </section>
  );
}

function ContainerCard({
  container,
  expanded,
  onToggle,
}: {
  container: MockContainer;
  expanded: boolean;
  onToggle: () => void;
}) {
  const totalQty = container.items.reduce((sum, item) => sum + item.qty, 0);
  const usedCbm = container.items.reduce((sum, item) => sum + item.qty * item.cbm, 0);

  return (
    <article className="planning-panel overflow-hidden rounded-xl border">
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-4 p-5 text-left">
        <div>
          <div className="text-lg font-semibold">{container.number}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {container.factory} · ETA {container.eta} · {container.destination}
          </div>
        </div>
        <div className="text-right text-sm">
          <div>{containerStatusLabels[container.status]}</div>
          <div className="text-muted-foreground">{totalQty} units</div>
        </div>
      </button>
      {expanded ? (
        <div className="border-t p-5">
          <div className="mb-4 text-sm text-muted-foreground">
            PO {container.poNumbers.join(", ")} · {usedCbm.toFixed(2)} / {container.cbmCapacity} CBM
          </div>
          <div className="space-y-2">
            {container.items.map((item) => (
              <div key={item.sku} className="flex items-center justify-between rounded-lg border bg-[#f0eee9] p-3 text-sm">
                <span>{item.sku}</span>
                <span>{item.qty} units</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}
