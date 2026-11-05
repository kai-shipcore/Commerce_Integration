import type { DemandRow } from "@/types/demand-planning";
import type { FormulaValue } from "./custom-formulas";

// Stable column IDs, not screen positions or formatted/rounded cell strings.
const fields = new Map<string, keyof DemandRow>(Object.entries({
  cont_info: "container_info", qty_ctn: "case_qty", cbm: "cbm_per_unit",
  workflow_note: "workflow_note", workflow_note_2: "workflow_note_2", workflow_note_3: "workflow_note_3",
  back: "back", status: "sales_status", sku: "sku",
  fullerton: "fullerton_available_stock", canary: "canary_available_stock", ttm: "ttm_available_stock",
  ttm_jeff: "ttm_jeff_available_stock", dream_trans: "dream_trans_available_stock", linkone: "linkone_available_stock", west: "west_available_stock", east: "east_available_stock",
  total: "total_stock", transit: "transit_stock",
  w90: "west_90d", w60: "west_60d", w30: "west_30d", w15: "west_15d", w7: "west_7d", wpre: "west_30d_pre",
  e90: "east_90d", e60: "east_60d", e30: "east_30d", e15: "east_15d", e7: "east_7d", epre: "east_30d_pre",
  f90: "fba_90d_sales", f60: "fba_60d_sales", f30: "fba_30d_sales", f15: "fba_15d_sales", f7: "fba_7d_sales", fpre: "fba_30d_pre",
  wavg_p: "avg_daily_prev", wavg_r: "avg_daily_real", wavg_c: "avg_daily_curr",
  eavg_p: "east_avg_prev", eavg_r: "east_avg_real", eavg_c: "east_avg_curr",
  fba_p: "fba_avg_prev", fba_r: "fba_avg_real", fba_c: "fba_avg_curr",
  tavg_p: "total_avg_prev", tavg_r: "total_avg_real", tavg_c: "total_avg_curr",
  wfbm30: "west_fbm_30d", efbm30: "east_fbm_30d", fba30: "fba_30d", tot30: "total_30d",
  oos_days: "oos_days_90d", oos_lost: "oos_lost_demand_90d",
  inb_qty: "total_inbound_qty", inb_lst: "containers_list", next_eta: "next_eta", sod: "sod",
} satisfies Record<string, keyof DemandRow>));

export function isFormulaBaseField(id: string): boolean { return fields.has(id); }
export function formulaBaseValue(row: DemandRow, id: string): FormulaValue | undefined {
  const key = fields.get(id);
  if (!key) return undefined;
  if (id === "qty_ctn") return row.case_qty ?? 1;
  const value = row[key];
  return value === undefined || value === null ? null : typeof value === "number" || typeof value === "string" ? value : undefined;
}
