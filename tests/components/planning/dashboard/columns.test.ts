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
  normalizeHeaderHeight,
  normalizeRowHeight,
  normalizeRowHeights,
} from "@/components/planning/dashboard/columns";

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
      productFilter: "cust",
      urgencyFilter: "crit",
      skuPartFilters: { seat: ["FRONT"], color: ["BK"] },
    });
    expect(filters.columnFilters.size).toBe(1);
    expect(filters.productFilter).toBe("cust");
    expect(filters.urgencyFilter).toBe("crit");
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
      expect(filters.productFilter).toBe("all");
      expect(filters.urgencyFilter).toBeNull();
    }
  });

  it("rejects values outside the known sets rather than trusting storage", () => {
    const filters = normalizeDashboardFilters({
      productFilter: "bogus",
      urgencyFilter: "bogus",
      skuPartFilters: { seat: "FRONT", unknownKey: ["x"] },
    });
    expect(filters.productFilter).toBe("all");
    expect(filters.urgencyFilter).toBeNull();
    expect(filters.skuPartFilters.seat).toEqual([]);
    expect("unknownKey" in filters.skuPartFilters).toBe(false);
  });
});
