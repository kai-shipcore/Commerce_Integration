"use client";

/**
 * Code Guide:
 * SKU detail — everything about one SKU on the action list.
 *
 * Answers three questions: how much to order and why that number, whether the
 * forecast is reliable for this particular SKU, and what the demand has actually
 * been doing. The order quantity and its reliability sit side by side above the
 * fold, because a user arrives here having already seen the recommended number
 * and needs both how it was derived and whether to trust it. Charts are
 * supporting evidence and sit below.
 *
 * The runs-high callout is placed above the order card deliberately: it is a
 * caveat about the number in that card, so it has to be read before it.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { OrderCard } from "./order-card";
import { ReliabilityCard } from "./reliability-card";
import { BacktestChart, DemandChart } from "./sku-charts";
import {
  DEFAULT_PLANNING_PARAMS,
  planningQuery,
  type ActionListParams,
  type SkuDetailResponse,
} from "./types";

const nf = new Intl.NumberFormat("en-US");

function Stat({ label, value, urgent }: { label: string; value: string; urgent?: boolean }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className={`text-base font-semibold tabular-nums ${urgent ? "text-red-600 dark:text-red-400" : ""}`}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

export function SkuDetailContent({
  sku,
  planning = DEFAULT_PLANNING_PARAMS,
}: {
  sku: string;
  planning?: ActionListParams;
}) {
  const { pick } = useI18n();
  const router = useRouter();
  const query = planningQuery(planning);
  // The request key includes the parameters, so arriving at the same SKU under
  // a different lead time refetches rather than showing the previous answer.
  const requestKey = `${sku}?${query}`;
  const [state, setState] = useState<{
    key: string;
    data: SkuDetailResponse | null;
    error: string | null;
    status: number | null;
  }>({ key: "", data: null, error: null, status: null });

  useEffect(() => {
    const controller = new AbortController();
    fetch(apiPath(`/api/planning/sku/${encodeURIComponent(sku)}?${query}`), {
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) {
          const err = new Error(body?.detail || body?.error || `HTTP ${res.status}`);
          (err as Error & { status?: number }).status = res.status;
          throw err;
        }
        return body as SkuDetailResponse;
      })
      .then((body) => setState({ key: requestKey, data: body, error: null, status: 200 }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          key: requestKey,
          data: null,
          error: err instanceof Error ? err.message : String(err),
          status: (err as Error & { status?: number })?.status ?? null,
        });
      });
    return () => controller.abort();
  }, [sku, query, requestKey]);

  const loading = state.key !== requestKey;
  const d = state.data;

  // Carries the parameters back, so returning to the list does not silently
  // reset the lead time the user chose.
  const backLink = (
    <Link
      href={`/planning/action-list?${query}`}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-3 w-3" />
      {pick("발주 목록으로", "Back to Action List")}
    </Link>
  );

  const runsHigh = useMemo(() => {
    if (!d?.row?.forecast_runs_high) return null;
    const r = d.row;
    const wa4 = r.wa4 ?? 0;
    const perWeek = r.forecast_per_week ?? 0;
    const excess = r.forecast_excess ?? 0;
    const weeks = d.forecast.length || 13;
    const falling = r.demand_state === "falling" || r.demand_state === "collapsing";

    const lead =
      wa4 <= 0
        ? pick(
            `최근 4주간 판매가 없었으나 모델은 향후 ${weeks}주에 ${nf.format(Math.round(r.forecast_total))}개를 예측합니다.`,
            `Nothing has sold in the last 4 weeks, and the model forecasts ${nf.format(Math.round(r.forecast_total))} units over the next ${weeks}.`,
          )
        : pick(
            `예측이 최근 판매 속도의 ${(r.forecast_over_recent ?? 0).toFixed(1)}배입니다. 최근 4주 평균 주당 ${wa4.toFixed(1)}개에 비해 모델은 주당 ${perWeek.toFixed(1)}개, ${weeks}주 동안 ${nf.format(Math.round(excess))}개를 더 예측합니다.`,
            `The forecast is ${(r.forecast_over_recent ?? 0).toFixed(1)}× the recent selling rate. The last 4 weeks averaged ${wa4.toFixed(1)} units a week; the model forecasts ${perWeek.toFixed(1)} a week, ${nf.format(Math.round(excess))} units more across ${weeks} weeks than the recent rate implies.`,
          );

    const evidence = falling
      ? pick(
          " 수요도 감소 추세이며, 개발 구간에서 모델은 이 패턴을 약 3배 과대 예측했고 단순 4주 평균이 더 정확했습니다.",
          ` Demand is also ${d.row.demand_state}, and on the development windows the model over-forecast that pattern by roughly three times, with a plain 4-week average beating it.`,
        )
      : "";

    return (
      <div className="rounded-md border border-amber-300/60 bg-amber-50/60 p-3 text-[11.5px] leading-relaxed dark:border-amber-800/60 dark:bg-amber-950/30">
        <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        <strong>{lead}</strong>
        {evidence}
        {pick(
          " 아래 권장 수량은 여전히 모델 값을 사용합니다. 최근 판매 속도로 대체하는 방안은 검증했으나 채택 기준에 미치지 못해, 차이를 감추지 않고 그대로 보여줍니다.",
          " The recommended quantity below still uses the model: substituting the recent rate was tested and did not meet the bar to be adopted, so the disagreement is shown rather than resolved.",
        )}
      </div>
    );
  }, [d, pick]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {pick("불러오는 중…", "Loading…")}
        </div>
      </div>
    );
  }

  if (state.error) {
    // A 404 here is meaningful and gets its own wording: the upstream
    // distinguishes a SKU that is no longer forecastable from one that does not
    // exist, and the first is a normal outcome rather than a failure.
    const notForecastable = state.status === 404 && state.error.includes("intermittent");
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <Card>
          <CardContent className="p-6 text-sm">
            <p className="font-medium">
              {notForecastable
                ? pick("이 SKU는 현재 예측 대상이 아닙니다.", "This SKU is not currently forecastable.")
                : pick("이 SKU를 불러올 수 없습니다.", "Could not load this SKU.")}
            </p>
            <p className="mt-1 text-muted-foreground">{state.error}</p>
            {notForecastable && (
              <p className="mt-3 text-xs text-muted-foreground">
                {pick(
                  "예측 실행 이후 판매가 불규칙해져 비정기로 재분류되었습니다. 다음 실행에서 예측 대상에서 제외됩니다.",
                  "Its sales became irregular enough after the forecast ran that segmentation reclassified it as intermittent. The next run will drop it from the forecast.",
                )}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!d) return null;

  const r = d.row;
  const days = r.days_to_stockout;
  const stockoutLabel =
    days === null || !Number.isFinite(days)
      ? "—"
      : r.estimated_stockout_date ?? `${Math.round(days)}d`;

  return (
    <div className="flex flex-col gap-4">
      {backLink}

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="font-mono text-lg font-semibold">{r.unique_id}</h1>
          <p className="text-xs text-muted-foreground">
            {[r.product_category, r.history_group, r.product_name].filter(Boolean).join(" · ")}
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {pick("학습 기준", "Trained through")} {d.forecast[0]?.ds ? d.forecast[0].ds : "—"}
        </span>
      </div>

      {/* Move between SKUs without returning to the list. The order is the
          list's own, so stepping through walks the same worklist sequence. */}
      {d.skus.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={d.position <= 0}
            onClick={() => router.push(`/planning/action-list/${encodeURIComponent(d.skus[d.position - 1])}?${query}`)}
            className="rounded-md border px-2 py-1 text-xs hover:bg-muted/60 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            ‹ {pick("이전", "Prev")}
          </button>
          <select
            value={r.unique_id}
            onChange={(e) => router.push(`/planning/action-list/${encodeURIComponent(e.target.value)}?${query}`)}
            className="h-8 max-w-[22rem] flex-1 rounded-md border bg-background px-2 font-mono text-xs"
          >
            {d.skus.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button
            type="button"
            disabled={d.position < 0 || d.position >= d.skus.length - 1}
            onClick={() => router.push(`/planning/action-list/${encodeURIComponent(d.skus[d.position + 1])}?${query}`)}
            className="rounded-md border px-2 py-1 text-xs hover:bg-muted/60 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            {pick("다음", "Next")} ›
          </button>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {pick(
              `${nf.format(d.position + 1)} / ${nf.format(d.skus.length)}`,
              `${nf.format(d.position + 1)} of ${nf.format(d.skus.length)}`,
            )}
          </span>
        </div>
      )}

      {d.meta.inventory_is_sample && (
        <p className="rounded-md border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300">
          {pick(
            "재고 수치는 샘플 데이터입니다. 실제 재고가 아닙니다.",
            "Inventory figures on this page are SAMPLE data, not real stock positions.",
          )}
        </p>
      )}

      {d.flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {d.flags.map((f) => (
            <span
              key={f}
              className="rounded-full border border-amber-300/60 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-300"
            >
              {f}
            </span>
          ))}
        </div>
      )}

      {runsHigh}

      {/* Sits with the other caveats, above the order card. A gap is a service
          failure the data can already see, and the number in that card cannot
          fix it: with an eight-week lead time a purchase order placed today
          lands after a container already booked. */}
      {r.has_supply_gap && r.supply_gap_days !== null && (
        <div className="rounded-md border border-amber-300/60 bg-amber-50/60 p-3 text-[11.5px] leading-relaxed dark:border-amber-800/60 dark:bg-amber-950/30">
          <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          <strong>
            {pick(
              `재고가 입고보다 ${Math.round(r.supply_gap_days)}일 먼저 소진됩니다.`,
              `Stock runs out ${Math.round(r.supply_gap_days)} days before the next container lands.`,
            )}
          </strong>{" "}
          {pick(
            `현재 재고 기준 ${Math.round(r.days_to_stockout ?? 0)}일 후 소진되며, 확정 입고 ${nf.format(Math.round(r.confirmed_inbound))}개는 ${Math.round(r.days_to_inbound ?? 0)}일 후 도착합니다.`,
            `It runs dry in ${Math.round(r.days_to_stockout ?? 0)} days; the ${nf.format(Math.round(r.confirmed_inbound))} units already booked arrive in ${Math.round(r.days_to_inbound ?? 0)}.`,
          )}{" "}
          {r.gap_closable_by_order
            ? pick(
                "리드타임보다 늦게 도착하므로 지금 발주하면 이 공백을 메울 수 있습니다.",
                "That container lands later than the lead time, so ordering now could close the gap.",
              )
            : pick(
                "지금 발주해도 이미 예정된 컨테이너보다 늦게 도착하므로, 필요한 조치는 추가 발주가 아니라 입고를 앞당기거나 재고를 재배분하는 것입니다.",
                "A new order placed today would arrive later than the container already booked, so the action here is to expedite or reallocate rather than to buy more.",
              )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <OrderCard
          total={d.order.total}
          band={d.order.band}
          breakdown={d.order.breakdown}
          errorUsed={r.error_used ?? null}
          leadWeeks={d.params.lead_time_weeks}
          reviewWeeks={d.params.review_period_weeks}
        />
        <ReliabilityCard
          wape={r.wape}
          tier={r.tier}
          errorUsed={r.error_used}
          errorBasis={r.error_basis}
          windows={d.backtest.windows}
          orderQty={d.order.total}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label={pick("가용 재고", "available")} value={nf.format(Math.round(r.available_inventory))} />
        <Stat label={pick("선주문 잔량", "preorder backlog")} value={nf.format(Math.round(r.preorder_backlog))} />
        <Stat label={pick("입고 예정", "confirmed inbound")} value={r.confirmed_inbound ? nf.format(Math.round(r.confirmed_inbound)) : "—"} />
        <Stat
          label={pick("품절 예상", "stocks out")}
          value={stockoutLabel}
          urgent={days !== null && Number.isFinite(days) && days <= 14}
        />
        <Stat label={pick("30일 판매", "30-day sales")} value={nf.format(Math.round(r.recent_units))} />
        <Stat label={pick("일 평균", "avg per day")} value={r.avg_daily_sales.toFixed(1)} />
      </div>

      <section>
        <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {pick("주간 수요 · 실제와 예측", "Weekly demand · actual and forecast")}
        </h2>
        <div className="rounded-md border p-2">
          <DemandChart
            history={d.history}
            forecast={d.forecast}
            wa4={r.wa4 ?? null}
            showWa4={Boolean(r.forecast_runs_high)}
          />
        </div>
      </section>

      {/* The same figures as numbers. Collapsed: the chart answers the shape
          question, this answers the per-week planning one, which is asked less
          often. */}
      {d.forecast.length > 0 && (
        <details className="rounded-md border">
          <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-medium text-muted-foreground hover:text-foreground">
            {pick("주별 수치", "Weekly figures")}
          </summary>
          <div className="max-h-64 overflow-auto border-t">
            <table className="w-full border-collapse tabular-nums">
              <thead className="sticky top-0 bg-background">
                <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-1.5 text-left font-medium">{pick("주", "Week")}</th>
                  <th className="px-3 py-1.5 text-right font-medium">{pick("모델 예측", "Model forecast")}</th>
                  <th className="px-3 py-1.5 text-right font-medium">{pick("스프레드시트 (V1)", "Spreadsheet (V1)")}</th>
                </tr>
              </thead>
              <tbody>
                {d.forecast.map((f) => (
                  <tr key={f.ds} className="border-t">
                    <td className="px-3 py-1.5 text-[11px]">{f.ds}</td>
                    <td className="px-3 py-1.5 text-right text-[11px]">{f.yhat.toFixed(1)}</td>
                    {/* Null where V1 did not cover this SKU, which is normal and
                        shown as a dash rather than a zero. */}
                    <td className="px-3 py-1.5 text-right text-[11px] text-muted-foreground">
                      {f.v1_yhat === null ? "—" : f.v1_yhat.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-semibold">
                  <td className="px-3 py-1.5 text-[11px]">{pick("합계", "Total")}</td>
                  <td className="px-3 py-1.5 text-right text-[11px]">
                    {nf.format(Math.round(d.forecast.reduce((s, f) => s + f.yhat, 0)))}
                  </td>
                  <td className="px-3 py-1.5 text-right text-[11px] text-muted-foreground">
                    {d.forecast.some((f) => f.v1_yhat !== null)
                      ? nf.format(Math.round(d.forecast.reduce((s, f) => s + (f.v1_yhat ?? 0), 0)))
                      : "—"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </details>
      )}

      {d.backtest.windows.length > 0 && (
        <section>
          <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {pick(
              `예측 검증 · 백테스트 구간 ${d.backtest.windows.length}개`,
              `How the forecast was tested · ${d.backtest.windows.length} backtest window${d.backtest.windows.length === 1 ? "" : "s"}`,
            )}
          </h2>
          <div className="mb-2 flex flex-wrap gap-2">
            {d.backtest.windows.map((w) => {
              const miss = w.y_total ? (w.yhat_total - w.y_total) / w.y_total : null;
              return (
                <span
                  key={`${w.window}-${w.cutoff}`}
                  className="inline-flex items-baseline gap-2 rounded-md border bg-muted/40 px-2.5 py-1 text-[10.5px]"
                >
                  <strong>{w.window}</strong>
                  <span className="opacity-70">
                    {pick("예측", "predicted")} {nf.format(Math.round(w.yhat_total))} · {pick("실제", "actual")} {nf.format(Math.round(w.y_total))}
                  </span>
                  {miss !== null && (
                    <span className="rounded-full border px-1.5 font-semibold">
                      {miss > 0 ? "+" : ""}{Math.round(miss * 100)}%
                    </span>
                  )}
                </span>
              );
            })}
          </div>
          <div className="rounded-md border p-2">
            <BacktestChart history={d.history} windows={d.backtest.windows} weekly={d.backtest.weekly} />
          </div>
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
            {pick(
              "음영은 모델이 채점된 10주 구간입니다. 각 구간 왼쪽 끝의 점선은 학습 기준 시점으로, 그 왼쪽은 모델이 본 데이터, 구간 안쪽은 보지 못한 데이터입니다.",
              "Shaded blocks are the 10-week windows the model was scored on. The dashed line at the left edge of each is the cutoff: everything to its left is what the model had seen when it made that prediction, everything inside the block is what it had not.",
            )}
          </p>
        </section>
      )}
    </div>
  );
}
