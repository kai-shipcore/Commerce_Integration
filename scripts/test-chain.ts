/**
 * Full planning formula test script — covers every formula the API route computes.
 * Run with: npx tsx scripts/test-chain.ts
 *
 * Fill in the INPUTS section with values from your reference source.
 * Fill in EXPECTED with what the reference says the outputs should be.
 * Leave any expected field as null to skip checking it (still prints the actual).
 */

import { fbmThirtyDayAverage, inventoryLifeDays } from "../src/lib/planning/forecast-calculations";
import { DEFAULT_SEASONAL_FACTORS, seasonalFactorForEta } from "../src/lib/planning/seasonal-factors";

// ═══════════════════════════════════════════════════════════════════════════
// INPUTS — fill these in from your reference source
// ═══════════════════════════════════════════════════════════════════════════

const TODAY = "2026-06-05"; // "as of" date

// Current inventory state
const total_stock = 879;   // total on-hand units (west + east combined)
const back        = -10;   // raw backorder value from DB (negative = shortage)

// West FBM — total units sold over each window (real / current period)
const WEST_REAL = {
  d90:     1443,   // total west FBM sales, last 90 days
  d60:     841,   // total west FBM sales, last 60 days
  d30:     434,   // total west FBM sales, last 30 days
  d30_pre: 26,   // total west preorders, last 30 days
  d15:     213,   // total west FBM sales, last 15 days
  d7:      104,   // total west FBM sales, last 7 days
};

// East (TTM) — total units sold over each window (real period)
const EAST_REAL = {
  d90: 447,
  d60: 427,
  d30: 239,
  d15: 111,
  d7:  51,
  // Note: east has no preorder component (always 0)
};

// Amazon FBA
const fba_30d_real = 0;  // total FBA units, last 30 days

// Containers — first must be the baseline (기준), the rest in ETA order
const containers = [
  { name: "기준",   eta: TODAY,        inbound_qty: 0 },
  { name: "170-CA-SEAT", eta: "2026-06-09", inbound_qty: 175 },
  // { name: "CON-02", eta: "2026-08-15", inbound_qty: 0 },
];

// ═══════════════════════════════════════════════════════════════════════════
// EXPECTED — set to null to skip checking, or fill in your reference values
// ═══════════════════════════════════════════════════════════════════════════

const EXPECTED = {
  // ── West FBM daily rates ──────────────────────────────────────────────────
  avg_daily_real:       13.20 as number | null,  // weighted blend, current period
  avg_daily_prev:       null as number | null,  // weighted blend, prev period
  avg_daily_curr:       13.20 as number | null,  // = avg_daily_real (currentDailyAverage just returns real)

  // ── East (TTM) daily rates ────────────────────────────────────────────────
  east_avg_real:        6.53 as number | null,
  east_avg_prev:        null as number | null,
  east_avg_curr:        6.47 as number | null,  // = east_avg_real

  // ── FBA daily rates ───────────────────────────────────────────────────────
  fba_avg_real:         null as number | null,  // = fba_30d / 30
  fba_avg_prev:         0.01 as number | null,  // = fba_30d_prev / 30
  fba_avg_curr:         0.01 as number | null,  // = fba_avg_real

  // ── 30-day unit totals ────────────────────────────────────────────────────
  west_fbm_30d:         447 as number | null,  // fbmThirtyDayAverage(west windows)
  east_fbm_30d:         209 as number | null,  // fbmThirtyDayAverage(east windows)
  total_30d:            656 as number | null,  // west + east + fba_30d

  // ── Total combined daily rates ────────────────────────────────────────────
  total_avg_prev:       null as number | null,  // west_prev + east_prev + fba_prev
  total_avg_real:       19.74 as number | null,  // west_real + east_real + fba_real
  total_avg_curr:       19.68 as number | null,  // west_curr + east_curr + fba_curr

  // ── Baseline inventory state (기준 column) ────────────────────────────────
  avail_qty:            869 as number | null,  // total_stock + back
  baseline_carryover:   869 as number | null,  // max(0, avail_qty)
  baseline_backorder:   0 as number | null,  // avail_qty < 0 ? abs(avail_qty) : 0
  baseline_seasonal:    1 as number | null,  // seasonal factor for TODAY's month
  baseline_inv_life:    44 as number | null,  // carryover / (rate * seasonal)
  sod:                  "2026-07-19" as string | null,  // TODAY + floor(total_stock / rate) days (no seasonal)
  plan_sod:             "2026-07-19" as string | null,  // TODAY + baseline_inv_life days (seasonal-adjusted)

  // ── Per-container chain ───────────────────────────────────────────────────
  // Add one entry per container after 기준, keyed by container name
  chain: {
    "170-CA-SEAT": {
      days_between:  4 as number | null,  // days from prev ETA to this ETA
      seasonal:      1 as number | null,  // seasonal factor for this ETA's month
      est_sales:     79 as number | null,  // days_between * total_avg_curr * seasonal
      avail_qty_c:   1044 as number | null,  // prevCarryover + qty (or qty - prevBackorder)
      open_orders:   0 as number | null,  // 0 if prior carryover > 0, else negative
      backorder:     0 as number | null,  // max(0, est_sales - avail_qty_c)
      carryover:     965 as number | null,  // max(0, avail_qty_c - est_sales) if no backorder
      inv_life:      49 as number | null,  // carryover / (rate * seasonal)
      plan_sod:      "2026-07-28" as string | null,  // this ETA + inv_life days
      est_sod:       "2026-07-28" as string | null,  // rolling max: max(prev est_sod, plan_sod)
      cum_avail_qty: 1044 as number | null,  // cumulative inbound qty across all containers
    },
    // "CON-02": { ... },
  } as Record<string, {
    days_between?: number | null; seasonal?: number | null; est_sales?: number | null;
    avail_qty_c?: number | null; open_orders?: number | null; backorder?: number | null;
    carryover?: number | null; inv_life?: number | null; plan_sod?: string | null;
    est_sod?: string | null; cum_avail_qty?: number | null;
  }>,
};

