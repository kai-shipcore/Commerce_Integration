import { differenceInCalendarDays, parseISO } from "date-fns";
import { planningLocalDateString } from "@/lib/planning/date-utils";
import type { ColumnGroupKey, ContainerMeta, ContainerRowData, DemandRow, UrgencyStatus } from "@/types/demand-planning";

export const TINT_COLORS: Record<string, string> = {
  "t-stock":   "#F5F9FF",
  "t-wsales":  "#F5FBF7",
  "t-esales":  "#FAF5FF",
  "t-avg":     "#FFFEF0",
  "t-total":   "#F5FCFC",
  "t-inb":     "#FDF5FF",
  "t-cn":      "#F0F9FF",
  "t-cn-life": "#EAF6FF",
  "t-cn-sod":  "#E5F3FF",
};

export const GROUP_HEADER_COLORS: Record<string, string> = {
  "gh-fix":    "#1E1C19",
  "gh-stock":  "#1A3555",
  "gh-wsales": "#153028",
  "gh-esales": "#2A1E42",
  "gh-avg":    "#303010",
  "gh-total":  "#182828",
  "gh-inb":    "#281828",
  "gh-con":    "#0D2535",
};

export const GROUP_LABELS: Record<string, string> = {
  fix:    "Basic Info",
  stock:  "Inventory",
  wsales: "West FBM Sales",
  esales: "East FBM Sales",
  wavg:   "West Avg Daily",
  eavg:   "East Avg Daily",
  fba:    "FBA Avg",
  s30:    "Sales 30D",
  tavg:   "Total Avg Daily",
  inb:    "입고 / 컨테이너 / SOD",
};

export const GROUP_BTN_COLORS: Record<string, string> = {
  wsales: "#153028",
  esales: "#2A1E42",
  wavg:   "#2C2A10",
  eavg:   "#2C2A10",
  fba:    "#1E2A10",
  s30:    "#182828",
  tavg:   "#1A2818",
  inb:    "#281828",
  con:    "#0D2535",
};

export const TODAY = planningLocalDateString();

export function daysTo(d: string | null | undefined): number | null {
  if (!d) return null;
  try {
    return differenceInCalendarDays(parseISO(d), parseISO(TODAY));
  } catch {
    return null;
  }
}

export function urgStatus(row: DemandRow): UrgencyStatus {
  if ((row.back ?? 0) < 0) return "crit";
  const dt = daysTo(row.sod);
  if (dt !== null && dt <= 30) return "crit";
  if (dt !== null && dt <= 60) return "warn";
  return "ok";
}

export function lifeCls(v: number | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (v <= 30) return "lv-crit";
  if (v <= 60) return "lv-warn";
  if (v > 90) return "lv-over";
  return "lv-ok";
}

export function compactContainerList(value: string | null | undefined): string {
  if (!value) return "";

  return value
    .split(",")
    .map((entry) => {
      const trimmed = entry.trim();
      const match = trimmed.match(/^(\d+)(?:-[^(]+)?(\s*\([^)]*\))?$/);
      return match ? `${match[1]}${match[2] ?? ""}` : trimmed;
    })
    .join(", ");
}

function avgOrBlank(value: number | null | undefined): number | "" {
  return value === null || value === undefined ? "" : value;
}

export type CellContent =
  | string
  | number
  | { html: string }
  | null;

export interface ColDef {
  id: string;
  grp: ColumnGroupKey;
  label: string;
  w: number;
  align: "num" | "ctr" | "left";
  tint: string;
  gh: string;
  bold?: boolean;
  fontSize?: number;
  val: (row: DemandRow, idx: number, urg: UrgencyStatus) => CellContent;
}

export interface ConSubColDef {
  id: string;
  label: string;
  w: number;
  align: "num" | "ctr" | "left";
  tint: string;
  val: (cd: ContainerRowData, container: ContainerMeta, row: DemandRow) => CellContent;
}

