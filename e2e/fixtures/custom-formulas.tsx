// Isolated UI fixture; no credentials, real API requests or database writes.
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgDemandPlanningGrid } from "@/components/planning/dashboard/ag-demand-planning-grid";
import { I18nProvider } from "@/lib/i18n/i18n-provider";
import { normalizeFormulaConfig, type FormulaConfig } from "@/lib/planning/custom-formulas";
import { ALL_COLS, ALL_GROUP_KEYS, mergeMovedColumnOrder, sameColumnOrder, type ColumnWidths } from "@/components/planning/dashboard/columns";
import { DEFAULT_SEASONAL_FACTORS } from "@/lib/planning/seasonal-factors";
import type { DemandPlanningData, DemandRow, ColumnGroupKey } from "@/types/demand-planning";
import type { GridSort } from "@/lib/planning/grid-sort";
import "@/app/globals.css";

const rows = ["CA-SC-10-F-10-BK-1TO", "CA-SC-10-F-10-GR-1TO"].map((sku, i) => ({
  sku, category_code: "SC", container_info: "", cbm: 0.1, seat: "F", no: 10, color: i ? "GR" : "BK", tone: "1TO",
  back: 0, sales_status: "Original", total_stock: 100 + i * 50, west_stock: 100, east_stock: 0,
  total_avg_curr: i ? 30 : 10, total_avg_real: 10, total_avg_prev: 12, total_30d: 300,
  remaining: 0, mistake: 0, total_inbound_qty: 0, containers_list: "", next_eta: null,
  sod: null, oos_days_90d: 0, oos_lost_demand_90d: 0, containers: {},
})) as DemandRow[];
const data: DemandPlanningData = { rows, containers: [], last_sync: null };
const wideLayout = new URLSearchParams(window.location.search).get("layout") === "wide";
const wideColumns = ["row_num", "cbm", "back", "status", "sku", "fullerton", "canary", "ttm", "ttm_jeff", "west", "east", "total", "transit", "wfbm30", "efbm30", "fba30", "tot30", "tavg_p", "tavg_r", "tavg_c", "inb_qty", "inb_lst", "next_eta", "sod"];
const groupVis = Object.fromEntries(["fix", ...ALL_GROUP_KEYS].map((key) => [key, (wideLayout ? ["fix", "stock", "tavg", "s30", "inb"] : ["fix", "stock", "tavg"]).includes(key)])) as Record<ColumnGroupKey, boolean>;
if (new URLSearchParams(window.location.search).has("containers")) {
  data.containers = [{ col: 1, name: "TEST-CON", eta: "2026-12-01", cbm_cap: 60, status: "draft" }];
  groupVis.con = true;
}
const initialVisibility = Object.fromEntries(ALL_COLS.map((col) => [col.id, (wideLayout ? wideColumns : ["sku", "total", "tavg_c"]).includes(col.id)]));
const noop = () => {};
const emptySet = new Set<string>();
const emptyOverlay = { items: [], containers: [] };

function Fixture() {
  const [formulaToolbarTarget, setFormulaToolbarTarget] = useState<HTMLDivElement | null>(null);
  const [tab, setTab] = useState("live");
  const [locked, setLocked] = useState(false);
  const [configs, setConfigs] = useState<Record<string, FormulaConfig>>(() => {
    const saved = localStorage.getItem("formula-fixture");
    return saved ? JSON.parse(saved) : { live: normalizeFormulaConfig(null), copy: normalizeFormulaConfig(null) };
  });
  const [visibility, setVisibility] = useState(initialVisibility);
  const [sort, setSort] = useState<GridSort | null>(null);
  const [widths, setWidths] = useState<ColumnWidths>({});
  const widthsRef = useRef(widths);
  const [reverse, setReverse] = useState(false);
  const [columnOrder, setColumnOrder] = useState<string[]>(() => JSON.parse(localStorage.getItem("formula-fixture-order") ?? "[]"));
  const [displayedOrder, setDisplayedOrder] = useState<string[]>([]);
  return <main className="flex h-dvh flex-col">
    <div className="flex flex-wrap gap-3 border-b p-3 text-sm">
      <strong>Demand Pilot · synthetic formula test</strong>
      <button onClick={() => setTab("live")}>Live</button>
      <button onClick={() => setTab("copy")}>Copy tab</button>
      <button onClick={() => { setConfigs((previous) => ({ ...previous, copy: normalizeFormulaConfig(JSON.parse(JSON.stringify(previous.live))) })); setTab("copy"); }}>Duplicate Live</button>
      <button onClick={() => setReverse(!reverse)}>Reverse rows</button>
      <button onClick={() => setColumnOrder(["custom_formula_1", "total", "sku", "tavg_c", "custom_formula_2"])}>Mixed saved order</button>
      <output hidden data-testid="displayed-column-order">{JSON.stringify(displayedOrder)}</output>
      <button onClick={() => setLocked(!locked)}>{locked ? "Unlock" : "Lock"}</button>
      <span data-testid="tab">{tab}</span>
      <span className="self-center">SKU {rows.length}</span>
      <div ref={setFormulaToolbarTarget} className="flex shrink-0 items-center" />
    </div>
    <div className="min-h-0 flex-1">
      <AgDemandPlanningGrid data={{ ...data, rows: reverse ? [...rows].reverse() : rows }} loading={false}
        formulaToolbarTarget={formulaToolbarTarget}
        columnOrder={columnOrder}
        onColumnOrderChange={(order) => setColumnOrder((current) => {
          const next = mergeMovedColumnOrder(current, order);
          localStorage.setItem("formula-fixture-order", JSON.stringify(next));
          return next;
        })}
        onColumnDisplayOrderChange={(order) => setDisplayedOrder((current) => sameColumnOrder(current, order) ? current : order)}
        categoryFilter={["sc"]} salesStatusFilter={[]} urgencyFilter={[]} search="" skuPartFilters={{}}
        onFilteredRowsChange={noop} onLoadContainerDetails={noop} containerDetailsLoaded containerDetailsLoading={false}
        groupVis={groupVis} columnVis={visibility} compactMode={false} showMistake showZeroSales freezeUntil="sku"
        columnWidths={widths} columnWidthsRef={widthsRef} onColumnWidthsChange={setWidths} seasonalFactors={DEFAULT_SEASONAL_FACTORS}
        sort={sort} onSortChange={setSort} onHideColumn={(id) => setVisibility((v) => ({ ...v, [id]: v[id] === false }))}
        formulaConfig={configs[tab]} formulaEditingEnabled={!locked} canEditPlanning={!locked}
        hiddenContainers={emptySet} hiddenBases={emptySet} hiddenContainerColumns={emptySet}
        scenarioOverlay={tab === "live" ? null : emptyOverlay}
        onFormulaConfigChange={(next) => { const value = { ...configs, [tab]: next }; setConfigs(value); localStorage.setItem("formula-fixture", JSON.stringify(value)); }}
        scenario={tab === "live" ? null : { id: "copy", canEdit: !locked }} />
    </div>
  </main>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider><Fixture /></I18nProvider>);
