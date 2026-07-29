"use client";

/**
 * Code Guide:
 * Action list page body — fetches /api/planning/action-list and renders the
 * summary chips, the planning controls, the filters and the table.
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

type Focus = "all" | "preorder" | "no-stock" | "best-seller" | "out-soon" | "supply-gap";

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
  const [history, setHistory] = useState("all");
  const [priority, setPriority] = useState("all");
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
  const paramsKey = `${lead}|${review}|${z}|${horizon}`;
  const [state, setState] = useState<{
    key: string;
    data: ActionListResponse | null;
    error: string | null;
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
        if (!res.ok) throw new Error(body?.detail || body?.error || `HTTP ${res.status}`);
        return body as ActionListResponse;
      })
      .then((body) => setState({ key: paramsKey, data: body, error: null }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          key: paramsKey,
          data: null,
          error: err instanceof Error ? err.message : String(err),
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

  const view = useMemo<ActionListRow[]>(() => {
    if (!data) return [];
    let rows = data.rows;
    if (focus === "preorder") rows = rows.filter((r) => r.priority_label === PRIORITY.preorder);
    else if (focus === "no-stock") rows = rows.filter((r) => r.available_inventory <= 0);
    else if (focus === "best-seller") rows = rows.filter((r) => r.priority_label === PRIORITY.bestSeller);
    else if (focus === "supply-gap") rows = rows.filter((r) => r.has_supply_gap);
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
    if (history !== "all") rows = rows.filter((r) => r.history_group === history);
    // Independent of the chips, which cover three of the four labels.
    // Without this "Routine" is unreachable: it is the only priority with
    // no chip, being the absence of a reason to hurry.
    if (priority !== "all") rows = rows.filter((r) => r.priority_label === priority);
    // Sorted last, and on a copy: the server returns the worklist order, which
    // is what no criteria means, so it must not be mutated on the way through.
    return sortRows(rows, sort);
  }, [data, focus, query, category, tier, history, priority, sort]);

  // The page is tied to the filter set it was chosen under, so changing a filter
  // returns to page 1 without an effect resetting it. Narrowing the filters while
  // on page 5 would otherwise land on an empty page, which reads as "no results"
  // rather than "you are past the end".
  const filterKey = `${focus}|${query}|${category}|${tier}|${history}|${priority}|${pageSize}`;
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
      <Card>
        <CardContent className="p-6 text-sm">
          <p className="font-medium text-red-600 dark:text-red-400">
            {pick("예측 서버에 연결할 수 없습니다.", "Could not reach the forecast server.")}
          </p>
          <p className="mt-1 text-muted-foreground">{error}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            {pick(
              "FastAPI 서비스가 AI_SERVICE_URL 주소에서 실행 중인지 확인하세요.",
              "Check that the FastAPI service is running at AI_SERVICE_URL.",
            )}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const m = data.metrics;
  const chips: { key: Focus; label: string; value: number }[] = [
    { key: "all", label: pick("예측 대상", "forecasted"), value: m.forecasted_skus },
    { key: "preorder", label: pick("선주문", "preorder"), value: m.preorder_priority },
    { key: "no-stock", label: pick("품절", "out of stock"), value: m.out_of_stock },
    { key: "best-seller", label: pick("주력 위험", "best seller risk"), value: m.best_sellers_at_risk },
    { key: "out-soon", label: pick(`${m.horizon_days}일 내 품절`, `out ≤${m.horizon_days}d`), value: m.stockout_within_horizon },
    // Reported apart from the stockout count because the action differs: these
    // already have stock booked and cannot be helped by ordering more.
    { key: "supply-gap", label: pick("입고 전 품절", "dry before inbound"), value: m.supply_gap },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Provenance. A planning screen that does not say how old its forecast is
          invites the reader to assume it is current. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {pick("학습 기준", "Trained through")}: <strong>{data.meta.trained_through ?? "—"}</strong>
        </span>
        <span>
          {pick("예측 SKU", "SKUs")}: <strong>{nf.format(data.meta.sku_count)}</strong>
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
      {/* Summary chips, doubling as the primary filter. */}
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setFocus(c.key)}
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
        <div className="rounded-md border border-dashed px-3 py-1.5">
          <span className="block text-base font-semibold tabular-nums text-indigo-600 dark:text-indigo-400">
            {nf.format(m.total_recommended_order_qty)}
          </span>
          <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
            {pick("권장 수량", "units rec.")}
          </span>
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
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-xs"
        >
          <option value="all">{pick("우선순위: 전체", "Priority: all")}</option>
          {[PRIORITY.preorder, PRIORITY.noStock, PRIORITY.bestSeller, PRIORITY.routine].map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select
          value={history}
          onChange={(e) => setHistory(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-xs"
        >
          <option value="all">{pick("이력: 전체", "History: all")}</option>
          <option value="short">{pick("단기", "short")}</option>
          <option value="long">{pick("장기", "long")}</option>
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
            setTier("all"); setHistory("all"); setPriority("all"); setSort(DEFAULT_SORT);
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
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {pick(
            `${nf.format(data.rows.length)}개 중 ${nf.format(view.length)}개 · 이 목록 권장 ${nf.format(view.reduce((s, r) => s + r.recommended_order_qty, 0))}개`,
            `${nf.format(view.length)} of ${nf.format(data.rows.length)} SKUs · ${nf.format(view.reduce((s, r) => s + r.recommended_order_qty, 0))} units recommended in this view`,
          )}
        </span>
      </div>

      {view.length > 0 && <PortfolioChart skus={view.map((r) => r.unique_id)} />}

      {/* Data-quality summary for what is on screen, not the whole list. A count
          that ignores the filters describes a different population from the rows
          below it. */}
      {(() => {
        const counts = new Map<string, number>();
        for (const r of view) for (const f of r.flags) counts.set(f, (counts.get(f) ?? 0) + 1);
        const flagged = view.filter((r) => r.flags.length > 0).length;
        if (!flagged) return null;
        return (
          <p className="text-[11px] text-muted-foreground">
            <AlertTriangle className="mr-1 inline h-3 w-3 text-amber-500" />
            {pick(
              `이 목록의 ${nf.format(view.length)}개 중 ${nf.format(flagged)}개에 데이터 품질 경고가 있습니다: `,
              `${nf.format(flagged)} of ${nf.format(view.length)} SKUs in this view carry a data-quality warning: `,
            )}
            {[...counts.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([label, n]) => `${label} (${n})`)
              .join(" · ")}
          </p>
        );
      })()}

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
