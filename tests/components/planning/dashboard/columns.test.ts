import { describe, expect, it } from "vitest";
import {
  ALL_COLS,
  ALL_GROUP_KEYS,
  DEFAULT_HEADER_HEIGHT,
  DEFAULT_ROW_HEIGHT,
  MAX_HEADER_HEIGHT,
  MAX_ROW_HEIGHT,
  MIN_HEADER_HEIGHT,
  MIN_ROW_HEIGHT,
  WRAPPING_ROW_COLUMN_IDS,
  columnAppliesToCategories,
  ensureAdditionalNotesInColumnOrder,
  normalizeDashboardFilters,
  loadSavedRowHeight,
  matchesAnyLogicalColumnId,
  mergeMovedColumnOrder,
  sameColumnOrder,
  viewStateSubset,
  matchesCategorySelection,
  matchesSalesStatusSelection,
  matchesUrgencySelection,
  parseUrgencyParam,
  normalizeHeaderHeight,
  normalizeRowHeight,
  normalizeRowHeights,
} from "@/components/planning/dashboard/columns";
import type { DemandRow } from "@/types/demand-planning";

describe("FBA sales columns", () => {
  it("places the FBA Sales group directly after East FBM Sales", () => {
    expect(ALL_GROUP_KEYS.indexOf("fbasales")).toBe(ALL_GROUP_KEYS.indexOf("esales") + 1);
    const groups = ALL_COLS.map((column) => column.grp);
    const lastEast = groups.lastIndexOf("esales");
    const firstFba = groups.indexOf("fbasales");
    expect(firstFba).toBe(lastEast + 1);
    expect(ALL_COLS.filter((column) => column.grp === "fbasales").map((column) => column.id))
      .toEqual(["f90", "f60", "f30", "f15", "f7", "fpre"]);
  });

  it("inserts new FBA columns after East columns in an existing saved order", () => {
    const migrated = ensureAdditionalNotesInColumnOrder(["sku", "e90", "epre", "wavg_p"]);
    expect(migrated).toEqual([
      "sku", "e90", "epre", "f90", "f60", "f30", "f15", "f7", "fpre", "wavg_p",
    ]);
  });
});

describe("Sales Status column", () => {
  it("renders Part with a distinct status class instead of Original styling", () => {
    const statusColumn = ALL_COLS.find((column) => column.id === "status");
    const rendered = statusColumn?.val({ sales_status: "Part" } as never, 0, "ok");

    expect(rendered).toEqual({ html: '<span class="sc sc-part">Part</span>' });
  });
});

describe("matchesAnyLogicalColumnId", () => {
  it("matches a base column by its own id", () => {
    expect(matchesAnyLogicalColumnId("sku", new Set(["sku"]))).toBe(true);
    expect(matchesAnyLogicalColumnId("cbm", new Set(["sku"]))).toBe(false);
  });

  it("matches one container's cell by its physical id", () => {
    const picked = new Set(["CN-2601::inb_qty"]);
    expect(matchesAnyLogicalColumnId("CN-2601::inb_qty", picked)).toBe(true);
    expect(matchesAnyLogicalColumnId("CN-2602::inb_qty", picked)).toBe(false);
    expect(matchesAnyLogicalColumnId("CN-2601::avail", picked)).toBe(false);
  });

  it("spreads a con: sub-column across every container", () => {
    const picked = new Set(["con:inb_qty"]);
    expect(matchesAnyLogicalColumnId("CN-2601::inb_qty", picked)).toBe(true);
    expect(matchesAnyLogicalColumnId("CN-2602::inb_qty", picked)).toBe(true);
    expect(matchesAnyLogicalColumnId("CN-2601::avail", picked)).toBe(false);
  });

  it("never matches a group id, which names no column of its own", () => {
    const picked = new Set(["container:CN-2601"]);
    expect(matchesAnyLogicalColumnId("CN-2601::inb_qty", picked)).toBe(false);
    expect(matchesAnyLogicalColumnId("container:CN-2601", picked)).toBe(false);
  });

  it("matches when any one of several picks matches", () => {
    const picked = new Set(["sku", "con:avail"]);
    expect(matchesAnyLogicalColumnId("CN-2601::avail", picked)).toBe(true);
    expect(matchesAnyLogicalColumnId("sku", picked)).toBe(true);
    expect(matchesAnyLogicalColumnId("cbm", picked)).toBe(false);
  });

  it("matches nothing for an empty selection", () => {
    expect(matchesAnyLogicalColumnId("sku", new Set())).toBe(false);
  });
});

