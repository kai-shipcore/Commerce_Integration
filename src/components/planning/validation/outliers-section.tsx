"use client";

/**
 * Code Guide:
 * SKU-level breakdown: whether the pooled result is broad or carried by a few.
 *
 * This section used to be two lists, the five best and five worst SKUs, under
 * the heading "Where it breaks down". That framing produced a failures list, and
 * a failures list is an anecdote: five bad rows say nothing about whether the
 * tail behind them is five rows or two hundred, and nothing at all about the
 * wins. Someone reviewing the model cannot settle anything with it.
 *
 * The question this section exists to answer is the first one anyone asks of an
 * aggregate: is the improvement broad, or is a small number of large wins
 * carrying an average? Four things answer it, in order of how directly:
 *
 *   1. Win rate, counted twice: by SKU-window and by units. The two differ, and
 *      the difference is the answer. Winning on 62% of rows but 67% of demand
 *      says the wins are where the volume is.
 *   2. The distribution of per-SKU deltas, so the shape behind those rates is
 *      visible rather than summarised.
 *   3. The same rates split by backtest window and by segment, which is what
 *      separates a systematic weakness from scattered bad luck.
 *   4. Every scored row, searchable and sortable, so any claim above can be
 *      chased to the product it came from.
 *
 * Two different quantities are called "units" in the neighbourhood of this
 * section, and keeping them apart is the difference between a reader trusting
 * a figure and guessing at it:
 *
 *   Units sold  - `y_total_cur`, actual demand over a scored backtest window.
 *                 This is the Actual column, the minimum-volume threshold, and
 *                 the denominator of the by-demand win rate.
 *   Percentage  - the delta. Both WAPEs are rates, so their difference is in
 *   points (pp)   points of WAPE, not in products. A delta of +29pp means this
 *                 SKU's forecast was 29 percentage points worse than the
 *                 spreadsheet's, whatever its volume.
 *
 * Every label in this file says which one it means. The delta column printed a
 * bare "+29" at first, which reads equally well as 29 units, and neither the
 * header nor the surrounding columns disambiguated it.
 *
 * Delta is `model WAPE - spreadsheet WAPE` on the same actual, so negative is
 * the model winning. That sign is counter-intuitive on a screen where better
 * usually means larger, so nothing here prints a delta without either a colour
 * and a sign, or a direction word beside it.
 *
 * The minimum-volume control is load-bearing rather than a convenience. Both
 * WAPEs divide by the same actual, so delta is bounded by that denominator, and
 * on the current report the largest deltas belong to SKUs selling 10 to 70
 * units. Ranking the unfiltered pool sorts by smallness. The threshold is a
 * judgement, so it is shown, moveable, and always stated alongside what it
 * leaves out.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { ColumnHeaderMenu } from "@/components/planning/column-header-menu";
import { ColumnPicker, type ColumnPickerColumn } from "@/components/planning/column-picker";
import {
  applyColumnFilters, distinctColumnValuesExcluding, type DistinctValue,
} from "@/lib/planning/column-filter";
import { SectionHeading } from "./section-heading";
import type { OutlierRow, ValidationOutliers } from "./types";

const nf = new Intl.NumberFormat("en-US");
const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : "—");
const pct1 = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "—");

/** Selectable minimums, in units over a scored window. 0 stays reachable: it is
 *  what the section used to show, and removing it would make the filtered view
 *  impossible to check against the unfiltered one. */
const MIN_UNITS_PRESETS = [0, 100, 200, 300, 500];

/** A regression worth counting, in WAPE percentage points (0.25 = 25pp). Below
 *  this a SKU's forecast got slightly worse, which on a per-SKU WAPE is inside
 *  the noise three backtest windows can resolve; above it, someone would
 *  notice. Stated as a constant because the headline strip reports a count
 *  against it and a reader has to know what was counted. */
const MATERIAL_REGRESSION = 0.25;

/** Histogram edges for the delta distribution, in WAPE points.
 *
 *  Clipped at ±1 with overflow buckets at both ends. The real range runs to
 *  about +5, all of it tiny SKUs, and letting the axis follow it puts 99% of
 *  the mass in two bars. The overflow buckets are labelled as overflow rather
 *  than as their edge, so nothing reads as though the tail were being hidden. */