export const ALL_COLS: ColDef[] = [
  // Always-visible base columns
  { id: "row_num",   grp: "fix", label: "#",                w: 36,  align: "num",  tint: "",        gh: "gh-fix",    val: (_r, i) => i + 1 },
  { id: "cont_info", grp: "fix", label: "Container\nInfo.", w: 190, align: "left", tint: "",        gh: "gh-fix",    fontSize: 10, val: (r) => r.container_info || "" },
  { id: "cbm",       grp: "fix", label: "CBM",              w: 56,  align: "num",  tint: "",        gh: "gh-fix",    val: (r) => r.cbm_per_unit ? r.cbm_per_unit.toFixed(4) : "" },
  { id: "back",      grp: "fix", label: "Back",             w: 38,  align: "num",  tint: "",        gh: "gh-fix",    val: (r) => { const b = r.back || 0; return b < 0 ? { html: `<span class="bo-pos">${b}</span>` } : (b || ""); } },
  { id: "status",    grp: "fix", label: "Sales\nStatus",    w: 72,  align: "ctr",  tint: "",        gh: "gh-fix",    val: (r) => ({ html: `<span class="sc ${r.sales_status === "Custom" ? "sc-cust" : r.sales_status === "Hold" ? "sc-hold" : "sc-orig"}">${r.sales_status || ""}</span>` }) },
  { id: "sku",       grp: "fix", label: "Master SKU",       w: 180, align: "left", tint: "",        gh: "gh-fix",    val: (r, _i, u) => ({ html: `<span class="dot ${u === "crit" ? "d-crit" : u === "warn" ? "d-warn" : "d-ok"}"></span>${r.sku}` }) },
  { id: "west",      grp: "stock", label: "West\nStock",      w: 52,  align: "num",  tint: "t-stock", gh: "gh-stock",  val: (r) => r.west_stock || 0 },
  { id: "east",      grp: "stock", label: "East\nStock",      w: 46,  align: "num",  tint: "t-stock", gh: "gh-stock",  val: (r) => r.east_stock || 0 },
  { id: "total",     grp: "stock", label: "Total\nStock",     w: 50,  align: "num",  tint: "t-stock", gh: "gh-stock",  val: (r) => r.total_stock || 0, bold: true },
  // West Sales
  { id: "w90",  grp: "wsales", label: "West\n90D",  w: 44, align: "num", tint: "t-wsales", gh: "gh-wsales", val: (r) => r.west_90d || 0 },
  { id: "w60",  grp: "wsales", label: "West\n60D",  w: 44, align: "num", tint: "t-wsales", gh: "gh-wsales", val: (r) => r.west_60d || 0 },
  { id: "w30",  grp: "wsales", label: "West\n30D",  w: 44, align: "num", tint: "t-wsales", gh: "gh-wsales", val: (r) => r.west_30d || 0, bold: true },
  { id: "w15",  grp: "wsales", label: "West\n15D",  w: 42, align: "num", tint: "t-wsales", gh: "gh-wsales", val: (r) => r.west_15d || 0 },
  { id: "w7",   grp: "wsales", label: "West\n7D",   w: 40, align: "num", tint: "t-wsales", gh: "gh-wsales", val: (r) => r.west_7d || 0 },
  { id: "wpre", grp: "wsales", label: "W Pre\n30D", w: 38, align: "num", tint: "t-wsales", gh: "gh-wsales", val: (r) => r.west_30d_pre || 0 },
  // East Sales
  { id: "e90",  grp: "esales", label: "East\n90D",  w: 44, align: "num", tint: "t-esales", gh: "gh-esales", val: (r) => r.east_90d || 0 },
  { id: "e60",  grp: "esales", label: "East\n60D",  w: 44, align: "num", tint: "t-esales", gh: "gh-esales", val: (r) => r.east_60d || 0 },
  { id: "e30",  grp: "esales", label: "East\n30D",  w: 44, align: "num", tint: "t-esales", gh: "gh-esales", val: (r) => r.east_30d || 0, bold: true },
  { id: "e15",  grp: "esales", label: "East\n15D",  w: 42, align: "num", tint: "t-esales", gh: "gh-esales", val: (r) => r.east_15d || 0 },
  { id: "e7",   grp: "esales", label: "East\n7D",   w: 40, align: "num", tint: "t-esales", gh: "gh-esales", val: (r) => r.east_7d || 0 },
  { id: "epre", grp: "esales", label: "E Pre\n30D", w: 38, align: "num", tint: "t-esales", gh: "gh-esales", val: (r) => r.east_30d_pre || 0 },
  // West Avg Daily
  { id: "wavg_p", grp: "wavg", label: "W Avg\n이전", w: 56, align: "num", tint: "t-avg", gh: "gh-avg", val: (r) => r.avg_daily_prev || "" },
  { id: "wavg_r", grp: "wavg", label: "W Avg\n실제", w: 56, align: "num", tint: "t-avg", gh: "gh-avg", val: (r) => avgOrBlank(r.avg_daily_real) },
  { id: "wavg_c", grp: "wavg", label: "W Avg\n현재", w: 56, align: "num", tint: "t-avg", gh: "gh-avg", bold: true, val: (r) => {
    const v = avgOrBlank(r.avg_daily_curr);
    if (v === "") return "";
    if (v >= 10) return { html: `<span class="lv-crit">${v}</span>` };
    if (v >= 5)  return { html: `<span class="lv-warn">${v}</span>` };
    return v;
  }},
  // East Avg Daily
  { id: "eavg_p", grp: "eavg", label: "E Avg\n이전", w: 56, align: "num", tint: "t-avg", gh: "gh-avg", val: (r) => r.east_avg_prev || "" },
  { id: "eavg_r", grp: "eavg", label: "E Avg\n실제", w: 56, align: "num", tint: "t-avg", gh: "gh-avg", val: (r) => avgOrBlank(r.east_avg_real) },
  { id: "eavg_c", grp: "eavg", label: "E Avg\n현재", w: 56, align: "num", tint: "t-avg", gh: "gh-avg", bold: true, val: (r) => avgOrBlank(r.east_avg_curr) },
  // FBA Avg
  { id: "fba_r", grp: "fba", label: "FBA\n실제", w: 56, align: "num", tint: "t-avg", gh: "gh-avg", val: (r) => avgOrBlank(r.fba_avg_real) },
  { id: "fba_c", grp: "fba", label: "FBA\n현재", w: 56, align: "num", tint: "t-avg", gh: "gh-avg", val: (r) => avgOrBlank(r.fba_avg_curr) },
  // 30D Sales
  { id: "wfbm30", grp: "s30", label: "W FBM\n30D",  w: 50, align: "num", tint: "t-total", gh: "gh-total", val: (r) => r.west_fbm_30d || 0 },
  { id: "efbm30", grp: "s30", label: "E FBM\n30D",  w: 44, align: "num", tint: "t-total", gh: "gh-total", val: (r) => r.east_fbm_30d || 0 },
  { id: "fba30",  grp: "s30", label: "FBA\n30D",    w: 40, align: "num", tint: "t-total", gh: "gh-total", val: (r) => r.fba_30d || 0 },
  { id: "tot30",  grp: "s30", label: "Total\n30D",  w: 52, align: "num", tint: "t-total", gh: "gh-total", bold: true, val: (r) => r.total_30d || 0 },
  // Total Avg Daily
  { id: "tavg_p", grp: "tavg", label: "T.Avg\n이전", w: 56, align: "num", tint: "t-total", gh: "gh-total", val: (r) => r.total_avg_prev || "" },
  { id: "tavg_r", grp: "tavg", label: "T.Avg\n실제", w: 56, align: "num", tint: "t-total", gh: "gh-total", bold: true, val: (r) => r.total_avg_real || "" },
  { id: "tavg_c", grp: "tavg", label: "T.Avg\n현재", w: 56, align: "num", tint: "t-total", gh: "gh-total", bold: true, val: (r) => r.total_avg_curr || "" },
  // Inbound / SOD
  { id: "inb_qty",  grp: "inb", label: "Inbound\nQty",       w: 52,  align: "num",  tint: "t-inb", gh: "gh-inb", val: (r) => {
    const v = r.total_inbound_qty || 0;
    return v > 0 ? { html: `<span class="inb-pos">+${v}</span>` } : { html: `<span class="lv-dim">0</span>` };
  }},
  { id: "inb_lst",  grp: "inb", label: "Containers\nList",   w: 152, align: "left", tint: "t-inb", gh: "gh-inb", val: (r) => compactContainerList(r.containers_list) },
  { id: "next_eta", grp: "inb", label: "Next\nETA",          w: 78,  align: "ctr",  tint: "t-inb", gh: "gh-inb", val: (r) => {
    const d = daysTo(r.next_eta);
    const color = d !== null && d < 0 ? "#C42020" : d !== null && d <= 14 ? "#9A5200" : "#1A4FC0";
    return { html: `<span style="font-family:monospace;font-size:9px;color:${color};font-weight:${d !== null && d <= 14 ? 600 : 400}">${r.next_eta || "—"}</span>` };
  }},
  { id: "sod",      grp: "inb", label: "S.O.D\n품절예상일", w: 82,  align: "ctr",  tint: "t-inb", gh: "gh-inb", val: (r, _i, u) => ({
    html: `<span class="${u === "crit" ? "sod-crit" : u === "warn" ? "sod-warn" : "sod-ok"}">${r.sod || "—"}</span>`,
  })},
];