describe("normalizeHeaderHeight", () => {
  it("falls back to the default for anything that is not a finite number", () => {
    for (const value of [undefined, null, "45", NaN, Infinity, {}, []]) {
      expect(normalizeHeaderHeight(value)).toBe(DEFAULT_HEADER_HEIGHT);
    }
  });

  it("clamps to the supported range", () => {
    expect(normalizeHeaderHeight(MIN_HEADER_HEIGHT - 10)).toBe(MIN_HEADER_HEIGHT);
    expect(normalizeHeaderHeight(MAX_HEADER_HEIGHT + 500)).toBe(MAX_HEADER_HEIGHT);
    // A drag that runs past the top of the header cannot collapse it away.
    expect(normalizeHeaderHeight(0)).toBe(MIN_HEADER_HEIGHT);
    expect(normalizeHeaderHeight(-120)).toBe(MIN_HEADER_HEIGHT);
  });

  it("rounds fractional drag positions to whole pixels", () => {
    expect(normalizeHeaderHeight(60.4)).toBe(60);
    expect(normalizeHeaderHeight(60.6)).toBe(61);
  });

  it("leaves the untouched default alone, so an existing grid looks unchanged", () => {
    expect(normalizeHeaderHeight(DEFAULT_HEADER_HEIGHT)).toBe(DEFAULT_HEADER_HEIGHT);
  });
});

describe("normalizeRowHeight", () => {
  it("falls back to the default for anything that is not a finite number", () => {
    for (const value of [undefined, null, "40", NaN, Infinity, {}, []]) {
      expect(normalizeRowHeight(value)).toBe(DEFAULT_ROW_HEIGHT);
    }
  });

  it("clamps to the supported range", () => {
    expect(normalizeRowHeight(MIN_ROW_HEIGHT - 10)).toBe(MIN_ROW_HEIGHT);
    expect(normalizeRowHeight(MAX_ROW_HEIGHT + 500)).toBe(MAX_ROW_HEIGHT);
    expect(normalizeRowHeight(0)).toBe(MIN_ROW_HEIGHT);
    expect(normalizeRowHeight(-40)).toBe(MIN_ROW_HEIGHT);
  });

  it("rounds fractional drag positions to whole pixels", () => {
    expect(normalizeRowHeight(48.4)).toBe(48);
    expect(normalizeRowHeight(48.6)).toBe(49);
  });

  it("keeps a value already in range", () => {
    expect(normalizeRowHeight(60)).toBe(60);
    expect(normalizeRowHeight(DEFAULT_ROW_HEIGHT)).toBe(DEFAULT_ROW_HEIGHT);
  });
});

describe("loadSavedRowHeight", () => {
  // The suite runs on the node environment (vitest.config.ts), so this covers
  // the server-render path; the stored-value paths go through
  // normalizeRowHeight, which is tested above.
  it("returns the default when there is no window to read from", () => {
    expect(loadSavedRowHeight()).toBe(DEFAULT_ROW_HEIGHT);
  });
});

describe("WRAPPING_ROW_COLUMN_IDS", () => {
  it("only names columns that exist and are the left-aligned text ones", () => {
    for (const id of WRAPPING_ROW_COLUMN_IDS) {
      const column = ALL_COLS.find((candidate) => candidate.id === id);
      expect(column, id).toBeDefined();
      expect(column?.align, id).toBe("left");
    }
  });
});

describe("normalizeRowHeights", () => {
  it("keeps per-SKU overrides, clamped like a single height", () => {
    expect(normalizeRowHeights({ "CA-SC-10-F-10-BK-1TO": 64, "CC-CS-03-M-GR-1TO": 9000 })).toEqual({
      "CA-SC-10-F-10-BK-1TO": 64,
      "CC-CS-03-M-GR-1TO": MAX_ROW_HEIGHT,
    });
  });

  it("drops entries that are not usable heights", () => {
    expect(normalizeRowHeights({ good: 40, empty: NaN, text: "60", nested: {}, "": 40 })).toEqual({ good: 40 });
  });

  it("returns an empty map for anything that is not an object", () => {
    for (const value of [undefined, null, 40, "x", []]) {
      expect(normalizeRowHeights(value)).toEqual({});
    }
  });
});