// ═══════════════════════════════════════════════════════════════════════════
// FORMULAS — mirrors the API route exactly
// ═══════════════════════════════════════════════════════════════════════════

// West FBM weighted daily rate (SQL formula: w90/90*0.10 + w60/60*0.15 + w30/30*0.30 + w15/15*0.20 + w7/7*0.15 + pre30/30*0.10)
function westWeightedDailyRate(d90: number, d60: number, d30: number, d30_pre: number, d15: number, d7: number): number {
  return d90/90*0.10 + d60/60*0.15 + d30/30*0.30 + d15/15*0.20 + d7/7*0.15 + d30_pre/30*0.10;
}

// East (TTM) weighted daily rate — same weights, no preorder component
function eastWeightedDailyRate(d90: number, d60: number, d30: number, d15: number, d7: number): number {
  return d90/90*0.10 + d60/60*0.15 + d30/30*0.30 + d15/15*0.20 + d7/7*0.15;
}

// Date arithmetic helper
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPUTE — all steps in order, matching the API route's sequence
// ═══════════════════════════════════════════════════════════════════════════

// ── West FBM rates ────────────────────────────────────────────────────────
const avg_daily_real = westWeightedDailyRate(WEST_REAL.d90, WEST_REAL.d60, WEST_REAL.d30, WEST_REAL.d30_pre, WEST_REAL.d15, WEST_REAL.d7);
const avg_daily_prev = null; // prev period data not available
const avg_daily_curr = avg_daily_real; // currentDailyAverage just returns real

// ── East (TTM) rates ──────────────────────────────────────────────────────
const east_avg_real = eastWeightedDailyRate(EAST_REAL.d90, EAST_REAL.d60, EAST_REAL.d30, EAST_REAL.d15, EAST_REAL.d7);
const east_avg_prev = null; // prev period data not available
const east_avg_curr = east_avg_real; // currentDailyAverage just returns real

// ── FBA rates ─────────────────────────────────────────────────────────────
const fba_avg_real = fba_30d_real / 30;
const fba_avg_prev = null; // prev period data not available
const fba_avg_curr = fba_avg_real; // API sets _fba_curr = fbaReal directly