const BINS = [-1, -0.75, -0.5, -0.35, -0.25, -0.15, -0.05, 0.05, 0.15, 0.25, 0.35, 0.5, 0.75, 1];

const pillClass = (active: boolean) =>
  `rounded px-2 py-1 text-[12.5px] transition-colors ${
    active
      ? "bg-sky-100 font-semibold text-sky-900 dark:bg-sky-900 dark:text-sky-100"
      : "text-muted-foreground hover:bg-muted/60"
  }`;

type SortKey = "delta" | "y_total_cur" | "wape_cur" | "wape_base" | "unique_id" | "window";

/** Only SKU is non-hideable: it is the row's identity and link target. */
const NON_HIDEABLE = new Set<SortKey>(["unique_id"]);

/** Every column a header's own menu can hide, in render order. */
const OPTIONAL_COLUMNS: ColumnPickerColumn<SortKey>[] = [
  { key: "window", label: ["구간", "Window"] },
  { key: "y_total_cur", label: ["실판매", "Units sold"] },
  { key: "wape_cur", label: ["모델 WAPE", "Model WAPE"] },
  { key: "wape_base", label: ["기준 WAPE", "Baseline WAPE"] },
  { key: "delta", label: ["차이", "Diff"] },
];
const ALL_COLUMNS: SortKey[] = ["unique_id", ...OPTIONAL_COLUMNS.map((c) => c.key)];

const ACCESSORS: Record<SortKey, (r: OutlierRow) => unknown> = {
  unique_id: (r) => r.unique_id,
  window: (r) => r.window,
  y_total_cur: (r) => Math.round(r.y_total_cur),
  wape_cur: (r) => Math.round(r.wape_cur * 100),
  wape_base: (r) => Math.round(r.wape_base * 100),
  delta: (r) => Math.round(r.delta * 100),
};

const FORMATTERS: Record<SortKey, (r: OutlierRow) => string> = {
  unique_id: (r) => r.unique_id,
  window: (r) => r.window,
  y_total_cur: (r) => nf.format(Math.round(r.y_total_cur)),
  wape_cur: (r) => pct(r.wape_cur),
  wape_base: (r) => pct(r.wape_base),
  delta: (r) => `${r.delta > 0 ? "+" : ""}${(r.delta * 100).toFixed(0)}pp`,
};

const OUTLIERS_COLUMNS_STORAGE_KEY = "planning:forecast-validation:outliers:columns";

/** Win rate and the figures beside it, over whatever rows are in scope. */
function summarise(rows: OutlierRow[]) {
  const units = rows.reduce((s, r) => s + r.y_total_cur, 0);
  const wins = rows.filter((r) => r.delta < 0);
  const winUnits = wins.reduce((s, r) => s + r.y_total_cur, 0);
  const bad = rows.filter((r) => r.delta > MATERIAL_REGRESSION);
  return {
    n: rows.length,
    units,
    winRows: rows.length ? wins.length / rows.length : 0,
    winUnits: units ? winUnits / units : 0,
    nBad: bad.length,
    badUnits: bad.reduce((s, r) => s + r.y_total_cur, 0),
    // Pooled, matching the headline metric: absolute error summed before
    // dividing. Reconstructed from wape x actual because the payload carries
    // rates rather than the errors they came from.
    pooledCur: units ? rows.reduce((s, r) => s + r.wape_cur * r.y_total_cur, 0) / units : NaN,
    pooledBase: units ? rows.reduce((s, r) => s + r.wape_base * r.y_total_cur, 0) / units : NaN,
    medianDelta: rows.length
      ? [...rows].map((r) => r.delta).sort((a, b) => a - b)[Math.floor(rows.length / 2)]
      : NaN,
  };
}

