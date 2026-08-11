"use client";

/**
 * Code Guide:
 * Action list page body — fetches /api/planning/action-list and renders the
 * summary counts, the planning controls, the filters and the table.
 *
 * The summary counts double as the primary filter rather than sitting on a
 * separate overview screen. A figure you can click is a way into the work; a
 * figure you can only read is a screen you look at and then navigate away from.
 *
 * Planning parameters are sent to the server rather than applied here. The
 * recommended quantity, safety stock and coverage demand all move with them, and
 * recomputing that arithmetic in TypeScript would put a second implementation
 * of the order formula next to the Python one with nothing to say which is
 * right.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ModelCard } from "@/components/planning/model-card";
import { useRouter } from "next/navigation";
import { AlertTriangle, Download, Loader2, RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import {
  ACCESSORS, ActionListTable, ALL_COLUMNS, DEFAULT_SORT, FORMATTERS, OPTIONAL_COLUMNS, PRIORITY, PRIORITY_GLYPH, PRIORITY_STYLE,
  describeSort, sortRows,
  type SortCriterion, type SortDir, type SortKey,
} from "./action-list-table";
import { ColumnPicker } from "@/components/planning/column-picker";
import { applyColumnFilters, distinctColumnValuesExcluding, type ColumnFilter } from "@/lib/planning/column-filter";
import { downloadCsv, ACTION_LIST_COLUMNS } from "./csv-export";
import { ForecastServerStatus } from "@/components/planning/forecast-server-status";
import {
  PlanningError,
  planningErrorFrom,
  type PlanningErrorBody,
} from "@/components/planning/planning-error";
import { NotForecastSection } from "./not-forecast-section";
import { PlanningControls } from "./planning-controls";
import { PortfolioChart } from "./portfolio-chart";
import { RunForecast } from "./run-forecast";
import { rememberSkuSequence } from "./sku-sequence";
import {
  DEFAULT_PLANNING_PARAMS,
  planningQuery,
  type ActionListParams,
  type ActionListResponse,
  type ActionListRow,
} from "./types";

const nf = new Intl.NumberFormat("en-US");

type Focus =
  | "all" | "preorder" | "no-stock" | "best-seller"
  | "out-soon" | "supply-gap" | "drafted" | "routine";

/** Sentinel for "any data-quality warning", as distinct from one named warning.
 *  A sentinel rather than a second piece of state, because the two are mutually
 *  exclusive and holding them apart would allow a combination that means
 *  nothing. Not a string a warning label could collide with. */
const ANY_FLAG = "__any__";

/** Where the chosen columns are remembered. Namespaced by screen, so the SKU
 *  detail page or a future table cannot collide with it. */
const COLUMNS_STORAGE_KEY = "planning:action-list:columns";

const BAND_LABEL: Record<"pos" | "dem" | "act", [string, string]> = {
  pos: ["재고 현황", "Position"],
  dem: ["수요", "Demand"],
  act: ["조치", "Action"],
};

