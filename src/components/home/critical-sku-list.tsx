"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/i18n-provider";

export interface TopCriticalSku {
  sku: string;
  totalStock: number;
  avgDaily: number;
  sodDays: number;
  back: number;
  nextEta: string | null;
}

interface Props {
  items: TopCriticalSku[];
  loading?: boolean;
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-muted ${className ?? ""}`} />;
}

const SKU_BASE = "/planning/sku-forecasts";
const DASHBOARD_LIST_ROW_HEIGHT = "h-9";

export function CriticalSkuList({ items, loading }: Props) {
  const { pick } = useI18n();

  if (loading) {
    return (
      <div className="space-y-2 p-1">
        {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className={`${DASHBOARD_LIST_ROW_HEIGHT} w-full`} />)}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="py-5 text-center text-sm text-muted-foreground">
        {pick("위험 SKU 없음", "No critical SKUs")}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="pb-2 text-left">Master SKU</th>
            <th className="pb-2 text-right">{pick("일평균", "Daily Avg")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#f0eee9] dark:divide-zinc-700/50">
          {items.map((item) => (
            <tr key={item.sku} className={`${DASHBOARD_LIST_ROW_HEIGHT} group transition-colors hover:bg-[#f8f7f4] dark:hover:bg-zinc-800/40`}>
              <td className="py-2 pr-3">
                <Link
                  href={`${SKU_BASE}?sku=${encodeURIComponent(item.sku)}`}
                  className="font-mono font-medium text-[#1a5cdb] hover:underline dark:text-blue-400"
                >
                  {item.sku}
                </Link>
              </td>
              <td className="py-2 text-right tabular-nums text-muted-foreground">
                {item.avgDaily.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
