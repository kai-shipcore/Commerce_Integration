/**
 * Code Guide:
 * CSV export for the two Action List tables.
 *
 * Both exports previously built their header from `Object.keys(view[0])`, so the
 * file carried every field on the row in whatever order the API returned them:
 * about forty columns for the forecast table, including `forecast_over_recent`,
 * `gap_closable_by_order`, `n_windows`, `error_basis` and `supply_gap_days`.
 * Someone who filtered the list and exported it got a different artefact from
 * the one they had been reading, headed by internal field names. A column called
 * `gap_closable_by_order` in a spreadsheet sent to a supplier is worse than
 * absent (BACKLOG item 5).
 *
 * The export is read by a person, not loaded by a downstream system, so the
 * headers are the human labels and the column set is chosen rather than derived.
 *
 * Chosen how. The nine table columns, plus identity and priority, plus the three
 * fields that are deliberately NOT table columns but are useful in a spreadsheet:
 * the inbound ETA and the estimated stockout date, which the screen shows as a
 * relative "in N days" because that is what a planner reads at a glance, and the
 * draft ETA, which the screen carries in a tooltip. A sheet is where someone
 * works out dates against a calendar, so the absolute form earns its place there
 * even though the relative one wins on screen.
 *
 * Left out on purpose: the intermediate terms of the order arithmetic
 * (`safety_stock`, `inbound_in_window`, `error_used`), the model's internal
 * diagnostics (`n_windows`, `error_basis`, `forecast_over_recent`), and the
 * booleans that exist to drive UI (`has_supply_gap`, `gap_closable_by_order`).
 * Anyone who needs those is debugging the recommendation, and the SKU detail
 * page shows the arithmetic properly. Reopen this list if someone is exporting
 * to rebuild that by hand.
 */

/** One exported column: a bilingual header and how to read the value. */
export interface CsvColumn<T> {
  header: [string, string];
  value: (row: T) => string | number | boolean | null | undefined;
}

/** RFC 4180 escaping.
 *
 * The previous implementation quoted only when the value contained a comma,
 * which leaves a value carrying a quote or a newline to break the row silently.
 * Product names are free text and reach this function, so that is reachable
 * rather than theoretical.
 */
function cell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "Yes" : "";
  const s = String(v);
  return /[",\n\r]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build and download the file.
 *
 * The BOM is not decoration. Excel on Windows reads a CSV without one as the
 * system code page, so every Korean heading and product name arrives as
 * mojibake, and this application ships a full Korean locale. Numbers are written
 * unformatted for the same class of reason: "1,117" is text to a spreadsheet and
 * cannot be summed, so thousands separators belong on screen and not here.
 */
export function downloadCsv<T>(
  rows: T[],
  columns: CsvColumn<T>[],
  filenameStem: string,
  pick: (ko: string, en: string) => string,
): void {
  if (!rows.length) return;

  const csv = [
    columns.map((c) => cell(pick(c.header[0], c.header[1]))).join(","),
    ...rows.map((r) => columns.map((c) => cell(c.value(r))).join(",")),
  ].join("\r\n");

  // Dated, because the whole point of the export is a snapshot of a list that
  // changes weekly, and three files all called action-list.csv in a downloads
  // folder cannot be told apart.
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenameStem}-${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Percent, rounded, as a NUMBER so the column stays sortable and summable.
 *  The unit lives in the header instead of on every cell. */
function pct(v: number | null | undefined): number | null {
  return v === null || v === undefined ? null : Math.round(v * 1000) / 10;
}

/** Forecastable SKUs. Ordered as the row reads on screen: who it is, how urgent,
 *  what is in position, what demand is doing, what to do about it. */
export const ACTION_LIST_COLUMNS: CsvColumn<import("./types").ActionListRow>[] = [
  { header: ["SKU", "SKU"], value: (r) => r.unique_id },
  { header: ["카테고리", "Category"], value: (r) => r.product_category },
  { header: ["우선순위", "Priority"], value: (r) => r.priority_label },
  // Blank rather than "No": it marks a set, and a column of No reads as a
  // judgement on the SKUs that are merely ordinary.
  { header: ["베스트셀러", "Best seller"], value: (r) => (r.best_seller ? "Yes" : "") },

  { header: ["가용 재고", "Available"], value: (r) => r.available_inventory },
  { header: ["선주문 잔량", "Preorder backlog"], value: (r) => r.preorder_backlog },
  { header: ["확정 입고", "Confirmed inbound"], value: (r) => r.confirmed_inbound },
  { header: ["입고 예정일", "Inbound ETA"], value: (r) => r.inbound_eta },
  // Draft units are not committed and are never subtracted from the
  // recommendation. Exported beside it for the same reason they are displayed
  // beside it: so the reader sees an order already exists without the
  // recommendation quietly assuming it will arrive.
  { header: ["초안 발주량", "Drafted units"], value: (r) => r.draft_inbound },
  { header: ["초안 입고 예정일", "Draft ETA"], value: (r) => r.draft_eta },

  { header: ["4주 판매량", "4-week sales"], value: (r) => r.recent_units },
  // The bucketed word, not the raw 4wk/12wk ratio. In a spreadsheet "falling"
  // is legible where 0.62 needs the manual open beside it.
  { header: ["추세", "Trend"], value: (r) => r.demand_state },
  { header: ["기간 수요", "Demand in window"], value: (r) => r.coverage_demand },

  { header: ["품절까지 일수", "Days to stockout"], value: (r) => r.days_to_stockout },
  { header: ["예상 품절일", "Estimated stockout date"], value: (r) => r.estimated_stockout_date },
  { header: ["권장 발주량", "Recommended order"], value: (r) => r.recommended_order_qty },
  { header: ["신뢰도", "Reliability"], value: (r) => r.tier },
  { header: ["예측 오차 %", "Forecast error %"], value: (r) => pct(r.wape) },
  { header: ["데이터 경고", "Data flags"], value: (r) => r.flags.join("; ") },
];

/** SKUs with no forecast. Every figure here is actual sales, and the headers say
 *  so, because the one thing this table must not do is read as a forecast. */
export const NOT_FORECAST_COLUMNS: CsvColumn<import("./types").NotForecastRow>[] = [
  { header: ["SKU", "SKU"], value: (r) => r.unique_id },
  { header: ["카테고리", "Category"], value: (r) => r.product_category },
  { header: ["13주 실판매량", "13-week actual sales"], value: (r) => r.recent_units },
  { header: ["주당 판매량", "Weekly rate"], value: (r) => r.weekly_rate },
  { header: ["최종 판매 주", "Last sale week"], value: (r) => r.last_sale_week },
  { header: ["가용 재고", "Available"], value: (r) => r.available_inventory },
  { header: ["선주문 잔량", "Preorder backlog"], value: (r) => r.preorder_backlog },
  { header: ["확정 입고", "Confirmed inbound"], value: (r) => r.confirmed_inbound },
  { header: ["입고 예정일", "Inbound ETA"], value: (r) => r.inbound_eta },
  { header: ["재고 소진 일수", "Days of cover"], value: (r) => r.days_of_cover },
  // A timing statement, not a quantity to buy, and the header says which.
  { header: ["리드타임 내 소진", "Runs out within lead time"], value: (r) => (r.reorder_signal ? "Yes" : "") },
];
