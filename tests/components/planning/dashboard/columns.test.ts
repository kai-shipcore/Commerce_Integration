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
