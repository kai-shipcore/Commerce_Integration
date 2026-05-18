import { getInboundQty, mockContainers, type MockSku } from "@/features/planning/mock-data";

export function InventoryInboundTab({ sku }: { sku: MockSku }) {
  const inboundQty = getInboundQty(sku.id);
  const containers = mockContainers.filter((container) =>
    container.items.some((item) => item.sku === sku.id)
  );

  return (
    <div className="space-y-4">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Inventory timeline
      </div>
      <div className="planning-panel rounded-xl border p-4">
        <div className="flex items-center justify-between text-sm">
          <span>Today: {sku.stock} units</span>
          <span>SOD {sku.sod}</span>
        </div>
        <div className="planning-muted mt-4 h-6 overflow-hidden rounded-full border">
          <div
            className="h-full bg-[#1a5cdb]"
            style={{ width: `${Math.min((sku.life / 120) * 100, 100)}%` }}
          />
        </div>
      </div>
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Inbound outlook
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="planning-panel rounded-xl border p-4">
          <h3 className="text-lg font-semibold">Inbound Containers</h3>
          <div className="mt-4 space-y-2">
            {containers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No inbound containers.</p>
            ) : (
              containers.map((container) => (
                <div key={container.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                  <span>{container.number}</span>
                  <span>{container.eta}</span>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="grid gap-3">
          {[
            ["Current Stock", sku.stock],
            ["Inbound", `+${inboundQty}`],
            ["Projected Total", sku.stock + inboundQty],
          ].map(([label, value]) => (
            <div key={label} className="planning-panel rounded-xl border p-4">
              <div className="text-xs uppercase text-muted-foreground">{label}</div>
              <div className="mt-2 text-2xl font-semibold">{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
