export type CategoryFilter = "sc" | "cc" | "fm" | "ac" | "swc";
export type BaseCategoryFilter = "sc" | "cc" | "fm" | "ac";
export type UrgencyFilter = "crit" | "warn" | "bo" | "over";
export type UrgencyStatus = "crit" | "warn" | "ok" | "over";
export type ColumnGroupKey =
  | "fix"
  | "stock"
  | "wsales"
  | "esales"
  | "fbasales"
  | "wavg"
  | "eavg"
  | "fba"
  | "s30"
  | "tavg"
  | "oos"
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
  allocated_remaining_qty?: number | null;
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
  pinned?: true;
  container_info: string;
  cbm: number;
  seat: string;
  no: number;
  color: string;
  tone: string;
  back: number;
  sales_status:
    | "Original" | "Custom" | "Hold" | "Part" | "Discontinued" | "TBD" | "SWC"
    // Floor mat statuses set on the SKU Master page (see src/lib/planning/floor-mat-sets.ts).
    | "1+2 Set" | "1+2+3 Set" | "1st Row" | "2nd Row" | "3rd Row";
  category_code?: "SC" | "CC" | "FM" | "AC" | "SWC";
  sku: string;
  /**
   * Legacy master SKUs (TN / BKGR) whose sales and available stock (West,
   * East, Transit — not back orders) are included in this row's figures,
   * because the factory now only produces this SKU and the legacy units ship
   * against it. Their own rows keep their own figures too — each SKU still
   * has to be tracked — so the same units appear twice across the grid by
   * design.
   */
  rolled_up_from?: string[];
  /** Per-warehouse figures are null on a historical (As of) view: the
   *  inventory history carries SKU totals only, so there is nothing to split
   *  them by. total_stock stays populated. */
  west_stock: number | null;
  east_stock: number | null;
  west_available_stock?: number | null;
  east_available_stock?: number | null;
  /** Always current — transit has no history to replay. */
  transit_stock?: number;
  fullerton_stock?: number | null;
  canary_stock?: number | null;
  ttm_stock?: number | null;
  ttm_jeff_stock?: number | null;
  dream_trans_stock?: number | null;
  linkone_stock?: number | null;
  fullerton_available_stock?: number | null;
  canary_available_stock?: number | null;
  ttm_available_stock?: number | null;
  ttm_jeff_available_stock?: number | null;
  dream_trans_available_stock?: number | null;
  linkone_available_stock?: number | null;
  total_stock: number;
  stock_mode?: 'onhand' | 'available';
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
  fba_avg_prev: number;
  fba_avg_real: number;
  fba_avg_curr: number;
  fba_90d_sales?: number;
  fba_60d_sales?: number;
  fba_30d_sales?: number;
  fba_15d_sales?: number;
  fba_7d_sales?: number;
  fba_30d_pre?: number;
  west_fbm_30d: number;
  east_fbm_30d: number;
  fba_30d: number;
  total_30d: number;
  total_avg_prev: number;
  total_avg_real: number;
  total_avg_curr: number;
  total_avg_prev_auto?: number;
  total_avg_real_auto?: number;
  total_avg_prev_override?: number | null;
  total_avg_real_override?: number | null;
  total_avg_curr_auto?: number;
  total_avg_curr_override?: number | null;
  /** Registered floor from the Min Sales page, or null when the SKU is not registered. */
  total_avg_curr_min?: number | null;
  /** True when total_avg_curr shows the minimum because the calculated value was below it (and no manual override is set). */
  total_avg_curr_min_applied?: boolean;
  /**
   * Target inventory life (days) from the Replacing Soon page, or null when the
   * SKU is not registered. The auto-fill calculations use it instead of the
   * sales-range / gradient target, so a SKU about to be replaced is not overstocked.
   */
  replacing_soon_days?: number | null;
  /** Successor SKU noted on the Replacing Soon page (informational). */
  replacing_soon_replacement_sku?: string | null;
  replacing_soon_note?: string | null;
  oos_days_90d: number | null;
  oos_lost_demand_90d: number | null;
  cbm_per_unit?: number;
  case_qty?: number;
  moq?: number;
  order_multiple?: number;
  remaining?: number;
  mistake?: number;
  total_inbound_qty: number | null;
  containers_list: string | null;
  next_eta: string | null;
  sod: string | null;
  sod_days_raw?: number;
  memo?: string | null;
  workflow_note?: string | null;
  workflow_note_2?: string | null;
  workflow_note_3?: string | null;
  containers: Record<string, ContainerRowData>;
}

export interface DemandPlanningData {
  containers: ContainerMeta[];
  rows: DemandRow[];
  pinned_rows?: DemandRow[];
  last_sync: string | null;
  /** When the velocity snapshot behind the sales columns was last pulled
   *  from Supabase (LA time). Trails last_sync only if that pull was skipped. */
  sales_synced_at?: string | null;
  /** The date the figures are computed against — the As of date, or today. */
  as_of?: string;
  /** True when stock figures came from the inventory history rather than
   *  fc_stats, i.e. the per-warehouse columns are blank and transit,
   *  remaining/mistake and the containers are still current. */
  inventory_historical?: boolean;
  /** Newest day the replayed inventory actually came from. The history only
   *  records a SKU on days it moved, so this trails the As of date. */
  inventory_snapshot_date?: string | null;
  /** Earliest date the history carries quantities; before it the view holds
   *  zeroes written for out-of-stock tracking only. */
  inventory_history_min_date?: string | null;
  /** Oldest order date the velocity snapshots still hold. */
  sales_history_min_date?: string | null;
  /** Earliest As of date that returns a complete answer on both counts —
   *  what the date picker offers as its lower bound. */
  as_of_min_date?: string | null;
}

/** Sparse raw detail rows; absent SKUs have an empty container map. */
export interface DemandPlanningContainerDetails {
  containers: ContainerMeta[];
  rows: Array<Pick<DemandRow, "sku" | "containers">>;
}
