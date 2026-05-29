import Link from "next/link";
import type { ContainerMeta, DemandRow } from "@/types/demand-planning";
import { daysUntil, formatNumber } from "../types";

export function InventoryInboundTab({
  sku,
  containers,
  containerDetailsLoading,
  containerDetailsLoaded,
}: {
  sku: DemandRow;
  containers: ContainerMeta[];
  containerDetailsLoading: boolean;
  containerDetailsLoaded: boolean;
}) {
  // Match server-side: only shipped + packing_received count toward inbound
  const inboundRows = containers
    .filter((c) => c.status === "shipped" || c.status === "packing_received")
    .map((container) => {
      const detail = sku.containers?.[container.name];
      const qty = detail?.inbound_qty ?? 0;
      return { container, detail, qty };
    })
    .filter((row) => row.qty > 0);
  const inboundQty = sku.total_inbound_qty ?? 0;
  const projected = sku.total_stock + inboundQty + Math.min(sku.back, 0);
  const days = daysUntil(sku.sod);

  return (
    <div className="space-y-4">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Inventory and inbound
      </div>
      <div className="planning-panel rounded-lg border p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Summary label="West Stock" value={sku.west_stock} />
          <Summary label="East Stock" value={sku.east_stock} />
          <Summary label="Backorder" value={sku.back} danger={sku.back < 0} />
          <Summary label="SOD" value={sku.sod ?? "-"} sub={days === null ? undefined : `${days} days`} />
        </div>
        <div className="planning-muted mt-4 h-6 overflow-hidden rounded-full border">
          <div
            className="h-full bg-[#1a5cdb]"
            style={{ width: `${Math.min(Math.max((projected / Math.max(sku.total_avg_curr * 120, 1)) * 100, 3), 100)}%` }}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="planning-panel rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Inbound Containers</h3>
            <span className="text-xs text-muted-foreground">
              {containerDetailsLoading ? "Loading..." : containerDetailsLoaded ? "Ready" : "Pending"}
            </span>
          </div>
          <div className="mt-4 space-y-2">
            {containerDetailsLoading && inboundRows.length === 0 ? (
              <div className="rounded-md border bg-[#f8f7f4] p-4 text-sm text-muted-foreground dark:border-zinc-700 dark:bg-zinc-800">Loading container details...</div>
            ) : inboundRows.length === 0 ? (
              <div className="rounded-md border bg-[#f8f7f4] p-4 text-sm text-muted-foreground dark:border-zinc-700 dark:bg-zinc-800">No active inbound containers.</div>
            ) : (
              inboundRows.map(({ container, detail, qty }) => {
                const content = (
                  <>
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{container.name}</div>
                      <div className="text-xs text-muted-foreground group-hover:text-current">{container.status ?? "status unknown"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground group-hover:text-current">ETA</div>
                      <div className="font-mono">{detail?.eta ?? container.eta ?? "-"}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground group-hover:text-current">Qty</div>
                      <div className="font-mono font-semibold">{formatNumber(qty)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground group-hover:text-current">CBM</div>
                      <div className="font-mono">{formatNumber(detail?.cbm ?? 0, 2)}</div>
                    </div>
                  </>
                );
                const className = "group grid gap-2 rounded-md border p-3 text-sm text-foreground transition-colors hover:border-[#1a5cdb] hover:bg-[#ebf0fd] hover:text-[#1238a0] dark:hover:border-blue-500 dark:hover:bg-blue-950/50 dark:hover:text-blue-100 md:grid-cols-[1fr_90px_100px_90px]";
                return container.container_id ? (
                  <Link
                    key={container.name}
                    href={`/planning/container-planning?containerId=${encodeURIComponent(String(container.container_id))}`}
                    className={className}
                  >
                    {content}
                  </Link>
                ) : (
                  <div key={container.name} className={className}>
                    {content}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="grid gap-3">
          <SummaryCard label="Current Stock" value={sku.total_stock} />
          <SummaryCard label="Inbound" value={inboundQty} prefix="+" />
          <SummaryCard label="Projected Stock" value={projected} />
          <SummaryCard label="Remaining / Mistake" value={`${formatNumber(sku.remaining)} / ${formatNumber(sku.mistake)}`} />
        </div>
      </div>
    </div>
  );
}

function Summary({
  label,
  value,
  sub,
  danger = false,
}: {
  label: string;
  value: number | string;
  sub?: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-md border bg-[#f8f7f4] p-3 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-lg font-semibold ${danger ? "text-red-700" : ""}`}>
        {typeof value === "number" ? formatNumber(value) : value}
      </div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  prefix = "",
}: {
  label: string;
  value: number | string;
  prefix?: string;
}) {
  return (
    <div className="planning-panel rounded-lg border p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-2 font-mono text-2xl font-semibold">
        {typeof value === "number" ? `${prefix}${formatNumber(value)}` : value}
      </div>
    </div>
  );
}
