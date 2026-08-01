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
import { useRouter } from "next/navigation";
import { AlertTriangle, Download, Loader2, RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import {
  ActionListTable, DEFAULT_SORT, PRIORITY, nextSort, sortRows,
  type SortCriterion, type SortKey,
} from "./action-list-table";
import { ForecastServerStatus } from "@/components/planning/forecast-server-status";
import {
  PlanningError,
  planningErrorFrom,
  type PlanningErrorBody,
} from "@/components/planning/planning-error";
import { NotForecastSection } from "./not-forecast-section";
import { PortfolioChart } from "./portfolio-chart";
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

const SERVICE_LEVELS: { label: string; z: number }[] = [
  { label: "84% (z=1.0)", z: 1.0 },
  { label: "90% (z=1.28)", z: 1.28 },
  { label: "95% (z=1.65)", z: 1.65 },
  { label: "98% (z=2.05)", z: 2.05 },
];

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

  const scoped = useMemo<ActionListRow[]>(() => {
    if (!data) return [];
    let rows = data.rows;
    if (focus === "preorder") rows = rows.filter((r) => r.priority_label === PRIORITY.preorder);
    else if (focus === "no-stock") rows = rows.filter((r) => r.available_inventory <= 0);
    else if (focus === "best-seller") rows = rows.filter((r) => r.priority_label === PRIORITY.bestSeller);
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
      rows = rows.filter(
        (r) =>
          r.unique_id.toLowerCase().includes(q) ||
          (r.product_name ?? "").toLowerCase().includes(q),
      );
    }
    if (category !== "all") rows = rows.filter((r) => r.product_category === category);
    if (tier !== "all") rows = rows.filter((r) => r.tier === tier);
    // Sorted last, and on a copy: the server returns the worklist order, which
    // is what no criteria means, so it must not be mutated on the way through.
    return sortRows(rows, sort);
  }, [data, focus, query, category, tier, sort]);

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
  const filterKey = `${focus}|${query}|${category}|${tier}|${flag ?? ""}|${pageSize}`;
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

  const exportCsv = useCallback(() => {
    if (!view.length) return;
    const cols = Object.keys(view[0]).filter((c) => c !== "flags");
    const csv = [
      [...cols, "flags"].join(","),
      ...view.map((r) =>
        [
          ...cols.map((c) => {
            const v = (r as unknown as Record<string, unknown>)[c];
            const s = v === null || v === undefined ? "" : String(v);
            return s.includes(",") ? `"${s.replace(/"/g, '""')}"` : s;
          }),
          `"${r.flags.join("; ")}"`,
        ].join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "action-list.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [view]);

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
    // Counted from the label, not from m.best_sellers_at_risk. The card used to
    // display that metric while filtering on the label, and they are different
    // sets: `best_seller` is a flag on the top slice by recent units, 89 SKUs,
    // while `Best Seller` is the label only the ones nothing outranks receive,
    // 35 of them. The metric counts a third thing again, the flagged SKUs also
    // stocking out soon, which cuts across every label. So the card showed 36
    // and then produced 35 rows. It now counts what it selects.
    // "risk" dropped from the name with the metric, since it described the set
    // that is no longer being counted.
    {
      key: "best-seller",
      label: pick("주력 상품", "best seller"),
      value: data.rows.filter((r) => r.priority_label === PRIORITY.bestSeller).length,
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
        <span>
          {pick("학습 기준", "Trained through")}: <strong>{data.meta.trained_through ?? "—"}</strong>
        </span>
        {/* Kept visible on the success path too. The service can go down while
            the page is open, and the next filter change would then fail with no
            hint that the cause is external. */}
        {/* The SKU count used to sit here as well. It is already the count on
            the Forecast tab of the section toggle and the figure on the first
            summary button, and three copies of one number crowded out the two
            things in this bar that have to be read: how old the forecast is,
            and whether the stock figures are real. */}
        <span className="ml-auto">
          <ForecastServerStatus onRecovered={() => setReloadNonce((n) => n + 1)} />
        </span>
        {data.meta.demoted_since_forecast > 0 && (
          <span>
            {pick(
              `${data.meta.demoted_since_forecast}개는 비정기로 재분류되어 제외됨`,
              `${data.meta.demoted_since_forecast} dropped as intermittent since the run`,
            )}
          </span>
        )}
        {data.meta.inventory_is_sample && (
          <span className="font-medium text-amber-600 dark:text-amber-400">
            {pick("샘플 재고 데이터", "SAMPLE inventory data")}
          </span>
        )}
      </div>

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
          <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
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
            <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
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
          <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
            {narrowed ? pick("권장 수량 · 현재 목록", "units rec. · this view") : pick("권장 수량", "units rec.")}
          </span>
          {narrowed && (
            <span className="block text-[10px] text-muted-foreground/70">
              {pick(
                `전체 ${nf.format(m.total_recommended_order_qty)}`,
                `of ${nf.format(m.total_recommended_order_qty)} in the full list`,
              )}
            </span>
          )}
        </div>
      </div>

      {/* Planning assumptions. Server-side, so changing one refetches. */}
      <div className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/30 p-3 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">{pick("리드타임(주)", "Lead time (wks)")}</span>
          <Input
            type="number" min={1} max={52} value={lead}
            onChange={(e) => setLead(Math.max(1, Math.min(52, Number(e.target.value) || 1)))}
            className="h-8 w-20"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">{pick("발주 주기(주)", "Review (wks)")}</span>
          <Input
            type="number" min={1} max={13} value={review}
            onChange={(e) => setReview(Math.max(1, Math.min(13, Number(e.target.value) || 1)))}
            className="h-8 w-20"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">{pick("서비스 수준", "Service level")}</span>
          <select
            value={z}
            onChange={(e) => setZ(Number(e.target.value))}
            className="h-8 rounded-md border bg-background px-2"
          >
            {SERVICE_LEVELS.map((s) => (
              <option key={s.z} value={s.z}>{s.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">{pick("품절 위험 기간(일)", "Risk window (days)")}</span>
          <Input
            type="number" min={1} max={365} value={horizon}
            onChange={(e) => setHorizon(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
            className="h-8 w-20"
          />
        </label>
        {loading && <Loader2 className="mb-2 h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

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
            setTier("all"); setFlag(null); setSort(DEFAULT_SORT);
          }}
          className="flex h-8 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted/60"
        >
          <RotateCcw className="h-3 w-3" /> {pick("초기화", "Reset")}
        </button>
        <button
          type="button"
          onClick={exportCsv}
          className="flex h-8 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted/60"
        >
          <Download className="h-3 w-3" /> {pick("CSV 내보내기", "Export CSV")}
        </button>
        <span className="text-[10px] text-muted-foreground">
          {sort.length === 0
            ? pick("우선순위 순", "worklist order")
            : pick(
                `${sort.length}개 기준 정렬 · Shift+클릭으로 추가`,
                `sorted by ${sort.length} column${sort.length === 1 ? "" : "s"} · shift-click to add`,
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
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
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
          // The planning parameters travel with the link. Without them the
          // detail page answers at the default lead time while the row the user
          // clicked answers at theirs, and the two screens quietly disagree
          // about the same SKU.
          skuHref={(sku) =>
            `/planning/action-list/${encodeURIComponent(sku)}?${planningQuery(data.params)}`
          }
          onOpenSku={(sku) =>
            router.push(
              `/planning/action-list/${encodeURIComponent(sku)}?${planningQuery(data.params)}`,
            )
          }
          sort={sort}
          onSort={(key: SortKey, shiftKey: boolean) =>
            setSort((prev) => nextSort(prev, key, shiftKey))
          }
        />
        {/* Legend. The reliability column is three glyphs and a percentage, which
            means nothing without the thresholds behind it, and a tier is a
            judgement the reader should be able to check. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-muted-foreground">
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