// ── Column visibility / toolbar shared exports ───────────────────────────────

export const ALL_GROUP_KEYS: ColumnGroupKey[] = [
  "stock","wsales","esales","wavg","eavg","fba","s30","tavg","inb","con",
];

export const COMPACT_COLUMN_IDS = new Set<string>([
  "back","status","sku","west","east","total",
  "tavg_p","tavg_r","tavg_c","inb_qty","inb_lst","next_eta","sod",
]);

export const GROUP_BTN_LABELS: Record<string, string> = {
  wsales: "📈 West Sales",
  stock:  "Inventory",
  esales: "📈 East Sales",
  wavg:   "〜 W Avg",
  eavg:   "〜 E Avg",
  fba:    "FBA Avg",
  s30:    "🗓 30D Sales",
  tavg:   "〜 Total Avg",
  inb:    "🚢 Inbound/SOD",
  con:    "📋 Container 컬럼",
};

export const DEFAULT_FREEZE = "sod";
export const COLUMN_WIDTHS_STORAGE_KEY = "planning-dashboard-column-widths";
export const COLUMN_COLORS_STORAGE_KEY = "planning-dashboard-column-colors";
export const CELL_COLORS_STORAGE_KEY = "planning-dashboard-cell-colors";

export type ResizableColumnId = "row_num" | "cont_info" | "sku" | "inb_lst";
export type ColumnWidths = Partial<Record<ResizableColumnId, number>>;
export type ColumnVisibility = Record<string, boolean>;
export type ColumnColorSettings = Record<string, { cell?: string; header?: string }>;
export type CellColorSettings = Record<string, string>;
export type SkuPartFilterKey = "seat" | "no" | "color" | "tone";
export type SkuParts = Record<SkuPartFilterKey, string>;
export type SkuPartFilters = Record<SkuPartFilterKey, string[]>;