function Stat({
  label,
  value,
  sub,
  tone = "plain",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "plain" | "good" | "bad";
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-bold leading-none tabular-nums ${
          tone === "good"
            ? "text-emerald-600 dark:text-emerald-400"
            : tone === "bad"
              ? "text-amber-600 dark:text-amber-400"
              : ""
        }`}
      >
        {value}
      </div>
      {sub && <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function OutliersSection({
  outliers,
  baseline,
}: {
  outliers: ValidationOutliers;
  baseline: string;
}) {
  const { pick } = useI18n();
  const [minUnits, setMinUnits] = useState<number>(outliers.default_min_units);
  const [window, setWindow] = useState<string>("all");
  const [segment, setSegment] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "delta",
    dir: "desc",
  });
  const [limit, setLimit] = useState(25);
  const [visible, setVisible] = useState<Set<SortKey>>(() => new Set(ALL_COLUMNS));
  const [columnFilters, setColumnFilters] = useState<Map<SortKey, Set<string>>>(new Map());
  const [openFilterKey, setOpenFilterKey] = useState<SortKey | null>(null);

  // Read after mount: localStorage does not exist on the server, and seeding
  // state from it in the initialiser would make the client's first paint
  // disagree with what was rendered there. `window` here would shadow the
  // browser global, hence `globalThis`.
  useEffect(() => {
    try {
      const raw = globalThis.localStorage.getItem(OUTLIERS_COLUMNS_STORAGE_KEY);
      if (!raw) return;
      const saved = (JSON.parse(raw) as string[]).filter((k) =>
        (ALL_COLUMNS as string[]).includes(k),
      ) as SortKey[];
      if (saved.length > 0) queueMicrotask(() => setVisible(new Set(saved)));
    } catch {
      // Corrupt or unavailable store: default to every column, unchanged.
    }
  }, []);

  const changeVisible = useCallback((next: Set<SortKey>) => {
    setVisible(next);
    try {
      globalThis.localStorage.setItem(OUTLIERS_COLUMNS_STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      // Losing the preference is a smaller problem than failing the
      // interaction that set it.
    }
  }, []);

  const hideColumn = useCallback((key: SortKey) => {
    setVisible((prev) => {
      if (prev.size <= 1) return prev;
      const next = new Set(prev);
      next.delete(key);
      try {
        globalThis.localStorage.setItem(OUTLIERS_COLUMNS_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // See changeVisible above.
      }
      return next;
    });
  }, []);

  const onColumnFilterChange = useCallback((key: SortKey, next: Set<string> | null) => {
    setColumnFilters((prev) => {
      const m = new Map(prev);
      if (next === null) m.delete(key);
      else m.set(key, next);
      return m;
    });
  }, []);

  const vis = (key: SortKey) => visible.has(key);

  const windows = useMemo(
    () => [...new Set(outliers.rows.map((r) => r.window))].sort(),
    [outliers.rows],
  );
  const segments = useMemo(
    () => [...new Set(outliers.rows.map((r) => r.segment).filter(Boolean))].sort() as string[],
    [outliers.rows],
  );

  // Scope for everything above the table: the volume threshold and the window
  // and segment pickers. The search box deliberately does NOT narrow it, so
  // typing a SKU cannot silently rewrite the win rate above the table it is
  // filtering.
  const scoped = useMemo(
    () =>
      outliers.rows.filter(
        (r) =>
          r.y_total_cur >= minUnits &&
          (window === "all" || r.window === window) &&
          (segment === "all" || r.segment === segment),
      ),
    [outliers.rows, minUnits, window, segment],
  );

  const all = useMemo(() => summarise(scoped), [scoped]);

  const histogram = useMemo(() => {
    const counts = new Array(BINS.length + 1).fill(0);
    for (const r of scoped) {
      if (r.delta < BINS[0]) { counts[0] += 1; continue; }
      if (r.delta >= BINS[BINS.length - 1]) { counts[counts.length - 1] += 1; continue; }
      for (let i = 0; i < BINS.length - 1; i += 1) {
        if (r.delta >= BINS[i] && r.delta < BINS[i + 1]) { counts[i + 1] += 1; break; }
      }
    }
    const max = Math.max(...counts, 1);
    return counts.map((count, i) => {
      const lo = i === 0 ? -Infinity : BINS[i - 1];
      const hi = i === counts.length - 1 ? Infinity : BINS[i];
      return {
        count,
        share: count / max,
        // The bar's own direction, so the eye reads left-is-better without
        // needing the axis label.
        better: hi <= 0,
        label:
          i === 0
            ? `< ${BINS[0]}`
            : i === counts.length - 1
              ? `≥ +${BINS[BINS.length - 1]}`
              : `${lo > 0 ? "+" : ""}${lo} … ${hi > 0 ? "+" : ""}${hi}`,
      };
    });
  }, [scoped]);

  const byWindow = useMemo(
    () => windows.map((w) => ({ key: w, ...summarise(scoped.filter((r) => r.window === w)) })),
    [windows, scoped],
  );
  const bySegment = useMemo(
    () => segments.map((sg) => ({ key: sg, ...summarise(scoped.filter((r) => r.segment === sg)) })),
    [segments, scoped],
  );

  // Search-filtered but not yet column-filtered or sorted — the population a
  // column's own Filter submenu computes its distinct values against (minus
  // that column's own filter, see columnValuesForOpenKey).
  const searchedRows = useMemo(() => {
    const q = query.trim().toUpperCase();
    return q ? scoped.filter((r) => r.unique_id.toUpperCase().includes(q)) : scoped;
  }, [scoped, query]);

  const table = useMemo(() => {
    const rows = applyColumnFilters(searchedRows, columnFilters, ACCESSORS);
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sort.key === "unique_id" || sort.key === "window") {
        return dir * a[sort.key].localeCompare(b[sort.key]);
      }
      return dir * ((a[sort.key] as number) - (b[sort.key] as number));
    });
  }, [searchedRows, columnFilters, sort]);

  const columnValuesForOpenKey = useMemo((): DistinctValue[] => {
    if (!openFilterKey) return [];
    return distinctColumnValuesExcluding(
      searchedRows,
      columnFilters,
      ACCESSORS,
      FORMATTERS,
      openFilterKey,
      pick("(공백)", "(Blank)"),
    );
  }, [openFilterKey, searchedRows, columnFilters, pick]);

  const excluded = outliers.rows.length - scoped.length;

  const th = (key: SortKey, label: string, right = false) => {
    const filterSet = columnFilters.get(key) ?? null;
    return (
      <ColumnHeaderMenu
        className={`py-1.5 pr-3 font-medium ${right ? "text-right" : "pl-3 text-left"}`}
        sortDir={sort.key === key ? sort.dir : null}
        onSortAsc={() => setSort({ key, dir: "asc" })}
        onSortDesc={() => setSort({ key, dir: "desc" })}
        filter={{
          active: filterSet !== null,
          committed: filterSet,
          getValues: () => (openFilterKey === key ? columnValuesForOpenKey : []),
          onApply: (next) => onColumnFilterChange(key, next),
          onOpenChange: (open) => setOpenFilterKey(open ? key : null),
        }}
        hide={{ canHide: !NON_HIDEABLE.has(key), onHide: () => hideColumn(key) }}
      >
        {label}
      </ColumnHeaderMenu>
    );
  };

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading
        id="outliers"
        title={pick("SKU 단위 분석", "SKU-level breakdown")}
        description={pick(
          `합산 오차는 포트폴리오 전체에 대한 진술이며 개별 SKU를 보장하지 않습니다. 이 섹션은 그 개선이 전반적인 것인지, 아니면 소수의 큰 승리가 평균을 끌어올린 것인지를 확인하기 위한 것입니다. 아래 모든 수치는 ${baseline} 대비이며, 두 방식 모두 같은 실판매량으로 나눈 값입니다.`,
          `The pooled figure is a statement about the portfolio, not a promise about any SKU. This section is where you check whether the improvement is broad or whether a few large wins are carrying the average. Everything below compares against ${baseline}, with both methods divided by the same actual so the difference is like for like.`,
        )}
      />

      {/* Scope. Above everything, because every figure in the section is
          computed under it and a reader arriving mid-page needs to know what
          they are looking at before they read a number. */}
      <div className="flex flex-col gap-2 rounded-md border bg-muted/30 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="text-[12px] font-medium"
              title={pick(
                "채점 구간 동안 실제로 팔린 수량입니다. 오차율이 아닙니다.",
                "Units actually sold over the scored window. Not an error figure.",
              )}
            >
              {pick("최소 실판매량 (개)", "Minimum units sold")}
            </span>
            <div className="flex flex-wrap gap-1">
              {MIN_UNITS_PRESETS.map((v) => (
                <button key={v} type="button" onClick={() => setMinUnits(v)} className={pillClass(minUnits === v)}>
                  {v === 0 ? pick("전체", "no filter") : `${v}+`}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-medium">{pick("구간", "Window")}</span>
            <div className="flex flex-wrap gap-1">
              <button type="button" onClick={() => setWindow("all")} className={pillClass(window === "all")}>
                {pick("전체", "All")}
              </button>
              {windows.map((w) => (
                <button key={w} type="button" onClick={() => setWindow(w)} className={pillClass(window === w)}>
                  {w}
                </button>
              ))}
            </div>
          </div>
          {segments.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-medium">{pick("세그먼트", "Segment")}</span>
              <div className="flex flex-wrap gap-1">
                <button type="button" onClick={() => setSegment("all")} className={pillClass(segment === "all")}>
                  {pick("전체", "All")}
                </button>
                {segments.map((sg) => (
                  <button key={sg} type="button" onClick={() => setSegment(sg)} className={pillClass(segment === sg)}>
                    {sg}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {/* What the scope leaves out, always. A filtered figure with no statement
            of what it excluded is how a flattering subset gets read as the
            whole. */}
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          {pick(
            `${nf.format(all.n)}개 행 · 실판매 ${nf.format(Math.round(all.units))}개 (채점된 수요의 ${pct(outliers.scored_units ? all.units / outliers.scored_units : 0)}). ${excluded > 0 ? `${nf.format(excluded)}개 행이 위 조건에서 제외되었습니다.` : "제외된 행 없음."}`,
            `${nf.format(all.n)} scored SKU-windows · ${nf.format(Math.round(all.units))} units sold, ${pct(outliers.scored_units ? all.units / outliers.scored_units : 0)} of all scored demand. ${excluded > 0 ? `${nf.format(excluded)} rows fall outside this scope.` : "Nothing excluded."}`,
          )}
        </p>
      </div>

      {/* 1. The rates. Counted two ways because the two answer different
             questions, and the gap between them is itself the finding. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={pick("SKU 기준 승률", "Win rate, by SKU")}
          value={pct(all.winRows)}
          tone={all.winRows >= 0.5 ? "good" : "bad"}
          sub={pick(
            `${nf.format(Math.round(all.winRows * all.n))} / ${nf.format(all.n)}개 행에서 모델이 더 정확`,
            `${nf.format(Math.round(all.winRows * all.n))} of ${nf.format(all.n)} rows where the model is closer`,
          )}
        />
        <Stat
          label={pick("수요 기준 승률", "Win rate, by demand")}
          value={pct(all.winUnits)}
          tone={all.winUnits >= 0.5 ? "good" : "bad"}
          sub={pick(
            "모델이 이긴 행의 실판매 수량이 전체 실판매에서 차지하는 비중. SKU 기준보다 높다면 물량이 큰 쪽에서 이기고 있다는 뜻입니다.",
            "Share of units sold that sits on rows the model wins. Higher than the rate beside it means the wins are where the volume is.",
          )}
        />
        <Stat
          label={pick("합산 WAPE", "Pooled WAPE")}
          value={pct1(all.pooledCur)}
          tone={all.pooledCur < all.pooledBase ? "good" : "bad"}
          sub={pick(
            `${baseline} ${pct1(all.pooledBase)} · 이 범위에서 계산`,
            `${baseline} ${pct1(all.pooledBase)}, over this scope`,
          )}
        />
        <Stat
          label={pick("뚜렷한 악화", "Material regressions")}
          value={nf.format(all.nBad)}
          tone={all.nBad === 0 ? "good" : "bad"}
          sub={pick(
            `WAPE가 ${MATERIAL_REGRESSION * 100}%p(퍼센트 포인트) 이상 나빠진 행. 이 범위 실판매의 ${pct1(all.units ? all.badUnits / all.units : 0)}를 차지합니다.`,
            `rows where WAPE is more than ${MATERIAL_REGRESSION * 100} percentage points worse. They carry ${pct1(all.units ? all.badUnits / all.units : 0)} of the units sold in scope.`,
          )}
        />
      </div>

      {/* 2. The shape behind the rates. A win rate of 62% is the same number
             whether the losses are near-misses or catastrophes. */}
      <div className="rounded-md border">
        <div className="border-b px-3 py-2">
          <p className="text-[12.5px] font-semibold">
            {pick("SKU별 오차 차이 분포", "Distribution of per-SKU differences")}
          </p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {pick(
              `가로축은 모델 WAPE에서 ${baseline} WAPE를 뺀 값이며, 단위는 퍼센트 포인트입니다(판매 수량이 아닙니다). 왼쪽(음수)일수록 모델이 더 정확합니다. 승률은 좌우 비율만 말해 주지만, 이 그래프는 얼마나 차이 나는지까지 보여 줍니다.`,
              `The axis is model WAPE minus ${baseline} WAPE, in percentage points, not units sold. Further left is the model doing better. The win rates above say which side of zero each row falls; this says by how much.`,
            )}
          </p>
        </div>
        <div className="flex items-end gap-[3px] px-3 pb-2 pt-4" style={{ height: 150 }}>
          {histogram.map((b) => (
            <div key={b.label} className="group relative flex flex-1 flex-col justify-end" title={`${b.label}: ${nf.format(b.count)}`}>
              <div
                className={`w-full rounded-t ${
                  b.better
                    ? "bg-emerald-400/70 dark:bg-emerald-600/70"
                    : "bg-amber-400/70 dark:bg-amber-600/70"
                }`}
                style={{ height: `${Math.max(b.count > 0 ? 3 : 0, b.share * 100)}%` }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          <span>{pick("← 모델이 더 정확", "← model more accurate")}</span>
          <span>{pick("차이 없음", "no difference")}</span>
          <span>{pick("모델이 덜 정확 →", "model less accurate →")}</span>
        </div>
      </div>

      {/* 3. Where the rate comes from. A single number over everything hides a
             window or a segment that is dragging, which is the difference
             between a model problem and a period problem. */}
      <div className="grid gap-3 lg:grid-cols-2">
        {[
          { title: pick("백테스트 구간별", "By backtest window"), rows: byWindow },
          { title: pick("세그먼트별", "By segment"), rows: bySegment },
        ]
          .filter((g) => g.rows.length > 1)
          .map((g) => (
            <div key={g.title} className="rounded-md border">
              <p className="border-b px-3 py-2 text-[12.5px] font-semibold">{g.title}</p>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1.5 pl-3 pr-2 text-left font-medium">{pick("구분", "Group")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{pick("행", "Rows")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{pick("승률", "Win rate")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{pick("합산 WAPE", "Pooled")}</th>
                    <th className="py-1.5 pr-3 text-right font-medium">{baseline}</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.key} className="border-t">
                      <td className="py-1.5 pl-3 pr-2 text-[12.5px]">{r.key}</td>
                      <td className="py-1.5 pr-3 text-right text-[12.5px] tabular-nums text-muted-foreground">
                        {nf.format(r.n)}
                      </td>
                      <td className={`py-1.5 pr-3 text-right text-[12.5px] font-semibold tabular-nums ${
                        r.winRows >= 0.5 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                      }`}>
                        {pct(r.winRows)}
                      </td>
                      {/* Both pooled figures side by side, because a group can
                          lose on win rate and still win on pooled error, and
                          the reverse. Neither alone settles the group. */}
                      <td className={`py-1.5 pr-3 text-right text-[12.5px] font-semibold tabular-nums ${
                        r.pooledCur < r.pooledBase ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                      }`}>
                        {pct1(r.pooledCur)}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-[12.5px] tabular-nums text-muted-foreground">
                        {pct1(r.pooledBase)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </div>

      {/* 4. Every row. What replaced the two top-five lists: the same rows are
             still reachable by sorting on delta, and everything behind them is
             now reachable too. */}
      <div className="rounded-md border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
          <p className="text-[12.5px] font-semibold">
            {pick("전체 채점 결과", "Every scored SKU-window")}
          </p>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={pick("SKU 검색…", "Search SKU…")}
            className="h-8 w-52 rounded-md border bg-background px-2 font-mono text-[12.5px] outline-none focus:ring-2 focus:ring-ring"
          />
          <ColumnPicker columns={OPTIONAL_COLUMNS} visible={visible} onChange={changeVisible} />
          <span className="text-[11.5px] text-muted-foreground">
            {pick("열 제목을 우클릭해 정렬·필터·숨기기", "Right-click a column header to sort, filter, or hide it")}
          </span>
        </div>
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-muted/95 backdrop-blur">
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {th("unique_id", "SKU")}
                {vis("window") && th("window", pick("구간", "Window"))}
                {vis("y_total_cur") && th("y_total_cur", pick("실판매 (개)", "Units sold"), true)}
                {vis("wape_cur") && th("wape_cur", pick("모델 WAPE", "Model WAPE"), true)}
                {vis("wape_base") && th("wape_base", `${baseline} WAPE`, true)}
                {vis("delta") && th("delta", pick("차이 (%p)", "Diff (pp)"), true)}
              </tr>
            </thead>
            <tbody>
              {table.slice(0, limit).map((r) => (
                <tr key={`${r.unique_id}|${r.window}`} className="border-t hover:bg-muted/40">
                  <td className="py-1.5 pl-3 pr-3 text-[12.5px]">
                    <Link
                      href={`/planning/action-list/${encodeURIComponent(r.unique_id)}`}
                      className="font-mono underline-offset-2 hover:text-sky-600 hover:underline dark:hover:text-sky-400"
                    >
                      {r.unique_id}
                    </Link>
                  </td>
                  {vis("window") && (
                    <td className="py-1.5 pr-3 text-[12.5px] text-muted-foreground">{r.window}</td>
                  )}
                  {vis("y_total_cur") && (
                    <td className="py-1.5 pr-3 text-right text-[12.5px] tabular-nums text-muted-foreground">
                      {nf.format(Math.round(r.y_total_cur))}
                    </td>
                  )}
                  {vis("wape_cur") && (
                    <td className="py-1.5 pr-3 text-right text-[12.5px] tabular-nums">{pct(r.wape_cur)}</td>
                  )}
                  {vis("wape_base") && (
                    <td className="py-1.5 pr-3 text-right text-[12.5px] tabular-nums text-muted-foreground">
                      {pct(r.wape_base)}
                    </td>
                  )}
                  {/* The one place a raw delta is printed, and it carries a sign
                      and a colour so the direction cannot be misread. */}
                  {vis("delta") && (
                    <td
                      className={`py-1.5 pr-3 text-right text-[12.5px] font-semibold tabular-nums ${
                        r.delta < 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-amber-600 dark:text-amber-400"
                      }`}
                    >
                      {r.delta > 0 ? "+" : ""}{(r.delta * 100).toFixed(0)}
                      <span className="ml-0.5 text-[10.5px] font-normal opacity-70">pp</span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {table.length === 0 && (
            <p className="px-3 py-4 text-[12.5px] text-muted-foreground">
              {pick("이 조건에 해당하는 행이 없습니다.", "No scored rows match this scope.")}
            </p>
          )}
        </div>
        {table.length > limit && (
          <button
            type="button"
            onClick={() => setLimit((n) => n + 50)}
            className="w-full border-t py-2 text-[12.5px] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            {pick(
              `${nf.format(limit)} / ${nf.format(table.length)}개 표시 · 더 보기`,
              `Showing ${nf.format(limit)} of ${nf.format(table.length)} · show more`,
            )}
          </button>
        )}
      </div>
    </section>
  );
}
