"use client";

/**
 * Code Guide:
 * The non-forecast section body — fetches /api/planning/not-forecast and renders
 * its own summary and table.
 *
 * Loaded only when the section is opened. It covers roughly seven times as many
 * SKUs as the forecast list, and fetching it alongside would make the page the
 * user actually asked for wait on data they may never look at.
 *
 * The explanatory line at the top is not decoration. Every other planning screen
 * in the app leads with a forecast, and a reader arriving here needs to know
 * within one sentence that these figures come from recent sales instead, or they
 * will read the cover figure as though it carried the same weight.
 */

import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import {
  NF_DEFAULT_SORT, NotForecastTable, nfNextSort, nfSortRows,
  type NfSort, type NfSortKey,
} from "./not-forecast-table";
import { planningQuery, type ActionListParams, type NotForecastResponse } from "./types";

const nf = new Intl.NumberFormat("en-US");

type NfFocus = "all" | "selling" | "dormant" | "reorder" | "no-stock";

export function NotForecastSection({ planning }: { planning: ActionListParams }) {
  const { pick } = useI18n();
  const query = planningQuery(planning);

  const [state, setState] = useState<{
    key: string;
    data: NotForecastResponse | null;
    error: string | null;
  }>({ key: "", data: null, error: null });

  const [focus, setFocus] = useState<NfFocus>("all");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<NfSort[]>(NF_DEFAULT_SORT);
  const [limit, setLimit] = useState(200);

  useEffect(() => {
    const controller = new AbortController();
    fetch(apiPath(`/api/planning/not-forecast?${query}`), { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.detail || body?.error || `HTTP ${res.status}`);
        return body as NotForecastResponse;
      })
      .then((body) => setState({ key: query, data: body, error: null }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ key: query, data: null, error: err instanceof Error ? err.message : String(err) });
      });
    return () => controller.abort();
  }, [query]);

  const loading = state.key !== query;
  const data = state.data;

  const categories = useMemo(() => {
    if (!data) return [];
    return Array.from(
      new Set(data.rows.map((r) => r.product_category).filter(Boolean) as string[]),
    ).sort();
  }, [data]);

  const view = useMemo(() => {
    if (!data) return [];
    let rows = data.rows;
    if (focus === "selling") rows = rows.filter((r) => r.recent_units > 0);
    else if (focus === "dormant") rows = rows.filter((r) => r.recent_units <= 0);
    else if (focus === "reorder") rows = rows.filter((r) => r.reorder_signal);
    else if (focus === "no-stock") rows = rows.filter((r) => r.available_inventory === 0);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) => r.unique_id.toLowerCase().includes(q) || (r.product_name ?? "").toLowerCase().includes(q),
      );
    }
    if (category !== "all") rows = rows.filter((r) => r.product_category === category);
    return nfSortRows(rows, sort);
  }, [data, focus, search, category, sort]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {pick("불러오는 중…", "Loading…")}
      </div>
    );
  }

  if (state.error) {
    return (
      <Card><CardContent className="p-6 text-sm">
        <p className="font-medium text-red-600 dark:text-red-400">
          {pick("불러올 수 없습니다.", "Could not load this section.")}
        </p>
        <p className="mt-1 text-muted-foreground">{state.error}</p>
      </CardContent></Card>
    );
  }

  if (!data) return null;

  const m = data.metrics;
  const chips: { key: NfFocus; label: string; value: number }[] = [
    { key: "all", label: pick("전체", "not forecast"), value: m.skus },
    { key: "selling", label: pick("최근 판매 있음", "selling"), value: m.selling },
    { key: "dormant", label: pick("판매 없음", "dormant"), value: m.dormant },
    { key: "reorder", label: pick("리드타임 내 소진", "runs out in lead time"), value: m.reorder_signal },
    { key: "no-stock", label: pick("재고 없음", "no stock"), value: m.out_of_stock },
  ];

  const exportCsv = () => {
    if (!view.length) return;
    const cols = Object.keys(view[0]);
    const csv = [
      cols.join(","),
      ...view.map((r) =>
        cols.map((c) => {
          const v = (r as unknown as Record<string, unknown>)[c];
          const s = v === null || v === undefined ? "" : String(v);
          return s.includes(",") ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "not-forecast.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-md border border-dashed bg-muted/30 p-3 text-[11.5px] leading-relaxed text-muted-foreground">
        {pick(
          `이 SKU들은 판매가 불규칙해 주간 예측 대상이 아닙니다. 아래 수치는 예측이 아니라 최근 ${data.meta.window_weeks}주 실판매에서 계산한 것으로, 예측 오차 개념이 없습니다. 발주 권장 수량이 없는 것은 누락이 아니라, 예측 없이는 산출할 수 없기 때문입니다. "재고 여유"는 최근 판매 속도가 유지된다는 가정하의 값입니다.`,
          `These SKUs sell too irregularly to forecast weekly, so nothing below comes from the model. The figures are computed from the last ${data.meta.window_weeks} weeks of actual sales and carry no forecast error. There is no recommended order quantity, which is the honest answer rather than an omission: it cannot be derived without a demand model. "Cover" assumes the recent rate holds.`,
        )}
      </p>

      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setFocus(c.key)}
            className={`rounded-md border px-3 py-1.5 text-left transition-colors ${
              focus === c.key ? "border-sky-400 bg-sky-50 dark:border-sky-700 dark:bg-sky-950" : "hover:bg-muted/60"
            }`}
          >
            <span className="block text-base font-semibold tabular-nums">{nf.format(c.value)}</span>
            <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{c.label}</span>
          </button>
        ))}
        <div className="rounded-md border border-dashed px-3 py-1.5">
          <span className="block text-base font-semibold tabular-nums">{nf.format(m.recent_units)}</span>
          <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
            {pick(`${data.meta.window_weeks}주 판매`, `units, ${data.meta.window_weeks}w`)}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
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
        <button
          type="button"
          onClick={() => { setFocus("all"); setSearch(""); setCategory("all"); setSort(NF_DEFAULT_SORT); }}
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
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {pick(
            `${nf.format(data.rows.length)}개 중 ${nf.format(view.length)}개`,
            `${nf.format(view.length)} of ${nf.format(data.rows.length)} SKUs`,
          )}
        </span>
      </div>

      {view.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          {pick("조건에 맞는 SKU가 없습니다.", "No SKUs match these filters.")}
        </CardContent></Card>
      ) : (
        <>
          <NotForecastTable
            rows={view.slice(0, limit)}
            sort={sort}
            onSort={(key: NfSortKey, shiftKey: boolean) => setSort((prev) => nfNextSort(prev, key, shiftKey))}
          />
          {view.length > limit && (
            // Capped rather than paginated. Thousands of rows in one DOM makes
            // the page unusable, and paging through an intermittent tail is not
            // how anyone works with it: filter or sort to what matters instead.
            <button
              type="button"
              onClick={() => setLimit((n) => n + 200)}
              className="self-center rounded-md border px-3 py-1.5 text-xs hover:bg-muted/60"
            >
              {pick(
                `${nf.format(Math.min(200, view.length - limit))}개 더 보기 (${nf.format(view.length - limit)}개 남음)`,
                `Show ${nf.format(Math.min(200, view.length - limit))} more (${nf.format(view.length - limit)} remaining)`,
              )}
            </button>
          )}
        </>
      )}
    </div>
  );
}