export const EMPTY_SKU_PART_FILTERS: SkuPartFilters = {
  seat: [],
  no: [],
  color: [],
  tone: [],
};

export const EMPTY_SKU_PARTS: SkuParts = {
  seat: "",
  no: "",
  color: "",
  tone: "",
};

export const RESIZABLE_COLUMN_LIMITS: Record<ResizableColumnId, { min: number; max: number }> = {
  row_num:   { min: 36, max: 90  },
  cont_info: { min: 90, max: 320 },
  sku:       { min: 160, max: 420 },
  inb_lst:   { min: 120, max: 420 },
};

export function isResizableColumnId(value: string): value is ResizableColumnId {
  return value in RESIZABLE_COLUMN_LIMITS;
}

export function clampColumnWidth(columnId: ResizableColumnId, width: number): number {
  const { min, max } = RESIZABLE_COLUMN_LIMITS[columnId];
  return Math.min(max, Math.max(min, width));
}

export function loadSavedColumnWidths(): ColumnWidths {
  if (typeof window === "undefined") return {};
  try {
    const stored = JSON.parse(window.localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(stored)
        .filter(([key, value]) => isResizableColumnId(key) && typeof value === "number" && Number.isFinite(value))
        .map(([key, value]) => [key, clampColumnWidth(key as ResizableColumnId, value as number)])
    ) as ColumnWidths;
  } catch {
    return {};
  }
}

export function isValidHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function loadSavedColumnColors(): ColumnColorSettings {
  if (typeof window === "undefined") return {};
  try {
    const stored = JSON.parse(window.localStorage.getItem(COLUMN_COLORS_STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(stored)
        .map(([key, value]) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) return null;
          const entry = value as Record<string, unknown>;
          const next = {
            ...(isValidHexColor(entry.cell) ? { cell: entry.cell } : {}),
            ...(isValidHexColor(entry.header) ? { header: entry.header } : {}),
          };
          return next.cell || next.header ? [key, next] : null;
        })
        .filter((entry): entry is [string, { cell?: string; header?: string }] => entry !== null),
    );
  } catch {
    return {};
  }
}

