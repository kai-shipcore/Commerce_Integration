"use client";

/**
 * Code Guide:
 * Per-SKU extremes behind the pooled figures.
 *
 * A pooled metric is a portfolio statement and says nothing about any single
 * SKU. These two lists are where the aggregate comes apart: the SKUs the model
 * handles far better than the spreadsheet, and the ones where it is worse. The
 * second list matters more, because it is the one a planner will be burned by,
 * and each row links through to the SKU so the reason can be looked at.
 */

import Link from "next/link";
import { useI18n } from "@/lib/i18n/i18n-provider";
import type { OutlierRow } from "./types";

const nf = new Intl.NumberFormat("en-US");
const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : "—");

function OutlierTable({
  rows,
  title,
  note,
  tone,
}: {
  rows: OutlierRow[];
  title: string;
  note: string;
  tone: "good" | "bad";
}) {
  const { pick } = useI18n();
  const accent = tone === "good"
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-600 dark:text-red-400";

  return (
    <div className="flex min-w-0 flex-col rounded-md border">
      <div className="border-b px-3 py-2">
        <p className="text-[11px] font-semibold">{title}</p>
        <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">{note}</p>
      </div>
      {rows.length === 0 ? (
        <p className="p-4 text-[11.5px] text-muted-foreground">
          {pick("해당 SKU가 없습니다.", "No SKU falls in this group.")}
        </p>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted text-[9.5px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1.5 pl-3 pr-2 text-left font-medium">SKU</th>
                <th className="py-1.5 pr-2 text-left font-medium">{pick("구간", "Window")}</th>
                <th className="py-1.5 pr-2 text-right font-medium">{pick("실판매", "Units")}</th>
                <th className="py-1.5 pr-2 text-right font-medium">{pick("모델", "Model")}</th>
                <th className="py-1.5 pr-3 text-right font-medium">V1</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.unique_id}-${r.window}`} className="border-t hover:bg-muted/40">
                  <td className="py-1.5 pl-3 pr-2 text-[11px]">
                    <Link
                      href={`/planning/action-list/${encodeURIComponent(r.unique_id)}`}
                      className="hover:text-sky-600 hover:underline dark:hover:text-sky-400"
                    >
                      {r.unique_id}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-2 text-[11px] whitespace-nowrap text-muted-foreground">
                    {r.window}
                  </td>
                  <td className="py-1.5 pr-2 text-right text-[11px] tabular-nums text-muted-foreground">
                    {nf.format(Math.round(r.y_total_cur))}
                  </td>
                  <td className={`py-1.5 pr-2 text-right text-[11px] font-semibold tabular-nums ${accent}`}>
                    {pct(r.wape_cur)}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-[11px] tabular-nums text-muted-foreground">
                    {pct(r.wape_base)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function OutliersSection({
  best,
  worst,
  baseline,
}: {
  best: OutlierRow[];
  worst: OutlierRow[];
  baseline: string;
}) {
  const { pick } = useI18n();
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">{pick("SKU 단위 편차", "Where it breaks down")}</h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {pick(
            "합산 오차는 포트폴리오 전체에 대한 진술이며 개별 SKU를 보장하지 않습니다. 아래는 그 평균이 가장 크게 갈리는 지점입니다.",
            `The pooled figure is a statement about the portfolio, not a promise about any SKU. These are the rows where it diverges most from ${baseline}.`,
          )}
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <OutlierTable
          rows={worst}
          tone="bad"
          title={pick("모델이 더 나쁜 SKU", "Model does worse")}
          note={pick(
            "재고 판단에 직접 영향을 주므로 먼저 확인할 대상입니다.",
            "The list to read first: these are where trusting the model costs more than trusting the sheet.",
          )}
        />
        <OutlierTable
          rows={best}
          tone="good"
          title={pick("모델이 더 나은 SKU", "Model does better")}
          note={pick(
            "기존 방식 대비 개선폭이 가장 큰 SKU입니다.",
            "The largest improvements over the spreadsheet method.",
          )}
        />
      </div>
    </section>
  );
}