describe("Qty/Ctn column", () => {
  it("sits immediately left of CBM", () => {
    const ids = ALL_COLS.map((column) => column.id);
    expect(ids.indexOf("qty_ctn")).toBe(ids.indexOf("cbm") - 1);
  });

  it("reads case_qty, falling back to one per carton", () => {
    const column = ALL_COLS.find((candidate) => candidate.id === "qty_ctn");
    expect(column?.val({ case_qty: 3 } as never, 0, "ok")).toBe(3);
    expect(column?.val({} as never, 0, "ok")).toBe(1);
  });

  it("is offered to the Car Cover group only — every other category packs one per carton", () => {
    expect(columnAppliesToCategories("qty_ctn", ["cc", "swc", "ac"])).toBe(true);
    expect(columnAppliesToCategories("qty_ctn", ["sc"])).toBe(false);
    expect(columnAppliesToCategories("qty_ctn", ["fm"])).toBe(false);
  });

  it("leaves every other column alone", () => {
    for (const id of ["cbm", "sku", "row_num", "total"]) {
      expect(columnAppliesToCategories(id, ["sc"]), id).toBe(true);
      expect(columnAppliesToCategories(id, ["fm"]), id).toBe(true);
    }
  });
});

describe("normalizeDashboardFilters", () => {
  it("restores what was stored", () => {
    const filters = normalizeDashboardFilters({
      columnFilters: { sku: { mode: "values", values: ["A"] } },
      salesStatusFilter: ["Original", "Custom"],
      urgencyFilter: ["crit", "warn"],
      skuPartFilters: { seat: ["FRONT"], color: ["BK"] },
    });
    expect(filters.columnFilters.size).toBe(1);
    expect(filters.salesStatusFilter).toEqual(["Original", "Custom"]);
    expect(filters.urgencyFilter).toEqual(["crit", "warn"]);
    expect(filters.skuPartFilters.seat).toEqual(["FRONT"]);
    expect(filters.skuPartFilters.color).toEqual(["BK"]);
    expect(filters.skuPartFilters.make).toEqual([]);
  });

  it("restores a stored sort, and treats an unreadable one as none", () => {
    const withSort = normalizeDashboardFilters({
      sort: { key: "tot30", kind: "sales-group", order: { first: "Custom", originalDir: "asc", customDir: "desc" } },
    });
    expect(withSort.sort).toEqual({
      key: "tot30",
      kind: "sales-group",
      order: { first: "Custom", originalDir: "asc", customDir: "desc" },
    });
    expect(normalizeDashboardFilters({ sort: { key: "tot30", kind: "value" } }).sort).toBeNull();
    expect(normalizeDashboardFilters({}).sort).toBeNull();
  });

  it("falls back to no filters for anything unreadable", () => {
    for (const value of [null, undefined, "x", 5, []]) {
      const filters = normalizeDashboardFilters(value);
      expect(filters.columnFilters.size).toBe(0);
      expect(filters.salesStatusFilter).toEqual([]);
      expect(filters.urgencyFilter).toEqual([]);
    }
  });

  it("rejects values outside the known sets rather than trusting storage", () => {
    const filters = normalizeDashboardFilters({
      salesStatusFilter: ["Original", "bogus"],
      urgencyFilter: ["crit", "bogus"],
      skuPartFilters: { seat: "FRONT", unknownKey: ["x"] },
    });
    expect(filters.salesStatusFilter).toEqual(["Original"]);
    expect(filters.urgencyFilter).toEqual(["crit"]);
    expect(filters.skuPartFilters.seat).toEqual([]);
    expect("unknownKey" in filters.skuPartFilters).toBe(false);
  });
});

/** Only the fields the filter predicates read. */
function row(overrides: Partial<DemandRow> = {}): DemandRow {
  return {
    sku: "CA-SC-10-B-02-BK-1TO",
    sales_status: "Original",
    back: 0,
    ...overrides,
  } as DemandRow;
}

