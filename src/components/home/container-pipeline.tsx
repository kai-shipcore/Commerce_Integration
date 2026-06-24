"use client";

import { useI18n } from "@/lib/i18n/i18n-provider";

export interface InboundContainer {
  name: string;
  eta: string | null;
  status: string;
  cbmCapacity: number;
  usedCbm: number;
  skuCount: number;
  qty: number;
}

interface Props {
  containers: InboundContainer[];
  loading?: boolean;
}

const STATUS_CONFIG: Record<string, { label: string; labelKo: string; color: string }> = {
  "draft":                 { label: "Draft",    labelKo: "초안",     color: "#94a3b8" },
  "final-list-sent":       { label: "Ordered",  labelKo: "발주완료", color: "#f59e0b" },
  "packing-list-received": { label: "Packing",  labelKo: "패킹",     color: "#3b82f6" },
  "shipped":               { label: "Shipped",  labelKo: "선적",     color: "#8b5cf6" },
  "packing_received":      { label: "Arrived",  labelKo: "도착",     color: "#10b981" },
};

function cbmBarColor(pct: number): string {
  if (pct >= 90) return "#dc2626";
  if (pct >= 70) return "#f59e0b";
  return "#3b82f6";
}

function Skeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="animate-pulse rounded-lg border border-[#e2dfd8] bg-[#f8f7f4] p-3 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mb-2 flex justify-between">
            <div className="h-3.5 w-24 rounded bg-muted" />
            <div className="h-4 w-12 rounded-full bg-muted" />
          </div>
          <div className="mb-1 h-2 w-full rounded-full bg-muted" />
          <div className="flex justify-between">
            <div className="h-3 w-14 rounded bg-muted" />
            <div className="h-3 w-16 rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ContainerPipeline({ containers, loading }: Props) {
  const { pick } = useI18n();

  if (loading) return <Skeleton />;

  if (containers.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        {pick("활성 컨테이너 없음", "No active containers")}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {containers.map((c) => {
        const pct = c.cbmCapacity > 0 ? Math.min(100, (c.usedCbm / c.cbmCapacity) * 100) : 0;
        const cfg = STATUS_CONFIG[c.status] ?? { label: c.status, labelKo: c.status, color: "#94a3b8" };

        return (
          <div
            key={c.name}
            className="rounded-lg border border-[#e2dfd8] bg-[#f8f7f4] p-3 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <span className="truncate font-mono text-xs font-semibold">{c.name}</span>
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                style={{ backgroundColor: cfg.color }}
              >
                {pick(cfg.labelKo, cfg.label)}
              </span>
            </div>

            {c.cbmCapacity > 0 && (
              <div className="mb-2">
                <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
                  <span>CBM</span>
                  <span>{pct.toFixed(0)}% ({c.usedCbm.toFixed(0)} / {c.cbmCapacity} m³)</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[#e2dfd8] dark:bg-zinc-700">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${pct}%`, backgroundColor: cbmBarColor(pct) }}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>SKU {c.skuCount.toLocaleString()}{pick("종", "")}</span>
              <span>
                ETA:{" "}
                {c.eta
                  ? new Date(c.eta).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                  : "—"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
