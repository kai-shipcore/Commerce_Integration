import { describe, expect, it } from "vitest";
import {
  ALL_COLS,
  ALL_GROUP_KEYS,
  ensureAdditionalNotesInColumnOrder,
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
