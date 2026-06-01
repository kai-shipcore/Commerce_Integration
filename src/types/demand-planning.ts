export type ProductFilter = "all" | "orig" | "cust";
export type CategoryFilter = "sc" | "cc" | "fm";
export type UrgencyFilter = "crit" | "warn" | "bo";
export type UrgencyStatus = "crit" | "warn" | "ok";
export type ColumnGroupKey =
  | "fix"
  | "stock"
  | "wsales"
  | "esales"
  | "wavg"
  | "eavg"
  | "fba"
  | "s30"
  | "tavg"
  | "inb"
  | "con";

export interface ContainerMeta {
  col: number;
  container_id?: number;
  name: string;
  eta: string;
  cbm_cap: number;
  status?: string;
  categories?: string[];  // category_code values present in this container, e.g. ['SC','CC']
}

export interface ContainerRowData {
  item_id?: number | null;       // fc_container_items.id — used for inline editing
  cbm_unit?: number | null;      // fc_container_items.cbm_unit — used to recompute total_cbm on qty edit
  inbound_qty?: number | null;   // fc_container_items.qty — raw units in this container
  open_orders: number | null;
  avail_qty: number | null;
  est_sales: number | null;
  backorder: number | null;
  carryover?: number | null;
  eta: string | null;
  inv_life: number | null;
  est_sod: string | null;
  plan_sod: string | null;
  cbm: number | null;
}

export interface DemandRow {
  container_info: string;
  cbm: number;
  seat: string;
  no: number;
  color: string;
  tone: string;
  back: number;
  sales_status: "Original" | "Custom" | "Hold";
  category_code?: "SC" | "CC" | "FM";
  sku: string;
  west_stock: number;
  east_stock: number;
  total_stock: number;
  west_90d: number;
  west_60d: number;
  west_30d: number;
  west_15d: number;
  west_7d: number;
  west_30d_pre: number;
  east_90d: number;
  east_60d: number;
  east_30d: number;
  east_15d: number;
  east_7d: number;
  east_30d_pre: number;
  avg_daily_prev: number;
  avg_daily_real: number;
  avg_daily_curr: number;
  east_avg_prev: number;
  east_avg_real: number;
  east_avg_curr: number;
  fba_avg_real: number;
  fba_avg_curr: number;
  west_fbm_30d: number;
  east_fbm_30d: number;
  fba_30d: number;
  total_30d: number;
  total_avg_prev: number;
  total_avg_real: number;
  total_avg_curr: number;
  cbm_per_unit?: number;
  moq?: number;
  order_multiple?: number;
  remaining?: number;
  mistake?: number;
  total_inbound_qty: number | null;
  containers_list: string | null;
  next_eta: string | null;
  sod: string | null;
  containers: Record<string, ContainerRowData>;
}

export interface DemandPlanningData {
  containers: ContainerMeta[];
  rows: DemandRow[];
  last_sync: string | null;
}
