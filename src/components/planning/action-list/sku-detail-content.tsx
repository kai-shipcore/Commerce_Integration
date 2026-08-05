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

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import {
  PlanningError,
  planningErrorFrom,
  type PlanningErrorBody,
} from "@/components/planning/planning-error";
import { OrderCard } from "./order-card";
import { PlanningControls } from "./planning-controls";
import { ReliabilityCard } from "./reliability-card";
import { PRIORITY_GLYPH, PRIORITY_STYLE } from "./action-list-table";
import { BacktestChart, DemandChart } from "./sku-charts";
import { SkuFinder } from "./sku-finder";
import { skuSequenceStore } from "./sku-sequence";
import {
  DEFAULT_PLANNING_PARAMS,
  planningQuery,
  type ActionListParams,
  type HistoryWeek,
  type SkuDetailResponse,
} from "./types";

const nf = new Intl.NumberFormat("en-US");

/** Round a column of forecasts to whole units without breaking its total.
 *
 *  Rounding each week independently and summing gives a column that does not
 *  add up to the total beneath it, off by a unit or three, which reads as a
 *  bug to anyone who checks. Rounding the raw sum instead keeps the total
 *  right and leaves the column not adding to it, which is the same problem
 *  seen from the other side.
 *
 *  Largest remainder resolves both: every week takes its floor, and the units
 *  left over go to the weeks with the largest discarded fractions. The result
 *  sums to the rounded total exactly, and matches the total shown on the
 *  Action List, which is computed from the same unrounded figures. No week
 *  moves by more than one unit.
 */
function roundKeepingTotal(values: number[]): number[] {
  const target = Math.round(values.reduce((s, v) => s + v, 0));
  const out = values.map((v) => Math.floor(v));
  // Non-negative and at most values.length, since flooring can only lose less
  // than one unit per entry and the target is the rounded sum.
  let short = target - out.reduce((s, v) => s + v, 0);
  const byFraction = values
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < byFraction.length && short > 0; k += 1, short -= 1) {
    out[byFraction[k].i] += 1;
  }
  return out;
}