// ── 30-day totals ─────────────────────────────────────────────────────────
const west_fbm_30d = fbmThirtyDayAverage(WEST_REAL.d90, WEST_REAL.d60, WEST_REAL.d30, WEST_REAL.d30_pre, WEST_REAL.d15, WEST_REAL.d7);
const east_fbm_30d = fbmThirtyDayAverage(EAST_REAL.d90, EAST_REAL.d60, EAST_REAL.d30, 0, EAST_REAL.d15, EAST_REAL.d7); // east has no preorder
const total_30d    = west_fbm_30d + east_fbm_30d + fba_30d_real;

// ── Total combined rates ──────────────────────────────────────────────────
const total_avg_prev = null; // prev period data not available
const total_avg_real = avg_daily_real + east_avg_real + fba_avg_real;
const total_avg_curr = avg_daily_curr + east_avg_curr + fba_avg_curr;

// ── Baseline inventory state ──────────────────────────────────────────────
const avail_qty          = total_stock + back;
const baseline_carryover = avail_qty >= 0 ? avail_qty : 0;
const baseline_backorder = avail_qty < 0 ? Math.abs(avail_qty) : 0;
const dailyRate          = total_avg_curr;
const baseline_seasonal  = seasonalFactorForEta(TODAY, DEFAULT_SEASONAL_FACTORS);
const baseline_inv_life  = inventoryLifeDays(baseline_carryover, dailyRate, baseline_seasonal);

// sod: simpler formula using total_stock (no seasonal adjustment, no back deduction)
const sod: string | null = dailyRate > 0
  ? addDays(TODAY, Math.floor(total_stock / dailyRate))
  : null;

// plan_sod: uses seasonal-adjusted inv_life from carryover
const plan_sod: string | null = baseline_inv_life !== null
  ? new Date(new Date(TODAY).getTime() + baseline_inv_life * 86400000).toISOString().slice(0, 10)
  : null;

// ── Chain: one block per container after 기준 ─────────────────────────────
type ChainBlock = {
  days_between: number;
  seasonal: number;
  est_sales: number;
  avail_qty_c: number;
  open_orders: number;
  backorder: number;
  carryover: number;
  inv_life: number | null;
  plan_sod: string | null;
  est_sod: string | null;
  cum_avail_qty: number;
};

const chainBlocks = new Map<string, ChainBlock>();

let prevCarryover    = baseline_carryover;
let prevBackorder    = baseline_backorder;
let prevSod: string | null = sod;
let prevEta          = TODAY;
let cumulativeAvailQty = avail_qty;

for (const c of containers.slice(1)) {
  const qty  = c.inbound_qty ?? 0;
  const eta  = c.eta;
  cumulativeAvailQty += qty;

  const db       = daysBetween(prevEta, eta);
  const seasonal = seasonalFactorForEta(eta, DEFAULT_SEASONAL_FACTORS);
  const estSales  = db * dailyRate * seasonal;

  const openOrders = prevCarryover > 0 ? 0 : (prevBackorder > qty ? -qty : -prevBackorder);
  const availQtyC  = prevCarryover > 0 ? prevCarryover + qty : qty - prevBackorder;

  const backorderC = Math.max(0, estSales - availQtyC);
  const carryoverC = backorderC >= 1 ? 0 : Math.max(0, availQtyC - estSales);
  const invLifeC   = inventoryLifeDays(carryoverC, dailyRate, seasonal);

  const sodFromThis: string | null = invLifeC !== null
    ? new Date(new Date(eta).getTime() + invLifeC * 86400000).toISOString().slice(0, 10)
    : null;
  const estSodC: string | null = (!qty || carryoverC === 0)
    ? prevSod
    : prevSod && sodFromThis ? (prevSod > sodFromThis ? prevSod : sodFromThis) : (sodFromThis ?? prevSod);

  chainBlocks.set(c.name, {
    days_between:  db,
    seasonal,
    est_sales:     estSales,
    avail_qty_c:   availQtyC,
    open_orders:   openOrders,
    backorder:     backorderC,
    carryover:     carryoverC,
    inv_life:      invLifeC,
    plan_sod:      sodFromThis,
    est_sod:       estSodC,
    cum_avail_qty: cumulativeAvailQty,
  });

  prevCarryover = carryoverC;
  prevBackorder = backorderC;
  prevSod       = estSodC;
  prevEta       = eta;
}

// ═══════════════════════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════════════════════

const r4 = (n: number | null) => n === null ? "null" : String(Math.round(n * 10000) / 10000);
let allPass = true;