describe("normalizeDashboardFilters — reading what the single-choice selects stored", () => {
  it("reads each old product code as the one status it stood for", () => {
    const read = (productFilter: unknown) => normalizeDashboardFilters({ productFilter }).salesStatusFilter;
    expect(read("orig")).toEqual(["Original"]);
    expect(read("cust")).toEqual(["Custom"]);
    expect(read("part")).toEqual(["Part"]);
  });

  it("reads the old 'all' as no narrowing", () => {
    expect(normalizeDashboardFilters({ productFilter: "all" }).salesStatusFilter).toEqual([]);
    expect(normalizeDashboardFilters({ productFilter: "bogus" }).salesStatusFilter).toEqual([]);
  });

  it("reads a single stored urgency as a one-band selection", () => {
    expect(normalizeDashboardFilters({ urgencyFilter: "crit" }).urgencyFilter).toEqual(["crit"]);
    expect(normalizeDashboardFilters({ urgencyFilter: null }).urgencyFilter).toEqual([]);
    expect(normalizeDashboardFilters({ urgencyFilter: "bogus" }).urgencyFilter).toEqual([]);
  });

  it("prefers the new key when a blob carries both", () => {
    const filters = normalizeDashboardFilters({
      salesStatusFilter: ["Hold", "TBD"],
      productFilter: "orig",
    });
    expect(filters.salesStatusFilter).toEqual(["Hold", "TBD"]);
  });
});

describe("parseUrgencyParam", () => {
  it("reads the single value the home dashboard cards send", () => {
    expect(parseUrgencyParam("crit")).toEqual(["crit"]);
    expect(parseUrgencyParam("over")).toEqual(["over"]);
  });

  it("reads a comma list, and drops what it does not know", () => {
    expect(parseUrgencyParam("crit,warn")).toEqual(["crit", "warn"]);
    expect(parseUrgencyParam(" CRIT , bogus ")).toEqual(["crit"]);
    expect(parseUrgencyParam("crit,crit")).toEqual(["crit"]);
  });

  it("reads nothing as no selection", () => {
    expect(parseUrgencyParam(null)).toEqual([]);
    expect(parseUrgencyParam("")).toEqual([]);
    expect(parseUrgencyParam("nonsense")).toEqual([]);
  });
});

describe("matchesSalesStatusSelection", () => {
  it("lets everything through when nothing is ticked", () => {
    for (const status of ["Original", "Custom", "Part", "SWC", "Hold", "Discontinued", "TBD"] as const) {
      expect(matchesSalesStatusSelection(row({ sales_status: status }), [])).toBe(true);
    }
  });

  it("is an OR over the ticked statuses", () => {
    const picked = ["Original", "Custom"] as const;
    expect(matchesSalesStatusSelection(row({ sales_status: "Original" }), [...picked])).toBe(true);
    expect(matchesSalesStatusSelection(row({ sales_status: "Custom" }), [...picked])).toBe(true);
    // The combination the toolbar could not express before: Original and
    // Custom, with SWC and Discontinued left out.
    expect(matchesSalesStatusSelection(row({ sales_status: "SWC" }), [...picked])).toBe(false);
    expect(matchesSalesStatusSelection(row({ sales_status: "Discontinued" }), [...picked])).toBe(false);
  });

  it("can pick the four statuses the old select had no option for", () => {
    for (const status of ["SWC", "Hold", "Discontinued", "TBD"] as const) {
      expect(matchesSalesStatusSelection(row({ sales_status: status }), [status])).toBe(true);
      expect(matchesSalesStatusSelection(row({ sales_status: "Original" }), [status])).toBe(false);
    }
  });
});