function Stat({
  label,
  value,
  tone = "plain",
  numeric = true,
  hint,
  sub,
  caption,
}: {
  label: string;
  value: string;
  tone?: "plain" | "bad" | "good";
  /** Tabular figures align columns of numbers and do nothing for a word, where
   *  the fixed advance just looks loose. */
  numeric?: boolean;
  /** The rule behind a value that is a word rather than a quantity. The list
   *  states these in full beneath its table; this is for a reader who arrived
   *  here directly and has not seen that legend. */
  hint?: string;
  /** The measurement the value was derived from, shown beside it. A word like
   *  "rising" is a bucket, and printing the number it came from makes the tile
   *  explain itself instead of depending on a legend the reader may not have
   *  seen. */
  sub?: string;
  /** What the `sub` figure is, in a few words, rendered on the tile.
   *
   *  `hint` is a title attribute and so is hover-only, which is exactly the
   *  failure the planning controls were fixed for: the reader looking straight
   *  at "rising 1.11x" and wondering what 1.11 counts has no reason to hover a
   *  tile that looks like the five plain quantities beside it. A number printed
   *  next to a word needs to say what it measures where it is printed. */
  caption?: string;
}) {
  const colour =
    tone === "bad"
      ? "text-red-600 dark:text-red-400"
      : tone === "good"
        ? "text-emerald-600 dark:text-emerald-400"
        : "";
  return (
    <div className="rounded-md border px-3 py-2" title={hint}>
      <div className={`text-base font-semibold ${numeric ? "tabular-nums" : ""} ${colour}`}>
        {value}
        {sub && (
          <span className="ml-1.5 text-[12.5px] font-normal tabular-nums text-muted-foreground">
            {sub}
          </span>
        )}
      </div>
      <div className="text-[11.5px] uppercase tracking-wide text-muted-foreground">{label}</div>
      {caption && (
        <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">{caption}</div>
      )}
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
  // Local, seeded from the URL. The controls live here as well as on the list,
  // because a purchaser deciding on one SKU is exactly who wants to ask what a
  // longer lead time or a higher service level would do to this quantity, and
  // sending them back to the list to find out loses the SKU they were on.
  const [planningState, setPlanningState] = useState<ActionListParams>(planning);
  const query = planningQuery(planningState);
  // The request key includes the parameters, so arriving at the same SKU under
  // a different lead time refetches rather than showing the previous answer.
  // Bumped to refetch without changing the SKU or the parameters, for the retry
  // button. Matches the action list, which is also what the error card here now
  // comes from: a forecast-server outage on this page used to render the raw
  // upstream string, while the same outage one click away named the failure and
  // offered a way out.
  const [reloadNonce, setReloadNonce] = useState(0);
  const requestKey = `${sku}?${query}|${reloadNonce}`;
  const [state, setState] = useState<{
    key: string;
    data: SkuDetailResponse | null;
    error: PlanningErrorBody | null;
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
          // The whole body travels, not just a message. The proxy classifies the
          // failure and names missing files, and flattening that to a string is
          // what produced a card reading "Internal Server Error".
          const err = planningErrorFrom(body, `HTTP ${res.status}`) as PlanningErrorBody & {
            status?: number;
          };
          err.status = res.status;
          throw err;
        }
        return body as SkuDetailResponse;
      })
      .then((body) => setState({ key: requestKey, data: body, error: null, status: 200 }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const status = (err as { status?: number })?.status ?? null;
        setState({
          key: requestKey,
          data: null,
          error: planningErrorFrom(err, err instanceof Error ? err.message : String(err)),
          status,
        });
      });
    return () => controller.abort();
  }, [sku, query, requestKey]);

  const loading = state.key !== requestKey;
  const d = state.data;

  // Sales history for a SKU the planning table has no row for.
  //
  // Asked for on any 404 rather than decided from the error text. A SKU can be
  // missing from that table for three reasons and only one of them is a real
  // failure, and matching on the wording was both fragile and wrong: rows on the
  // non-forecast list were never in the forecast run, so they came back as
  // "Unknown SKU" and were reported as an error. Whether sales history exists is
  // the question that actually separates the cases, so it is the one asked.
  //
  // "pending" while in flight, so a genuinely unknown SKU is not briefly shown
  // as a forecastable one waiting for a chart.
  const [hist, setHist] = useState<
    { key: string; rows: HistoryWeek[] | null } | null
  >(null);
  const missing = state.status === 404;

  useEffect(() => {
    // No reset on the way out. The result carries the SKU it belongs to and
    // every reader compares against it, so a stale entry is already ignored;
    // clearing it here would be a synchronous setState in an effect, which is
    // the cascading-render pattern the action list avoids for the same reason.
    if (!missing) return;
    const controller = new AbortController();
    fetch(apiPath(`/api/planning/sku/${encodeURIComponent(sku)}/history`), {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        setHist({ key: sku, rows: (body?.history as HistoryWeek[] | undefined) ?? null });
      })
      .catch(() => {
        if (!controller.signal.aborted) setHist({ key: sku, rows: null });
      });
    return () => controller.abort();
  }, [missing, sku]);

  // A SKU with no planning row but with sales history is not forecast, which is
  // a normal outcome. One with neither does not exist here, which is an error.
  const notForecastable = missing && hist?.key === sku && (hist.rows?.length ?? 0) > 0;
  const resolvingMissing = missing && hist?.key !== sku;

  // The sequence the user is stepping through: the list's own filtered and
  // sorted view where it was handed over, the server's worklist order otherwise.
  const stored = useSyncExternalStore(
    skuSequenceStore.subscribe,
    skuSequenceStore.snapshot,
    skuSequenceStore.serverSnapshot,
  );
  const sequence = useMemo(() => {
    const full = d?.skus ?? [];
    // Only honoured when it contains this SKU. Arriving from a shared link, a
    // new tab, or after the list has moved on leaves a sequence this SKU is not
    // part of, and stepping through someone else's subset would be worse than
    // stepping through the default one.
    if (!stored || !stored.includes(sku)) return full;
    // Intersected with what the server still serves, so a SKU demoted since the
    // list was rendered does not become a dead entry in the selector.
    const served = new Set(full);
    const kept = stored.filter((s) => served.has(s));
    return kept.length > 0 ? kept : full;
  }, [stored, sku, d?.skus]);
  const position = sequence.indexOf(sku);
  const filtered = Boolean(d && sequence.length !== d.skus.length);

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
      <div className="rounded-md border border-amber-300/60 bg-amber-50/60 p-3 text-[12.5px] leading-relaxed dark:border-amber-800/60 dark:bg-amber-950/30">
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
    // Held until the history lookup answers, because that lookup is what decides
    // whether this is a normal outcome or a failure. Rendering the error card
    // first and replacing it a moment later would flash a failure at every
    // intermittent SKU.
    if (resolvingMissing) {
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
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        {/* A SKU with sales history but no planning row is not forecast, which is
            a normal outcome with its own explanation. Everything else is a
            failure and goes through the shared component, which names which
            failure it is and offers a retry, exactly as the action list does. */}
        {notForecastable ? (
          <Card>
            <CardContent className="p-6 text-sm">
              <p className="font-medium">
                {pick("이 SKU는 예측 대상이 아닙니다.", "This SKU is not forecast.")}
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                {pick(
                  "판매가 불규칙해 주간 예측을 만들지 않습니다. 발주 권장 수량, 품절 예상일, 신뢰도는 예측 없이는 산출할 수 없어 표시하지 않습니다. 아래는 실제 판매 실적입니다.",
                  "Its sales are too irregular to forecast weekly. There is no recommended order quantity, stockout date or reliability figure because none of them can be derived without a forecast. Its actual sales are below.",
                )}
              </p>
            </CardContent>
          </Card>
        ) : (
          <PlanningError body={state.error} onRetry={() => setReloadNonce((n) => n + 1)} />
        )}

        {/* Actual sales only. There is deliberately no forecast line, no band
            and no reliability figure: none of them exist for this SKU, and
            drawing an empty axis where a forecast belongs would suggest one is
            merely missing rather than not applicable. */}
        {notForecastable && hist?.rows && (
          <section>
            <h2 className="mb-1 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              {pick("주간 판매 실적", "Weekly sales history")}
            </h2>
            <div className="rounded-md border p-2">
              <DemandChart history={hist.rows} forecast={[]} wa4={null} showWa4={false} />
            </div>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
              {pick(
                `최근 ${hist.rows.length}주 실판매입니다. 예측선이 없는 것은 누락이 아니라, 판매가 불규칙해 주간 예측을 만들지 않기 때문입니다.`,
                `${hist.rows.length} weeks of actual sales. There is no forecast line because this SKU sells too irregularly to forecast weekly, not because one is missing.`,
              )}
            </p>
          </section>
        )}
      </div>
    );
  }

  if (!d) return null;

  const r = d.row;

  // Whole units for the weekly table. A tenth of a seat cover is not a
  // quantity anyone can order, and the decimal implied a precision the model
  // does not have. Rounded as a column rather than cell by cell so the figures
  // still add to the total under them.
  const yhatWhole = roundKeepingTotal(d.forecast.map((f) => f.yhat));
  // V1 does not cover every week of every SKU. Only the covered weeks are
  // rounded together, so the gaps neither absorb leftover units nor print a
  // zero where the method simply said nothing.
  const v1Index = d.forecast.flatMap((f, i) => (f.v1_yhat === null ? [] : [i]));
  const v1Rounded = roundKeepingTotal(v1Index.map((i) => d.forecast[i].v1_yhat as number));
  const v1Whole = new Map(v1Index.map((i, k) => [i, v1Rounded[k]]));

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
          {/* Matches the list's subtitle. The history group is deliberately not
              here: a purchaser acts on the measured reliability below, not on
              how many weeks of history produced it, and the same reasoning keeps
              which of the hybrid's two models served this SKU off the page. */}
          <p className="text-xs text-muted-foreground">
            {[r.product_category, r.product_name].filter(Boolean).join(" · ")}
          </p>
          {/* Why this SKU is on the list at all. The row carried it, the list
              shows it, and arriving here from a filtered worklist without it
              meant the reason for being here was the one thing left behind. */}
          <span
            className={`mt-1.5 inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] ${
              PRIORITY_STYLE[r.priority_label] ?? PRIORITY_STYLE.Routine
            }`}
          >
            {PRIORITY_GLYPH[r.priority_label] ?? "○"} {r.priority_label}
          </span>
        </div>
        {/* The training cutoff, from meta, not the first week of the horizon.
            Those differ by exactly one week, so reading it off the forecast
            made this page and the list disagree about how old the number is,
            in the one place a purchaser looks to decide whether it is stale. */}
        <span className="text-[12.5px] text-muted-foreground">
          {pick("학습 기준", "Trained through")} {d.meta.trained_through ?? "—"}
        </span>
      </div>

      {/* Move between SKUs without returning to the list, through the sequence
          the list was showing: its filter, its sort, its order. The selector
          lists the same subset rather than all 432, which is what made it
          unusable when it held every forecastable SKU with no search. */}
      {sequence.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={position <= 0}
            onClick={() => router.push(`/planning/action-list/${encodeURIComponent(sequence[position - 1])}?${query}`)}
            className="rounded-md border px-2 py-1 text-xs hover:bg-muted/60 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            ‹ {pick("이전", "Prev")}
          </button>
          {/* Searches every forecastable SKU, not only the filtered sequence
              the arrows step through. Reaching a SKU you could already name
              used to mean going back to the list and clearing filters first. */}
          <div className="min-w-0 max-w-[26rem] flex-1">
            <SkuFinder
              current={r.unique_id}
              sequence={sequence}
              all={d.skus}
              onSelect={(s) =>
                router.push(`/planning/action-list/${encodeURIComponent(s)}?${query}`)
              }
            />
          </div>
          <button
            type="button"
            disabled={position < 0 || position >= sequence.length - 1}
            onClick={() => router.push(`/planning/action-list/${encodeURIComponent(sequence[position + 1])}?${query}`)}
            className="rounded-md border px-2 py-1 text-xs hover:bg-muted/60 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            {pick("다음", "Next")} ›
          </button>
          {/* Only says the list is filtered. The position itself now sits inside
              the finder, against the sequence it counts. "3 of 128" beside a
              run of 432 would otherwise leave a reader unsure whether the page
              had lost rows. */}
          {filtered && (
            <span className="text-[12.5px] text-muted-foreground">
              {pick("· 필터 적용된 목록", "· in your filtered list")}
            </span>
          )}
        </div>
      )}

      {/* Same component the list uses, so the two screens cannot explain these
          differently or drift apart on defaults. */}
      <PlanningControls params={planningState} onChange={setPlanningState} busy={loading} />

      {d.meta.inventory_is_sample && (
        <p className="rounded-md border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-[12.5px] text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300">
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
              className="rounded-full border border-amber-300/60 bg-amber-50 px-2 py-0.5 text-[11.5px] text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-300"
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
        <div className="rounded-md border border-amber-300/60 bg-amber-50/60 p-3 text-[12.5px] leading-relaxed dark:border-amber-800/60 dark:bg-amber-950/30">
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

      {/* Above the order card with the other caveats, for the same reason they
          are: it qualifies the number in that card and has to be read before
          it. A purchaser arriving from the list has already seen the
          recommendation and may be about to act on it, and this is the one
          thing on the page that can say the action is already taken. */}
      {r.draft_inbound > 0 && (
        <div className="rounded-md border border-sky-300/60 bg-sky-50/60 p-3 text-[12.5px] leading-relaxed dark:border-sky-800/60 dark:bg-sky-950/30">
          <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
          <strong>
            {pick(
              `이 SKU는 이미 초안 컨테이너에 ${nf.format(Math.round(r.draft_inbound))}개가 잡혀 있습니다.`,
              `${nf.format(Math.round(r.draft_inbound))} units of this SKU are already on a draft container.`,
            )}
          </strong>{" "}
          {r.draft_eta
            ? pick(`예정 도착 ${r.draft_eta}. `, `Currently dated ${r.draft_eta}. `)
            : pick("도착일은 아직 정해지지 않았습니다. ", "No arrival date has been set yet. ")}
          {/* States the fact and stops. The order card below does the
              subtraction and shows what the requirement becomes, so repeating
              the figure here would put the same number on screen twice with
              nothing to say which to act on. */}
          {pick(
            "초안은 확정 발주가 아니므로 아래 권장 수량에서 차감하지 않았습니다.",
            "A draft is not a committed order, so it is not subtracted from the recommendation below.",
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <OrderCard
          total={d.order.total}
          breakdown={d.order.breakdown}
          leadWeeks={d.params.lead_time_weeks}
          reviewWeeks={d.params.review_period_weeks}
          draftInbound={Math.round(r.draft_inbound)}
        />
        <ReliabilityCard
          wape={r.wape}
          tier={r.tier}
          errorUsed={r.error_used}
          errorBasis={r.error_basis}
          windows={d.backtest.windows}
          orderQty={d.order.total}
          comparison={d.comparison}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label={pick("가용 재고", "available")} value={nf.format(Math.round(r.available_inventory))} />
        <Stat label={pick("선주문 잔량", "preorder backlog")} value={nf.format(Math.round(r.preorder_backlog))} />
        <Stat label={pick("입고 예정", "confirmed inbound")} value={r.confirmed_inbound ? nf.format(Math.round(r.confirmed_inbound)) : "—"} />
        <Stat
          label={pick("품절 예상", "stocks out")}
          value={stockoutLabel}
          tone={days !== null && Number.isFinite(days) && days <= 14 ? "bad" : "plain"}
        />
        {/* Four weeks, and labelled as four weeks. It was "30-day sales" over a
            28-day window. A true 30 days is not available: the weekly series is
            W-MON so 30 days falls inside a bucket, and the daily order lines are
            a cache that runs several days behind it, so a figure taken from
            there would not reconcile with the chart below. */}
        <Stat label={pick("4주 판매", "4-week sales")} value={nf.format(Math.round(r.recent_units))} />
        {/* Replaces "avg per day", which was this figure divided by 28 and so
            carried nothing the tile beside it did not. Demand state is computed
            already and appears nowhere else on the page except inside the
            runs-high callout, which most SKUs do not show. Whether a SKU is
            growing or dying changes how every other number here reads. */}
        <Stat
          label={pick("수요 추세", "demand trend")}
          numeric={false}
          // The ratio itself, beside the word. "rising" is a bucket boundary and
          // means nothing alone; "rising 1.31×" is the measurement, and a reader
          // can judge 1.12 differently from 1.80 even though both are "rising".
          sub={
            r.ramp !== null && Number.isFinite(r.ramp)
              ? `${r.ramp.toFixed(2)}×`
              : undefined
          }
          // What the ratio divides, on the tile. The bands it maps onto are the
          // line under the grid, because they are the same four for every SKU
          // and repeating them in a tile this size would crowd out the figure.
          caption={
            r.ramp !== null && Number.isFinite(r.ramp)
              ? pick("최근 4주 ÷ 최근 12주 (계절성 제거)", "last 4 weeks ÷ last 12, deseasonalised")
              : undefined
          }
          hint={pick(
            "최근 4주 판매를 최근 12주 평균과 비교 (계절성 제거). 1.25배 초과 상승, 0.80–1.25배 보합, 0.40–0.80배 하락, 0.40배 미만 급감. 비율이므로 0.80과 1.25가 1.0에서 같은 거리입니다.",
            "Last 4 weeks against the last 12, seasonally adjusted. Above 1.25× rising, 0.80–1.25× steady, 0.40–0.80× falling, under 0.40× collapsing. It is a ratio, so 0.80 and 1.25 are the same distance from 1.0.",
          )}
          value={
            {
              rising: pick("상승", "rising"),
              steady: pick("보합", "steady"),
              falling: pick("하락", "falling"),
              collapsing: pick("급감", "collapsing"),
            }[r.demand_state] ?? pick("알 수 없음", "unknown")
          }
          tone={
            r.demand_state === "collapsing" || r.demand_state === "falling"
              ? "bad"
              : r.demand_state === "rising"
                ? "good"
                : "plain"
          }
        />
      </div>

      {/* The bands the trend word comes from, stated rather than left on hover.
          The list page prints this legend under its table; a reader who opened
          a SKU from a link has never seen that page. Being a ratio matters and
          is easy to misread: 0.80 and 1.25 are the same distance from 1.0, so
          the steady band is symmetric even though its endpoints do not look
          it. */}
      {r.ramp !== null && Number.isFinite(r.ramp) && (
        <p className="-mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
          {pick(
            "수요 추세: 1.25배 초과 상승 · 0.80–1.25배 보합 · 0.40–0.80배 하락 · 0.40배 미만 급감. 비율이므로 0.80과 1.25는 1.0에서 같은 거리입니다. 모델이 학습에 쓰는 것과 동일한 지표입니다.",
            "Demand trend: above 1.25× rising · 0.80–1.25× steady · 0.40–0.80× falling · under 0.40× collapsing. It is a ratio, so 0.80 and 1.25 sit the same distance from 1.0. This is the model's own feature, not a separate calculation for the dashboard.",
          )}
        </p>
      )}

      <section>
        <h2 className="mb-1 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          {pick("주간 수요 · 실제와 예측", "Weekly demand · actual and forecast")}
        </h2>
        {/* Trimmed to the requested window. `history` arrives longer whenever a
            backtest window reaches further back than 26 weeks, because the
            backtest chart below draws over that span and both charts read the
            same array. Without this the demand chart would silently lengthen
            for SKUs with old backtest windows and not for others. */}
        <div className="rounded-md border p-2">
          <DemandChart
            history={d.history.slice(-d.meta.history_weeks)}
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
          <summary className="cursor-pointer select-none px-3 py-2 text-[12.5px] font-medium text-muted-foreground hover:text-foreground">
            {pick("주별 수치", "Weekly figures")}
          </summary>
          <div className="max-h-64 overflow-auto border-t">
            <table className="w-full border-collapse tabular-nums">
              <thead className="sticky top-0 bg-background">
                <tr className="text-[11.5px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-1.5 text-left font-medium">{pick("주", "Week")}</th>
                  <th className="px-3 py-1.5 text-right font-medium">{pick("모델 예측", "Model forecast")}</th>
                  <th className="px-3 py-1.5 text-right font-medium">{pick("스프레드시트 (V1)", "Spreadsheet (V1)")}</th>
                </tr>
              </thead>
              <tbody>
                {d.forecast.map((f, i) => (
                  <tr key={f.ds} className="border-t">
                    <td className="px-3 py-1.5 text-[12.5px]">{f.ds}</td>
                    <td className="px-3 py-1.5 text-right text-[12.5px]">
                      {nf.format(yhatWhole[i])}
                    </td>
                    {/* Null where V1 did not cover this SKU, which is normal and
                        shown as a dash rather than a zero. */}
                    <td className="px-3 py-1.5 text-right text-[12.5px] text-muted-foreground">
                      {v1Whole.has(i) ? nf.format(v1Whole.get(i) as number) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-semibold">
                  <td className="px-3 py-1.5 text-[12.5px]">{pick("합계", "Total")}</td>
                  <td className="px-3 py-1.5 text-right text-[12.5px]">
                    {nf.format(Math.round(d.forecast.reduce((s, f) => s + f.yhat, 0)))}
                  </td>
                  <td className="px-3 py-1.5 text-right text-[12.5px] text-muted-foreground">
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

      {/* Collapsed, matching the weekly figures table above it and for a
          stronger version of the same reason. This answers "how was this
          tested", which a purchaser asks rarely and a modeller asks elsewhere.
          Nothing is hidden that is not also stated: the reliability card beside
          the order quantity already lists these windows with predicted, actual
          and miss, so what closes here is the shape of those numbers over time,
          not the numbers. It is also absent entirely for the 174 SKUs with no
          backtest history, so the page already had two heights. */}
      {d.backtest.windows.length > 0 && (
        <details className="rounded-md border">
          <summary className="cursor-pointer select-none px-3 py-2 text-[12.5px] font-medium text-muted-foreground hover:text-foreground">
            {pick(
              `예측 검증 · 백테스트 구간 ${d.backtest.windows.length}개`,
              `How the forecast was tested · ${d.backtest.windows.length} backtest window${d.backtest.windows.length === 1 ? "" : "s"}`,
            )}
          </summary>
          <div className="border-t p-3">
          <div className="mb-2 flex flex-wrap gap-2">
            {d.backtest.windows.map((w) => {
              const miss = w.y_total ? (w.yhat_total - w.y_total) / w.y_total : null;
              return (
                <span
                  key={`${w.window}-${w.cutoff}`}
                  className="inline-flex items-baseline gap-2 rounded-md border bg-muted/40 px-2.5 py-1 text-[11.5px]"
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
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
            {pick(
              "음영은 모델이 채점된 10주 구간입니다. 각 구간 왼쪽 끝의 점선은 학습 기준 시점으로, 그 왼쪽은 모델이 본 데이터, 구간 안쪽은 보지 못한 데이터입니다.",
              "Shaded blocks are the 10-week windows the model was scored on. The dashed line at the left edge of each is the cutoff: everything to its left is what the model had seen when it made that prediction, everything inside the block is what it had not.",
            )}
          </p>
          </div>
        </details>
      )}
    </div>
  );
}
