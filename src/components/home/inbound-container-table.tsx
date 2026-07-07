"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/i18n-provider";

const TIMELINE_BASE = "/planning/container-timeline";
const DASHBOARD_LIST_ROW_HEIGHT = "h-9";

export interface InboundContainer {
  name: string;
  eta: string | null;
  confirmedDate: string | null;
  confirmedTime: string | null;
  qty: number;
  status: string;
  skuCount: number;
}

interface Props {
  items: InboundContainer[];
  loading?: boolean;
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-muted ${className ?? ""}`} />;
}

function formatDate(value: string | null) {
  return value
    ? new Date(value).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" })
    : "—";
}

function formatConfirmed(date: string | null, time: string | null) {
  if (!date) return "—";
  return `${formatDate(date)}${time ? ` ${time}` : ""}`;
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
            <th className="pb-2 text-right">SKU</th>
            <th className="pb-2 text-center">ETA</th>
            <th className="pb-2 text-center">{pick("입고 확정", "Confirmed")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#f0eee9] dark:divide-zinc-700/50">
          {items.map((item) => {
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
                <td className="py-2 text-right tabular-nums text-muted-foreground">
                  {item.skuCount}
                </td>
                <td className={`py-2 text-center tabular-nums ${isPast ? "text-red-500 dark:text-red-400" : "text-muted-foreground"}`}>
                  {formatDate(item.eta)}
                </td>
                <td className="py-2 text-center tabular-nums text-muted-foreground">
                  {formatConfirmed(item.confirmedDate, item.confirmedTime)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