describe("matchesUrgencySelection", () => {
  const critical = row({ back: -5 });
  const warning = row({ sod_days_raw: 45 } as Partial<DemandRow>);
  const healthy = row({ sod_days_raw: 100 } as Partial<DemandRow>);
  const overstocked = row({ sod_days_raw: 400 } as Partial<DemandRow>);

  it("lets everything through when nothing is ticked, healthy rows included", () => {
    for (const candidate of [critical, warning, healthy, overstocked]) {
      expect(matchesUrgencySelection(candidate, [])).toBe(true);
    }
  });

  it("is an OR over the ticked bands", () => {
    expect(matchesUrgencySelection(warning, ["crit", "warn"])).toBe(true);
    expect(matchesUrgencySelection(critical, ["crit", "warn"])).toBe(true);
    expect(matchesUrgencySelection(healthy, ["crit", "warn"])).toBe(false);
  });

  it("offers Overstock, which the old select had no option for at all", () => {
    expect(matchesUrgencySelection(overstocked, ["over"])).toBe(true);
    expect(matchesUrgencySelection(healthy, ["over"])).toBe(false);
  });

  it("reads BackOrder off the row rather than the urgency band", () => {
    expect(matchesUrgencySelection(critical, ["bo"])).toBe(true);
    expect(matchesUrgencySelection(row({ back: 3 }), ["bo"])).toBe(false);
    // A back-ordered row is also "crit" by urgStatus, so ticking both adds
    // nothing to ticking crit alone. Worth pinning: it looks like a bug.
    expect(matchesUrgencySelection(critical, ["crit"])).toBe(true);
  });
});

describe("matchesCategorySelection", () => {
  it("lets everything through when nothing is ticked", () => {
    expect(matchesCategorySelection(row({ category_code: "FM" }), [])).toBe(true);
  });

  it("matches on the stored category code", () => {
    expect(matchesCategorySelection(row({ category_code: "CC" }), ["cc"])).toBe(true);
    expect(matchesCategorySelection(row({ category_code: "CC" }), ["sc"])).toBe(false);
    expect(matchesCategorySelection(row({ category_code: "CC" }), ["sc", "cc"])).toBe(true);
  });

  it("falls back to the SKU string when the row has no category", () => {
    expect(matchesCategorySelection(row({ sku: "CC-1234" }), ["cc"])).toBe(true);
    expect(matchesCategorySelection(row({ sku: "CA-FM-9" }), ["fm"])).toBe(true);
    expect(matchesCategorySelection(row({ sku: "SOMETHING-ELSE" }), ["ac"])).toBe(true);
  });

  it("treats a ticked SWC as additive, pulling in rows from other categories", () => {
    const swcRow = row({ category_code: "SC", sales_status: "SWC" });
    expect(matchesCategorySelection(swcRow, ["swc"])).toBe(true);
    expect(matchesCategorySelection(row({ category_code: "SC" }), ["swc"])).toBe(false);
  });
});

describe("mergeMovedColumnOrder", () => {
  it("takes the dragged order as the new one", () => {
    expect(mergeMovedColumnOrder(["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });

  it("keeps columns the grid did not report, which is where hidden ones live", () => {
    // AG Grid reports displayed columns only, so a hidden column is absent
    // from the drag result and would be dropped by a plain assignment.
    expect(mergeMovedColumnOrder(["a", "hidden", "b"], ["b", "a"])).toEqual(["b", "a", "hidden"]);
  });

  it("is stable when nothing actually moved", () => {
    const current = ["a", "b", "c"];
    expect(sameColumnOrder(mergeMovedColumnOrder(current, current), current)).toBe(true);
  });
});

describe("sameColumnOrder", () => {
  it("compares position, not membership", () => {
    expect(sameColumnOrder(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameColumnOrder(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameColumnOrder(["a"], ["a", "b"])).toBe(false);
    expect(sameColumnOrder([], [])).toBe(true);
  });
});

describe("viewStateSubset", () => {
  const blob = { width: 1, height: 2, colour: "red" };

  it("takes only the keys asked for", () => {
    expect(viewStateSubset(blob, ["width"])).toEqual({ width: 1 });
    expect(viewStateSubset(blob, ["width", "colour"])).toEqual({ width: 1, colour: "red" });
  });

  it("keeps a key that is absent from the blob, as undefined", () => {
    // An undo step has to be able to say "this had no value before", which is
    // different from "leave this alone" — the latter is the key not appearing.
    const subset = viewStateSubset(blob, ["missing"]);
    expect("missing" in subset).toBe(true);
    expect(subset.missing).toBeUndefined();
  });

  it("takes nothing for no keys", () => {
    expect(viewStateSubset(blob, [])).toEqual({});
  });
});