function check(label: string, actual: number | string | null, expected: number | string | null) {
  const actualStr = typeof actual === "number" ? r4(actual) : String(actual ?? "null");
  if (expected === null || expected === undefined) {
    console.log(`       ${actualStr.padEnd(14)} (skip)  ${label}`);
    return;
  }
  const match = typeof expected === "number"
    ? Math.abs((actual as number) - expected) < 0.005
    : actual === expected;
  if (!match) allPass = false;
  console.log(`  ${match ? "PASS" : "FAIL"}  ${actualStr.padEnd(14)} expected ${String(expected).padEnd(14)}  ${label}`);
}

console.log("\n═══ West FBM daily rates ═══");
check("avg_daily_real", avg_daily_real, EXPECTED.avg_daily_real);
check("avg_daily_prev", avg_daily_prev, EXPECTED.avg_daily_prev);
check("avg_daily_curr", avg_daily_curr, EXPECTED.avg_daily_curr);

console.log("\n═══ East (TTM) daily rates ═══");
check("east_avg_real",  east_avg_real,  EXPECTED.east_avg_real);
check("east_avg_prev",  east_avg_prev,  EXPECTED.east_avg_prev);
check("east_avg_curr",  east_avg_curr,  EXPECTED.east_avg_curr);

console.log("\n═══ FBA daily rates ═══");
check("fba_avg_real",   fba_avg_real,   EXPECTED.fba_avg_real);
check("fba_avg_prev",   fba_avg_prev,   EXPECTED.fba_avg_prev);
check("fba_avg_curr",   fba_avg_curr,   EXPECTED.fba_avg_curr);

console.log("\n═══ 30-day unit totals ═══");
check("west_fbm_30d",   west_fbm_30d,   EXPECTED.west_fbm_30d);
check("east_fbm_30d",   east_fbm_30d,   EXPECTED.east_fbm_30d);
check("total_30d",      total_30d,      EXPECTED.total_30d);

console.log("\n═══ Total combined daily rates ═══");
check("total_avg_prev", total_avg_prev, EXPECTED.total_avg_prev);
check("total_avg_real", total_avg_real, EXPECTED.total_avg_real);
check("total_avg_curr", total_avg_curr, EXPECTED.total_avg_curr);

console.log("\n═══ Baseline inventory state (기준) ═══");
check("avail_qty",           avail_qty,          EXPECTED.avail_qty);
check("baseline_carryover",  baseline_carryover, EXPECTED.baseline_carryover);
check("baseline_backorder",  baseline_backorder, EXPECTED.baseline_backorder);
check("baseline_seasonal",   baseline_seasonal,  EXPECTED.baseline_seasonal);
check("baseline_inv_life",   baseline_inv_life,  EXPECTED.baseline_inv_life);
check("sod      (no seasonal, floor(stock/rate))", sod,      EXPECTED.sod);
check("plan_sod (seasonal, carryover/adj_rate)",   plan_sod, EXPECTED.plan_sod);

console.log("\n═══ Container chain ═══");
for (const [name, block] of chainBlocks.entries()) {
  const exp = EXPECTED.chain[name] ?? {};
  console.log(`\n  ── ${name} (ETA: ${containers.find((c) => c.name === name)?.eta}) ──`);
  check("days_between",  block.days_between,  exp.days_between  ?? null);
  check("seasonal",      block.seasonal,      exp.seasonal      ?? null);
  check("est_sales",     block.est_sales,     exp.est_sales     ?? null);
  check("avail_qty_c",   block.avail_qty_c,   exp.avail_qty_c   ?? null);
  check("open_orders",   block.open_orders,   exp.open_orders   ?? null);
  check("backorder",     block.backorder,     exp.backorder     ?? null);
  check("carryover",     block.carryover,     exp.carryover     ?? null);
  check("inv_life",      block.inv_life,      exp.inv_life      ?? null);
  check("plan_sod",      block.plan_sod,      exp.plan_sod      ?? null);
  check("est_sod",       block.est_sod,       exp.est_sod       ?? null);
  check("cum_avail_qty", block.cum_avail_qty, exp.cum_avail_qty ?? null);
}

console.log(allPass ? "\n✓ All checked fields passed\n" : "\n✗ Some checks failed\n");