export function ActionListContent({
  initialParams = DEFAULT_PLANNING_PARAMS,
}: {
  /** Seeded from the URL, so returning from a SKU detail view restores the
   *  lead time the user was working at rather than silently resetting it. */
  initialParams?: ActionListParams;
}) {
  const { pick } = useI18n();
  const router = useRouter();

  const [lead, setLead] = useState(initialParams.lead_time_weeks);
  const [review, setReview] = useState(initialParams.review_period_weeks);
  const [z, setZ] = useState(initialParams.service_z);
  const [horizon, setHorizon] = useState(initialParams.stockout_horizon_days);

  const [focus, setFocus] = useState<Focus>("all");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [tier, setTier] = useState("all");
  // Demand direction, given the same treatment as reliability: a filter here and
  // a legend under the table stating its thresholds. It reached the SKU detail
  // page first, where it was a single word with no definition and no way to
  // find the other SKUs in the same state. Safe to sit alongside the summary
  // cards rather than contradicting them, unlike the priority select below: it
  // filters `demand_state`, which no card touches.
  const [trend, setTrend] = useState("all");
  // No history-length filter. "short" and "long" describe how much training
  // data a SKU has, which is a fact about the model rather than about the
  // product, and a purchaser does nothing differently on that basis. The
  // operational consequence of thin history is already carried by the
  // Reliability column, which is measured rather than assumed.
  // No priority select either, and this one used to exist. It filtered on
  // `priority_label` while the summary cards filtered the same field
  // independently, so the two could be driven into combinations that return
  // nothing and explain nothing: "Preorder" on a card with "Best Seller" in the
  // select is empty by construction. It survived only because Routine had no
  // card of its own, so Routine has one now and the select is gone. That is the
  // same rule the flag filter above states for itself: two pieces of state that
  // can contradict each other should be one.
  // Data-quality selection. null is no filter, ANY_FLAG is every flagged row,
  // anything else is one warning by its label. Applied after the other filters
  // rather than alongside them, so the summary line can count warnings across
  // the rows the other filters left and still offer the ones not currently
  // selected. Folding it in with the rest would let the line describe only the
  // flag already chosen, which is the one view from which you cannot switch.
  const [flag, setFlag] = useState<string | null>(null);
  const [sort, setSort] = useState<SortCriterion[]>(DEFAULT_SORT);
  // Per-column checkbox filters from each header's right-click menu. Compose
  // with the filters above (AND) rather than sitting outside them, so a
  // column filter narrows the same population the summary counts, the
  // portfolio chart and CSV export describe.
  const [columnFilters, setColumnFilters] = useState<Map<SortKey, ColumnFilter>>(new Map());
  // Which column's Filter submenu is open right now, so its distinct-value
  // list can be computed from the full row set on demand rather than on
  // every render.
  const [openFilterKey, setOpenFilterKey] = useState<SortKey | null>(null);
  // Which optional columns are shown. Persisted, because it is a statement
  // about this reader's monitor and job rather than about the data, and asking
  // them to re-hide the same three columns every Monday is how a control like
  // this ends up unused.
  const [visible, setVisible] = useState<Set<SortKey>>(() => new Set(ALL_COLUMNS));
  // Which population is on screen. The non-forecast section fetches only once
  // opened, since it covers roughly seven times as many SKUs and most visits
  // never need it.
  const [section, setSection] = useState<"forecast" | "not-forecast">("forecast");
  const [pageSize, setPageSize] = useState<number | "all">(100);
  const [page, setPage] = useState<{ key: string; page: number }>({ key: "", page: 1 });

  // The planning parameters identify a response. Holding them alongside the
  // result lets `loading` be derived rather than set, which keeps the effect
  // free of the synchronous setState that causes cascading renders, and gives
  // the better behaviour for free: while a new lead time is in flight the
  // previous table stays on screen instead of blanking to a spinner.
  // Bumped to refetch without changing any parameter, for the retry button and
  // for the status indicator noticing the server came back.
  const [reloadNonce, setReloadNonce] = useState(0);
  const paramsKey = `${lead}|${review}|${z}|${horizon}|${reloadNonce}`;
  const [state, setState] = useState<{
    key: string;
    data: ActionListResponse | null;
    error: PlanningErrorBody | null;
  }>({ key: "", data: null, error: null });

  // Read after mount rather than in the initialiser: localStorage does not
  // exist while this renders on the server, and seeding state from it directly
  // produces markup that disagrees with the client's first paint.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLUMNS_STORAGE_KEY);
      if (!raw) return;
      const saved = (JSON.parse(raw) as string[]).filter((k) =>
        (ALL_COLUMNS as string[]).includes(k),
      ) as SortKey[];
      // An empty or unrecognisable list falls back to everything. A stored set
      // naming only columns that have since been renamed would otherwise render
      // a table with no columns and no way to recover from it.
      if (saved.length > 0) queueMicrotask(() => setVisible(new Set(saved)));
    } catch {
      // A corrupt or unavailable store is not worth reporting: the default is
      // every column, which is what this screen showed before the control.
    }
  }, []);

  const changeVisible = useCallback((next: Set<SortKey>) => {
    setVisible(next);
    try {
      window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      // Ignored for the same reason as above. Losing the preference is a smaller
      // problem than failing the interaction that set it.
    }
  }, []);

  // Hide column, from a header's own right-click menu. Same "cannot remove
  // the last one" guard ColumnPicker enforces, since both write to the same
  // `visible` set.
  const hideColumn = useCallback((key: SortKey) => {
    setVisible((prev) => {
      if (prev.size <= 1) return prev;
      const next = new Set(prev);
      next.delete(key);
      try {
        window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // See changeVisible above.
      }
      return next;
    });
  }, []);

  const onColumnFilterChange = useCallback((key: SortKey, next: ColumnFilter | null) => {
    setColumnFilters((prev) => {
      const m = new Map(prev);
      if (next === null) m.delete(key);
      else m.set(key, next);
      return m;
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const qs = new URLSearchParams({
      lead_time_weeks: String(lead),
      review_period_weeks: String(review),
      service_z: String(z),
      stockout_horizon_days: String(horizon),
    });
    fetch(apiPath(`/api/planning/action-list?${qs}`), { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json();
        // The whole body is carried through, not just a message. The proxy
        // classifies the failure and names missing files, and flattening that
        // to a string is what produced a card reading "Internal Server Error".
        if (!res.ok) throw planningErrorFrom(body, `HTTP ${res.status}`);
        return body as ActionListResponse;
      })
      .then((body) => setState({ key: paramsKey, data: body, error: null }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          key: paramsKey,
          data: null,
          error: planningErrorFrom(err, err instanceof Error ? err.message : String(err)),
        });
      });
    return () => controller.abort();
  }, [paramsKey, lead, review, z, horizon]);

  const data = state.data;
  const error = state.error;
  const loading = state.key !== paramsKey;

  const categories = useMemo(() => {
    if (!data) return [];
    return Array.from(
      new Set(data.rows.map((r) => r.product_category).filter(Boolean) as string[]),
    ).sort();
  }, [data]);

  // Every filter above the column headers, applied but not yet sorted. This is
  // the population a column's own Filter submenu computes its distinct values
  // against (minus that column's own filter — see columnValuesForOpenKey
  // below), so the checkbox list reflects what every OTHER active filter
  // already left rather than the full unfiltered table.
  const bespokeFilteredRows = useMemo<ActionListRow[]>(() => {
    if (!data) return [];
    let rows = data.rows;
    if (focus === "preorder") rows = rows.filter((r) => r.priority_label === PRIORITY.preorder);
    else if (focus === "no-stock") rows = rows.filter((r) => r.available_inventory <= 0);
    else if (focus === "best-seller") rows = rows.filter((r) => r.best_seller);
    else if (focus === "supply-gap") rows = rows.filter((r) => r.has_supply_gap);
    else if (focus === "drafted") rows = rows.filter((r) => r.draft_inbound > 0);
    else if (focus === "routine") rows = rows.filter((r) => r.priority_label === PRIORITY.routine);
    else if (focus === "out-soon") {
      rows = rows.filter(
        (r) => r.days_to_stockout !== null && r.days_to_stockout <= data.params.stockout_horizon_days,
      );
    }
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => r.unique_id.toLowerCase().includes(q));
    }
    if (category !== "all") rows = rows.filter((r) => r.product_category === category);
    if (tier !== "all") rows = rows.filter((r) => r.tier === tier);
    if (trend !== "all") rows = rows.filter((r) => r.demand_state === trend);
    return rows;
  }, [data, focus, query, category, tier, trend]);

  const scoped = useMemo<ActionListRow[]>(() => {
    const filtered = applyColumnFilters(bespokeFilteredRows, columnFilters, ACCESSORS);
    // Sorted last, and on a copy: the server returns the worklist order, which
    // is what no criteria means, so it must not be mutated on the way through.
    return sortRows(filtered, sort);
  }, [bespokeFilteredRows, columnFilters, sort]);

  const columnValuesForOpenKey = useMemo(() => {
    if (!openFilterKey) return [];
    return distinctColumnValuesExcluding(
      bespokeFilteredRows,
      columnFilters,
      ACCESSORS,
      FORMATTERS,
      openFilterKey,
      pick("(공백)", "(Blank)"),
    );
  }, [openFilterKey, bespokeFilteredRows, columnFilters, pick]);

  /** Warning counts over the rows the other filters left, so the summary line
   *  describes the same population the table would show if no warning were
   *  selected, and every warning stays reachable while one is active. */
  const quality = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of scoped) for (const f of r.flags) counts.set(f, (counts.get(f) ?? 0) + 1);
    return {
      byLabel: [...counts.entries()].sort((a, b) => b[1] - a[1]),
      flagged: scoped.filter((r) => r.flags.length > 0).length,
    };
  }, [scoped]);

  const view = useMemo<ActionListRow[]>(() => {
    if (flag === null) return scoped;
    if (flag === ANY_FLAG) return scoped.filter((r) => r.flags.length > 0);
    return scoped.filter((r) => r.flags.includes(flag));
  }, [scoped, flag]);

  // The page is tied to the filter set it was chosen under, so changing a filter
  // returns to page 1 without an effect resetting it. Narrowing the filters while
  // on page 5 would otherwise land on an empty page, which reads as "no results"
  // rather than "you are past the end".
  const filterKey = `${focus}|${query}|${category}|${tier}|${trend}|${flag ?? ""}|${pageSize}`;
  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(view.length / pageSize));
  const currentPage = page.key === filterKey ? Math.min(page.page, totalPages) : 1;
  const goToPage = (n: number) => setPage({ key: filterKey, page: n });
  const pageRows = useMemo(
    () =>
      pageSize === "all"
        ? view
        : view.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [view, pageSize, currentPage],
  );

  // Columns are named in csv-export.ts rather than derived from the row, so the
  // file matches what was on screen instead of the API's wire format. See the
  // module header for what is included and what is deliberately not.
  const exportCsv = useCallback(() => {
    downloadCsv(view, ACTION_LIST_COLUMNS, "action-list", pick);
  }, [view, pick]);

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {pick("불러오는 중…", "Loading…")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex justify-end">
          <ForecastServerStatus onRecovered={() => setReloadNonce((n) => n + 1)} />
        </div>
        <PlanningError body={error} onRetry={() => setReloadNonce((n) => n + 1)} />
      </div>
    );
  }

  if (!data) return null;

  const m = data.metrics;
  const viewUnits = view.reduce((s, r) => s + r.recommended_order_qty, 0);
  const narrowed = view.length !== data.rows.length;

  // The seven conditions, and now the only way to filter on priority: three of
  // them are priority labels, the rest are situations that cut across them.
  // "All" is rendered ahead of the group rather than being one of it: it carries
  // the same total, but selecting it widens the view instead of narrowing it,
  // and giving it an identical box made a reset look like another statistic.
  // Separated by a rule, it reads as the neutral position of the group, which is
  // what it is.
  const filters: { key: Focus; label: string; value: number }[] = [
    { key: "preorder", label: pick("선주문", "preorder"), value: m.preorder_priority },
    // "no stock on hand" rather than "out of stock", because "No Stock" is also
    // a priority label shown on the row badges, and the two are not the same
    // set. This is the raw condition, available_inventory <= 0; the label is a
    // queue assigned by precedence, so a SKU with no stock AND preorder backlog
    // is badged Preorder and is in this count but not that one. Two controls
    // with near-identical names and different answers is what the priority
    // select used to be, and the name is the half of it that survives.
    { key: "no-stock", label: pick("보유 재고 없음", "no stock on hand"), value: m.out_of_stock },
    // An attribute filter sitting in a row of supply-state filters, and that is
    // now a deliberate difference rather than a muddle. Before item 14 this
    // counted the `Best Seller` label -- the top sellers that nothing outranked,
    // 35 of 89 -- so the card silently excluded every top seller that happened
    // to be on preorder or out of stock. It counts all of them now, which is a
    // change in kind and not only in number: selecting it no longer narrows to
    // a queue, it narrows to a property, and the rows it returns will span
    // Preorder, No Stock and Routine.
    //
    // Counted from the rows, which is now the only way: the old
    // best_sellers_at_risk metric was deleted with this change. It counted a
    // third set again -- flagged SKUs also stocking out soon -- was never
    // displayed, and an intersection of two filters the screen already offers
    // separately does not need a metric of its own.
    {
      key: "best-seller",
      label: pick("주력 상품", "best seller"),
      value: data.rows.filter((r) => r.best_seller).length,
    },
    { key: "out-soon", label: pick(`${m.horizon_days}일 내 품절`, `out ≤${m.horizon_days}d`), value: m.stockout_within_horizon },
    // Reported apart from the stockout count because the action differs: these
    // already have stock booked and cannot be helped by ordering more.
    { key: "supply-gap", label: pick("입고 전 품절", "dry before inbound"), value: m.supply_gap },
    // Already covered by a draft container, so a purchaser can set aside what
    // they have handled and work the rest. Counted here rather than served as a
    // metric, matching the data-quality warnings, which are also counted
    // client-side; the population is data.rows, which is the same unfiltered set
    // the server metrics above describe, so the two agree.
    {
      key: "drafted",
      label: pick("초안 발주 있음", "already drafted"),
      value: data.rows.filter((r) => r.draft_inbound > 0).length,
    },
    // Last, because it is the residual: the SKUs with no reason to hurry. It
    // exists so every priority label is reachable from the cards, which is what
    // the priority select was kept for. Counted client-side rather than served,
    // like the one above, since it is a count of a label already on every row.
    {
      key: "routine",
      label: pick("일반", "routine"),
      value: data.rows.filter((r) => r.priority_label === PRIORITY.routine).length,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Provenance. A planning screen that does not say how old its forecast is
          invites the reader to assume it is current. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {/* The vintage of what is on screen, in one line. It said when the
            forecast was trained and nothing else, so a reader could not tell
            which model produced it or how far it reaches. */}
        <span>
          {pick("학습 기준", "Trained through")}: <strong>{data.meta.trained_through ?? "—"}</strong>
        </span>
        {/* The same card the validation page shows, opened here rather than
            navigated to. Answering "what is v11" by sending a purchaser off the
            worklist they were working through is not answering it.
            No `source`: this payload does not carry the model block, so the
            card fetches it when opened. The version string comes from this
            page's own meta, so the trigger is correct before any fetch. */}
        {data.meta.model_version && (
          <span>
            {pick("모델", "Model")}: <ModelCard version={data.meta.model_version} />
          </span>
        )}
        {data.meta.horizon_end && (
          <span>
            {pick("예측 범위", "Horizon to")}: <strong>{data.meta.horizon_end}</strong>
          </span>
        )}
        {/* Kept visible on the success path too. The service can go down while
            the page is open, and the next filter change would then fail with no
            hint that the cause is external. */}
        {/* The SKU count used to sit here as well. It is already the count on
            the Forecast tab of the section toggle and the figure on the first
            summary button, and three copies of one number crowded out the two
            things in this bar that have to be read: how old the forecast is,
            and whether the stock figures are real. */}
        {/* Moved back in front of the ml-auto spacer. It was rendered after it,
            which pushed it to the far right of the bar, detached from the dates
            it qualifies and reading as an unrelated aside.
            It also said only that rows were dropped, not why, which is the part
            that matters: these SKUs were classified smooth when the forecast
            ran, so a forecast exists for them, and profiling has since demoted
            them to intermittent. The run and the segmentation are computed at
            different times and this is the visible seam between them. Without
            the explanation a reader reconciling this screen against the run
            finds a count that does not match and no account of the difference. */}
        {data.meta.demoted_since_forecast > 0 && (
          <span
            title={pick(
              "예측 실행 시점에는 스무스로 분류되어 예측이 생성되었으나, 이후 프로파일링에서 비정기로 재분류된 SKU입니다. 예측 자체는 존재하지만 현재 분류를 신뢰해 목록에서 제외합니다.",
              "These SKUs were classified smooth when the forecast ran, so predictions exist for them, but profiling has since reclassified them as intermittent. The list follows the current classification rather than the one the run was made under.",
            )}
            className="cursor-help underline decoration-dotted underline-offset-2"
          >
            {pick(
              `${data.meta.demoted_since_forecast}개는 실행 이후 비정기로 재분류되어 제외됨`,
              `${data.meta.demoted_since_forecast} reclassified intermittent since the run, so not listed`,
            )}
          </span>
        )}
        {data.meta.inventory_is_sample && (
          <span className="font-medium text-amber-600 dark:text-amber-400">
            {pick("샘플 재고 데이터", "SAMPLE inventory data")}
          </span>
        )}
        {/* Kept visible on the success path too. The service can go down while
            the page is open, and the next filter change would then fail with no
            hint that the cause is external. */}
        <span className="ml-auto">
          <ForecastServerStatus onRecovered={() => setReloadNonce((n) => n + 1)} />
        </span>
      </div>

      {/* Directly under the provenance bar, because the date in that bar is
          what prompts anyone to open this. Collapsed by default: it is an
          operational control on a screen built for purchasing decisions.
          onComplete refetches, so a finished run replaces the figures on the
          page without a reload and the "Trained through" date above moves to
          the week that was just produced. */}
      <RunForecast onComplete={() => setReloadNonce((n) => n + 1)} />

      {/* Which population. Kept above everything else, because the two sections
          answer different questions and every control below belongs to one of
          them. */}
      <div className="flex w-fit gap-1 rounded-md border p-0.5">
        {([
          ["forecast", pick("예측 대상", "Forecast"), data.meta.sku_count],
          ["not-forecast", pick("예측 제외", "Not forecast"), data.meta.not_forecast_count],
        ] as const).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSection(key)}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              section === key ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
          >
            {label}
            <span className="ml-1.5 tabular-nums opacity-70">{nf.format(count)}</span>
          </button>
        ))}
      </div>

      {section === "not-forecast" ? (
        <NotForecastSection planning={data.params} />
      ) : (
      <>
      {/* Summary counts, doubling as the primary filter. */}
      <div className="flex flex-wrap items-stretch gap-2">
        <button
          type="button"
          onClick={() => setFocus("all")}
          aria-pressed={focus === "all"}
          className={`rounded-md border px-3 py-1.5 text-left transition-colors ${
            focus === "all"
              ? "border-sky-400 bg-sky-50 dark:border-sky-700 dark:bg-sky-950"
              : "hover:bg-muted/60"
          }`}
        >
          <span className="block text-base font-semibold tabular-nums">
            {nf.format(m.forecasted_skus)}
          </span>
          <span className="block text-[11.5px] uppercase tracking-wide text-muted-foreground">
            {pick("전체", "all")}
          </span>
        </button>
        <span aria-hidden className="my-1 w-px self-stretch bg-border" />
        {filters.map((c) => (
          <button
            key={c.key}
            type="button"
            // Selecting the active filter clears it. Without this the only way out
            // of a filter was Reset, which also drops the search, the category,
            // the reliability tier and the sort, so stepping back one decision
            // cost the reader every other one they had made.
            onClick={() => setFocus(focus === c.key ? "all" : c.key)}
            aria-pressed={focus === c.key}
            className={`rounded-md border px-3 py-1.5 text-left transition-colors ${
              focus === c.key
                ? "border-sky-400 bg-sky-50 dark:border-sky-700 dark:bg-sky-950"
                : "hover:bg-muted/60"
            }`}
          >
            <span className="block text-base font-semibold tabular-nums">{nf.format(c.value)}</span>
            <span className="block text-[11.5px] uppercase tracking-wide text-muted-foreground">
              {c.label}
            </span>
          </button>
        ))}
        {/* The order total for what is on screen, not for the whole list.
            Previously this showed the list total while a second copy, counting
            the filtered view, sat in small grey text at the end of the filter
            row. Two totals in two visual languages, and the one that answered
            "what am I about to buy" was the one rendered as an aside. The list
            total is kept as a secondary line whenever a filter is narrowing the
            view, so the figure is still reconcilable against the run. */}
        <div className="rounded-md border border-dashed px-3 py-1.5">
          <span className="block text-base font-semibold tabular-nums text-indigo-600 dark:text-indigo-400">
            {nf.format(viewUnits)}
          </span>
          <span className="block text-[11.5px] uppercase tracking-wide text-muted-foreground">
            {narrowed ? pick("권장 수량 · 현재 목록", "units rec. · this view") : pick("권장 수량", "units rec.")}
          </span>
          {narrowed && (
            <span className="block text-[11.5px] text-muted-foreground/70">
              {pick(
                `전체 ${nf.format(m.total_recommended_order_qty)}`,
                `of ${nf.format(m.total_recommended_order_qty)} in the full list`,
              )}
            </span>
          )}
        </div>
      </div>

      {/* Planning assumptions. Server-side, so changing one refetches. Shared
          with the SKU detail page so both screens explain them identically. */}
      <PlanningControls
        params={{
          lead_time_weeks: lead,
          review_period_weeks: review,
          service_z: z,
          stockout_horizon_days: horizon,
        }}
        onChange={(next) => {
          setLead(next.lead_time_weeks);
          setReview(next.review_period_weeks);
          setZ(next.service_z);
          setHorizon(next.stockout_horizon_days);
        }}
        busy={loading}
      />

      {/* Filters. */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={pick("SKU 또는 상품명 검색…", "Search SKU or product name…")}
          className="h-8 w-64 text-xs"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-xs"
        >
          <option value="all">{pick("카테고리: 전체", "Category: all")}</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-xs"
        >
          <option value="all">{pick("신뢰도: 전체", "Reliability: all")}</option>
          <option value="good">{pick("좋음", "good")}</option>
          <option value="fair">{pick("보통", "fair")}</option>
          <option value="poor">{pick("낮음", "poor")}</option>
          <option value="none">{pick("미측정", "none")}</option>
        </select>
        <select
          value={trend}
          onChange={(e) => setTrend(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-xs"
        >
          <option value="all">{pick("수요 추세: 전체", "Trend: all")}</option>
          <option value="rising">{pick("상승", "rising")}</option>
          <option value="steady">{pick("보합", "steady")}</option>
          <option value="falling">{pick("하락", "falling")}</option>
          <option value="collapsing">{pick("급감", "collapsing")}</option>
          <option value="unknown">{pick("알 수 없음", "unknown")}</option>
        </select>
        <select
          value={String(pageSize)}
          onChange={(e) =>
            setPageSize(e.target.value === "all" ? "all" : Number(e.target.value))
          }
          className="h-8 rounded-md border bg-background px-2 text-xs"
        >
          {[25, 50, 100, 200].map((n) => (
            <option key={n} value={n}>{pick(`${n}개씩`, `${n} per page`)}</option>
          ))}
          <option value="all">{pick("전체 보기", "Show all")}</option>
        </select>
        <button
          type="button"
          onClick={() => {
            setFocus("all"); setQuery(""); setCategory("all");
            setTier("all"); setTrend("all"); setFlag(null); setSort(DEFAULT_SORT);
            setColumnFilters(new Map());
          }}
          className="flex h-8 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted/60"
        >
          <RotateCcw className="h-3 w-3" /> {pick("초기화", "Reset")}
        </button>
        {/* Beside Reset and Export rather than in the sort line, because it
            changes what the table contains rather than how it is ordered. */}
        <ColumnPicker columns={OPTIONAL_COLUMNS} bandLabels={BAND_LABEL} visible={visible} onChange={changeVisible} />
        <button
          type="button"
          onClick={exportCsv}
          className="flex h-8 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted/60"
        >
          <Download className="h-3 w-3" /> {pick("CSV 내보내기", "Export CSV")}
        </button>
        {/* The order in words, where a dropdown of named orders used to be. See
            describeSort() for why the control went: every order it offered was
            already a header click away, including the default. What it was
            genuinely carrying was the default's name, and a sentence carries
            that in every state rather than only while the default is chosen. */}
        <span className="text-[12.5px] leading-tight text-muted-foreground">
          {pick(
            `정렬: ${describeSort(sort)[0]} · 열 제목을 우클릭해 정렬·필터·숨기기`,
            `Sorted by ${describeSort(sort)[1]} · right-click a column header to sort, filter, or hide it`,
          )}
        </span>
        {/* Row count only. The units figure that used to trail this line is now
            the dashed card in the row of counts, where it reads as a quantity rather
            than as a footnote. */}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {pick(
            `${nf.format(data.rows.length)}개 중 ${nf.format(view.length)}개`,
            `${nf.format(view.length)} of ${nf.format(data.rows.length)} SKUs`,
          )}
        </span>
      </div>

      {view.length > 0 && <PortfolioChart skus={view.map((r) => r.unique_id)} />}

      {/* Data-quality summary for what is on screen, not the whole list. A count
          that ignores the filters describes a different population from the rows
          below it. */}
      {(quality.flagged > 0 || flag !== null) && (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-muted-foreground">
          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />
          <button
            type="button"
            onClick={() => setFlag(flag === ANY_FLAG ? null : ANY_FLAG)}
            aria-pressed={flag === ANY_FLAG}
            className={`rounded px-1 py-0.5 transition-colors hover:bg-muted ${
              flag === ANY_FLAG ? "bg-amber-100 font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300" : ""
            }`}
          >
            {pick(
              `${nf.format(scoped.length)}개 중 ${nf.format(quality.flagged)}개에 데이터 품질 경고`,
              `${nf.format(quality.flagged)} of ${nf.format(scoped.length)} carry a data-quality warning`,
            )}
          </button>
          {quality.byLabel.map(([label, n]) => (
            <button
              key={label}
              type="button"
              onClick={() => setFlag(flag === label ? null : label)}
              aria-pressed={flag === label}
              className={`rounded px-1 py-0.5 transition-colors hover:bg-muted ${
                flag === label ? "bg-amber-100 font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300" : ""
              }`}
            >
              {label} <span className="tabular-nums opacity-70">({nf.format(n)})</span>
            </button>
          ))}
          {/* Only reachable when the selected warning has no rows left after a
              later filter change. Without it the selection is invisible and the
              table looks empty for no stated reason. */}
          {flag !== null && flag !== ANY_FLAG && !quality.byLabel.some(([l]) => l === flag) && (
            <button
              type="button"
              onClick={() => setFlag(null)}
              className="rounded bg-amber-100 px-1 py-0.5 font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300"
            >
              {flag} <span className="opacity-70">(0) ✕</span>
            </button>
          )}
        </p>
      )}

      {view.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          {pick("조건에 맞는 SKU가 없습니다.", "No SKUs match these filters.")}
        </CardContent></Card>
      ) : (
        <>
        <ActionListTable
          rows={pageRows}
          visible={visible}
          coverageWeeks={data.params.lead_time_weeks + data.params.review_period_weeks}
          // The planning parameters travel with the link. Without them the
          // detail page answers at the default lead time while the row the user
          // clicked answers at theirs, and the two screens quietly disagree
          // about the same SKU.
          skuHref={(sku) =>
            `/planning/action-list/${encodeURIComponent(sku)}?${planningQuery(data.params)}`
          }
          // The whole filtered and sorted view, not just the row clicked. The
          // detail page steps between SKUs, and without this it stepped through
          // the server's worklist order over every SKU rather than the sequence
          // on screen.
          onOpenSku={(sku) => {
            rememberSkuSequence(view.map((r) => r.unique_id));
            router.push(
              `/planning/action-list/${encodeURIComponent(sku)}?${planningQuery(data.params)}`,
            );
          }}
          sort={sort}
          onSort={(key: SortKey, dir: SortDir) => setSort([{ key, dir }])}
          onHideColumn={hideColumn}
          columnFilters={columnFilters}
          openFilterKey={openFilterKey}
          onOpenFilterKeyChange={setOpenFilterKey}
          getColumnValues={() => columnValuesForOpenKey}
          onColumnFilterChange={onColumnFilterChange}
        />
        {/* Priority, defined first because it is the column the worklist is
            ordered by and the leftmost thing a reader meets. Nothing on the page
            said what earned each badge; the Streamlit prototype carried this and
            the port dropped it (BACKLOG.md 13.5).
            Glyphs and colours come from the same constants the badges use, so
            the legend cannot describe a badge that renders differently.
            The star is listed apart rather than as a fourth rung, because after
            item 14 it is a different kind of thing: the three labels are values
            of one variable and exclude each other, the star is an attribute and
            can sit on any of them. Stating that is most of the explanation. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
          <span className="font-medium">{pick("우선순위", "Priority")}:</span>
          <span className="opacity-80">
            {pick(
              "재고 상태를 나타내며, 위에서부터 먼저 해당되는 하나만 붙습니다.",
              "the stock situation, first match wins, so a SKU carries one label even when more than one is true",
            )}
          </span>
          {([
            [PRIORITY.preorder, pick("고객에게 이미 판매된 수량이 있음", "units already owed to customers")],
            [PRIORITY.noStock, pick("판매 가능한 재고가 없음", "nothing free to sell")],
            [PRIORITY.routine, pick("둘 다 아님 · 평상시 주기로 발주", "neither, order on the normal cycle")],
          ] as const).map(([label, meaning]) => {
            const n = view.filter((r) => r.priority_label === label).length;
            return (
              <span key={label} className="inline-flex items-center gap-1">
                <span
                  className={`rounded-full border px-1.5 ${
                    PRIORITY_STYLE[label] ?? PRIORITY_STYLE.Routine
                  }`}
                >
                  {PRIORITY_GLYPH[label]} {label}
                </span>
                {meaning}
                <span className="tabular-nums opacity-70">({nf.format(n)})</span>
              </span>
            );
          })}
          <span className="inline-flex items-center gap-1">
            <span className="text-[13px] text-amber-500">★</span>
            {pick(
              "최근 4주 판매의 절반을 차지하는 소수 SKU. 재고 상태와 무관한 속성이므로 어느 행에나 붙을 수 있습니다",
              "one of the products making up half of recent demand. An attribute, not a queue, so it can appear on any row",
            )}
            <span className="tabular-nums opacity-70">
              ({nf.format(view.filter((r) => r.best_seller).length)})
            </span>
          </span>
        </div>

        {/* Legend. The reliability column is three glyphs and a percentage, which
            means nothing without the thresholds behind it, and a tier is a
            judgement the reader should be able to check. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
          <span className="font-medium">{pick("신뢰도", "Reliability")}:</span>
          {([
            ["good", "●●●", pick("좋음 · 오차 15% 이하", "good · error ≤15%")],
            ["fair", "●●○", pick("보통 · 15–30%", "fair · 15–30%")],
            ["poor", "●○○", pick("낮음 · 30% 초과", "poor · over 30%")],
            ["none", "○○○", pick("미측정 · 백테스트 없음", "not measured · no backtest window")],
          ] as const).map(([tierKey, glyph, label]) => {
            const n = view.filter((r) => r.tier === tierKey).length;
            return (
              <span key={tierKey} className="inline-flex items-center gap-1">
                <span
                  className={`font-mono ${
                    tierKey === "good" ? "text-emerald-600 dark:text-emerald-400"
                      : tierKey === "fair" ? "text-amber-600 dark:text-amber-400"
                      : tierKey === "poor" ? "text-red-600 dark:text-red-400"
                      : "text-neutral-400"
                  }`}
                >
                  {glyph}
                </span>
                {label}
                <span className="tabular-nums opacity-70">({nf.format(n)})</span>
              </span>
            );
          })}
        </div>

        {/* Demand trend, defined where reliability is defined. A word like
            "collapsing" on a SKU page means nothing without the rule behind it,
            and this is the one place on either screen that states a threshold.
            The ratio is the model's own ramp_4_12 feature, so what the dashboard
            calls falling and what the model treats as falling cannot drift. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
          <span className="font-medium">{pick("수요 추세", "Demand trend")}:</span>
          <span className="opacity-80">
            {pick(
              "최근 4주 판매를 최근 12주 평균과 비교 (계절성 제거). 비율이므로 0.80과 1.25가 1.0에서 같은 거리입니다.",
              "last 4 weeks against the last 12, seasonally adjusted. It is a ratio, so 0.80 and 1.25 are the same distance from 1.0",
            )}
          </span>
          {([
            ["rising", pick("상승 · 1.25배 초과", "rising · above 1.25×"), "text-emerald-600 dark:text-emerald-400"],
            ["steady", pick("보합 · 0.80–1.25배", "steady · 0.80–1.25×"), ""],
            ["falling", pick("하락 · 0.40–0.80배", "falling · 0.40–0.80×"), "text-amber-600 dark:text-amber-400"],
            ["collapsing", pick("급감 · 0.40배 미만", "collapsing · under 0.40×"), "text-red-600 dark:text-red-400"],
            // Listed because the filter offers it. It means the ratio could not
            // be computed, which is a SKU with too little history rather than a
            // SKU that is flat.
            ["unknown", pick("알 수 없음 · 이력 부족", "unknown · not enough history"), ""],
          ] as const).map(([key, label, colour]) => {
            const n = view.filter((r) => r.demand_state === key).length;
            return (
              <span key={key} className="inline-flex items-center gap-1">
                <span className={colour || "text-neutral-400"}>●</span>
                {label}
                <span className="tabular-nums opacity-70">({nf.format(n)})</span>
              </span>
            );
          })}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 text-xs">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => goToPage(currentPage - 1)}
              className="rounded-md border px-2 py-1 disabled:opacity-40 hover:bg-muted/60 disabled:hover:bg-transparent"
            >
              ‹ {pick("이전", "Previous")}
            </button>
            <span className="tabular-nums text-muted-foreground">
              {pick(
                `${nf.format((currentPage - 1) * (pageSize as number) + 1)}–${nf.format(Math.min(currentPage * (pageSize as number), view.length))} / ${nf.format(view.length)} · ${currentPage}/${totalPages} 페이지`,
                `${nf.format((currentPage - 1) * (pageSize as number) + 1)}–${nf.format(Math.min(currentPage * (pageSize as number), view.length))} of ${nf.format(view.length)} · page ${currentPage} of ${totalPages}`,
              )}
            </span>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => goToPage(currentPage + 1)}
              className="rounded-md border px-2 py-1 disabled:opacity-40 hover:bg-muted/60 disabled:hover:bg-transparent"
            >
              {pick("다음", "Next")} ›
            </button>
          </div>
        )}
        </>
      )}
      </>
      )}
    </div>
  );
}