export function skuPartsForRow(row: Pick<DemandRow, "sku" | "seat" | "no" | "color" | "tone">): SkuParts {
  const parts = String(row.sku ?? "").trim().toUpperCase().split("-");
  if ((parts[0] === "CA" || parts[0] === "CL") && parts[1] === "SC" && parts.length >= 6) {
    for (let index = parts.length - 4; index >= 2; index -= 1) {
      const [seat, no, color, tone] = parts.slice(index, index + 4);
      if ((seat === "F" || seat === "B") && /^\d+$/.test(no ?? "") && color && tone) {
        return { seat, no, color, tone };
      }
    }
    return EMPTY_SKU_PARTS;
  }
  if ((parts[0] === "CA" || parts[0] === "CL") && parts[1] === "FM" && parts.length >= 6) {
    return {
      no: parts[2] ?? "",
      seat: parts[3] ?? "",
      color: parts[5] ?? "",
      tone: "",
    };
  }

  const rowParts: SkuParts = {
    seat: String(row.seat ?? "").trim().toUpperCase(),
    no: row.no === null || row.no === undefined || row.no === 0 ? "" : String(row.no).trim().toUpperCase(),
    color: String(row.color ?? "").trim().toUpperCase(),
    tone: String(row.tone ?? "").trim().toUpperCase(),
  };
  if (rowParts.seat || rowParts.no || rowParts.color || rowParts.tone) return rowParts;

  return EMPTY_SKU_PARTS;
}

export function skuMatchesPartFilters(
  row: Pick<DemandRow, "sku" | "seat" | "no" | "color" | "tone">,
  filters: SkuPartFilters,
): boolean {
  const parts = skuPartsForRow(row);
  return (Object.keys(filters) as SkuPartFilterKey[]).every((key) => {
    const filterValues = filters[key];
    return !filterValues.length || filterValues.includes(parts[key]);
  });
}

export function loadSavedCellColors(): CellColorSettings {
  if (typeof window === "undefined") return {};
  try {
    const stored = JSON.parse(window.localStorage.getItem(CELL_COLORS_STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(stored).filter((entry): entry is [string, string] => isValidHexColor(entry[1])),
    );
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export const CON_SUBCOLS: ConSubColDef[] = [
  { id: "inb_qty", label: "Con.\nQty",   w: 48, align: "num", tint: "t-cn", val: (cd) => cd.inbound_qty !== null && cd.inbound_qty !== undefined ? cd.inbound_qty : "" },
  { id: "remaining", label: "Rem. Qty",    w: 54, align: "num", tint: "t-cn",      val: (_cd, _c, row) => {
    const total = (row.remaining ?? 0) + (row.mistake ?? 0);
    return total || "";
  } },
  { id: "oo",        label: "Open\nOrders", w: 44, align: "num", tint: "t-cn",      val: (cd) => cd.open_orders || 0 },
  { id: "avail", label: "Avail\nQty",   w: 44, align: "num", tint: "t-cn",      val: (cd) => cd.avail_qty !== null && cd.avail_qty !== undefined ? cd.avail_qty : "" },
  { id: "est",   label: "Est.\nSales",  w: 44, align: "num", tint: "t-cn",      val: (cd) => cd.est_sales || 0 },
  { id: "cbo",   label: "Back\nOrder",  w: 44, align: "num", tint: "t-cn",      val: (cd) => {
    const v = cd.backorder || 0;
    return v ? { html: `<span class="bo-pos">${v}</span>` } : { html: `<span class="lv-dim">0</span>` };
  }},
  { id: "carry", label: "Carry\nover",  w: 52, align: "num", tint: "t-cn", val: (cd) => cd.carryover !== null && cd.carryover !== undefined ? cd.carryover : "" },
  { id: "life",  label: "Inv.\nLife",   w: 42, align: "num", tint: "t-cn-life", val: (cd) => {
    const v = cd.inv_life;
    if (v === null || v === undefined) return "";
    return { html: `<span class="${lifeCls(v)}">${Math.round(v)}</span>` };
  }},
  { id: "esod",  label: "EST.\nSOD",    w: 84, align: "ctr", tint: "t-cn-sod",  val: (cd) => {
    if (!cd.est_sod) return "";
    const d = daysTo(cd.est_sod);
    const cls = d !== null && d <= 30 ? "sod-crit" : d !== null && d <= 60 ? "sod-warn" : "sod-ok";
    return { html: `<span class="${cls}">${cd.est_sod}</span>` };
  }},
  { id: "psod",  label: "Plan\nSOD",    w: 84, align: "ctr", tint: "t-cn-sod",  val: (cd) => cd.plan_sod ? { html: `<span style="font-size:9px;color:#9A9790">${cd.plan_sod}</span>` } : "" },
  { id: "ccbm",  label: "CBM",          w: 58, align: "num", tint: "t-cn",      val: (cd) => cd.cbm || "" },
];
