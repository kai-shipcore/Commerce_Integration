import { describe, expect, it } from "vitest";
import { CHANGED_ADS_FILL, changedAdsFill } from "@/lib/planning/display-colors";

describe("planning display colors", () => {
  it("exposes edited ADS cells as the same red used by Filter by Color", () => {
    expect(changedAdsFill("tavg_c", { total_avg_curr_override: 0 })).toBe(CHANGED_ADS_FILL);
    expect(changedAdsFill("tavg_r", { total_avg_real_override: 12 })).toBe(CHANGED_ADS_FILL);
  });

  it("does not color unedited ADS or unrelated columns", () => {
    expect(changedAdsFill("tavg_c", { total_avg_curr_override: null })).toBe("");
    expect(changedAdsFill("fm02_2nd", { total_avg_curr_override: 12 })).toBe("");
  });
});
