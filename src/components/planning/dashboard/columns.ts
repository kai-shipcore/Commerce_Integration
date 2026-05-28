import { differenceInCalendarDays, parseISO } from "date-fns";
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
  fix:    "Core Info",
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

export const TODAY = new Date().toISOString().slice(0, 10);

export function daysTo(d: string | null | undefined): number | null {
  if (!d) return null;
  try {
    return differenceInCalendarDays(parseISO(d), parseISO(TODAY));
  } catch {
    return null;
  }
}

export function urgStatus(row: DemandRow): UrgencyStatus {
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
  { id: "cont_info", grp: "fix", label: "Container\nInfo.", w: 115, align: "left", tint: "",        gh: "gh-fix",    val: (r) => r.container_info || "" },
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
  { id: "wavg_r", grp: "wavg", label: "W Avg\n실제", w: 56, align: "num", tint: "t-avg", gh: "gh-avg", val: (r) => r.avg_daily_real || "" },
  { id: "wavg_c", grp: "wavg", label: "W Avg\n현재", w: 56, align: "num", tint: "t-avg", gh: "gh-avg", bold: true, val: (r) => {
    const v = r.avg_daily_curr;
    if (!v) return "";
    if (v >= 10) return { html: `<span class="lv-crit">${v}</span>` };
    if (v >= 5)  return { html: `<span class="lv-warn">${v}</span>` };
    return v;
  }},
  // East Avg Daily
  { id: "eavg_p", grp: "eavg", label: "E Avg\n이전", w: 56, align: "num", tint: "t-avg", gh: "gh-avg", val: (r) => r.east_avg_prev || "" },
  { id: "eavg_r", grp: "eavg", label: "E Avg\n실제", w: 56, align: "num", tint: "t-avg", gh: "gh-avg", val: (r) => r.east_avg_real || "" },
  { id: "eavg_c", grp: "eavg", label: "E Avg\n현재", w: 56, align: "num", tint: "t-avg", gh: "gh-avg", bold: true, val: (r) => r.east_avg_curr || "" },
  // FBA Avg
  { id: "fba_r", grp: "fba", label: "FBA\n실제", w: 56, align: "num", tint: "t-avg", gh: "gh-avg", val: (r) => r.fba_avg_real || "" },
  { id: "fba_c", grp: "fba", label: "FBA\n현재", w: 56, align: "num", tint: "t-avg", gh: "gh-avg", val: (r) => r.fba_avg_curr || "" },
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
  { id: "inb_lst",  grp: "inb", label: "Containers\nList",   w: 152, align: "left", tint: "t-inb", gh: "gh-inb", val: (r) => r.containers_list || "" },
  { id: "next_eta", grp: "inb", label: "Next\nETA",          w: 78,  align: "ctr",  tint: "t-inb", gh: "gh-inb", val: (r) => {
    const d = daysTo(r.next_eta);
    const color = d !== null && d < 0 ? "#C42020" : d !== null && d <= 14 ? "#9A5200" : "#1A4FC0";
    return { html: `<span style="font-family:monospace;font-size:9px;color:${color};font-weight:${d !== null && d <= 14 ? 600 : 400}">${r.next_eta || "—"}</span>` };
  }},
  { id: "sod",      grp: "inb", label: "S.O.D\n품절예상일", w: 82,  align: "ctr",  tint: "t-inb", gh: "gh-inb", val: (r, _i, u) => ({
    html: `<span class="${u === "crit" ? "sod-crit" : u === "warn" ? "sod-warn" : "sod-ok"}">${r.sod || "—"}</span>`,
  })},
];

export const CON_SUBCOLS: ConSubColDef[] = [
  { id: "inb_qty", label: "Con.\nQty",   w: 48, align: "num", tint: "t-cn", val: (cd) => cd.inbound_qty !== null && cd.inbound_qty !== undefined ? cd.inbound_qty : "" },
  { id: "remaining", label: "Remaining",   w: 54, align: "num", tint: "t-cn",      val: (_cd, _c, row) => row.remaining || "" },
  { id: "mistake",   label: "Mistake",     w: 48, align: "num", tint: "t-cn",      val: (_cd, _c, row) => row.mistake   || "" },
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
    return { html: `<span class="${lifeCls(v)}">${v}</span>` };
  }},
  { id: "esod",  label: "EST.\nSOD",    w: 84, align: "ctr", tint: "t-cn-sod",  val: (cd) => {
    if (!cd.est_sod) return "";
    const d = daysTo(cd.est_sod);
    const cls = d !== null && d <= 30 ? "sod-crit" : d !== null && d <= 60 ? "sod-warn" : "sod-ok";
    return { html: `<span class="${cls}">${cd.est_sod}</span>` };
  }},
  { id: "psod",  label: "Plan\nSOD",    w: 84, align: "ctr", tint: "t-cn-sod",  val: (cd) => cd.plan_sod ? { html: `<span style="font-size:9px;color:#9A9790">${cd.plan_sod}</span>` } : "" },
  { id: "ccbm",  label: "CBM",          w: 44, align: "num", tint: "t-cn",      val: (cd) => cd.cbm || "" },
];
