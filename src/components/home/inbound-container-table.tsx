"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/i18n-provider";

const TIMELINE_BASE = "/planning/container-timeline";
const DASHBOARD_LIST_ROW_HEIGHT = "h-9";

export interface InboundContainer {
  name: string;
  eta: string | null;
  qty: number;
  status: string;
  skuCount: number;
}

interface Props {
  items: InboundContainer[];
  loading?: boolean;
}

function normalizeStatus(raw: string): string {
  if (raw === "shipped")          return "final-list-sent";
  if (raw === "packing_received") return "packing-list-received";
  if (raw === "complete")         return "complete";
  return "draft";
}

const STATUS_LABEL: Record<string, { ko: string; en: string; color: string }> = {
  "draft":                 { ko: "Draft",   en: "Draft",   color: "#d4537e" },
  "final-list-sent":       { ko: "Packing", en: "Packing", color: "#ef9f27" },
  "packing-list-received": { ko: "Shipped", en: "Shipped", color: "#378add" },
  "complete":              { ko: "Complete",en: "Complete", color: "#22a666" },
};

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-muted ${className ?? ""}`} />;
}

export function InboundContainerTable({ items, loading }: Props) {
  const { pick } = useI18n();

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className={`${DASHBOARD_LIST_ROW_HEIGHT} w-full`} />)}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
        {pick("예정 컨테이너 없음", "No scheduled containers")}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="pb-2 text-left">{pick("컨테이너", "Container")}</th>
            <th className="pb-2 text-center">ETA</th>
            <th className="pb-2 text-center">{pick("상태", "Status")}</th>
            <th className="pb-2 text-right">SKU</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#f0eee9] dark:divide-zinc-700/50">
          {items.map((item) => {
            const cfg = STATUS_LABEL[normalizeStatus(item.status)] ?? { ko: item.status, en: item.status, color: "#94a3b8" };
            const isPast = item.eta ? new Date(item.eta) < new Date(new Date().toDateString()) : false;
            return (
              <tr key={item.name} className={`${DASHBOARD_LIST_ROW_HEIGHT} hover:bg-[#f8f7f4] dark:hover:bg-zinc-800/40`}>
                <td className="py-2 pr-2 font-mono font-medium">
                  <Link
                    href={`${TIMELINE_BASE}?container=${encodeURIComponent(item.name)}`}
                    className="text-[#1a5cdb] hover:underline dark:text-blue-400"
                  >
                    {item.name}
                  </Link>
                </td>
                <td className={`py-2 text-center tabular-nums ${isPast ? "text-red-500 dark:text-red-400" : "text-muted-foreground"}`}>
                  {item.eta
                    ? new Date(item.eta).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" })
                    : "—"}
                </td>
                <td className="py-2 text-center">
                  <span
                    className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                    style={{ backgroundColor: cfg.color }}
                  >
                    {pick(cfg.ko, cfg.en)}
                  </span>
                </td>
                <td className="py-2 text-right tabular-nums text-muted-foreground">
                  {item.skuCount}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
