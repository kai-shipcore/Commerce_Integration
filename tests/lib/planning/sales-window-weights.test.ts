import { describe, expect, it } from "vitest";
import { labelWithSalesWindowWeight } from "@/lib/planning/sales-window-weights";

describe("labelWithSalesWindowWeight", () => {
  it("uses the fixed source-sheet weights for FBA columns", () => {
    const customFbmWeights = { d90: 1, d60: 1, d30: 1, d15: 1, d7: 1, pre: 1 };
    expect(labelWithSalesWindowWeight("f90", "FBA 90D", customFbmWeights)).toBe("FBA 90D · 15%");
    expect(labelWithSalesWindowWeight("f60", "FBA 60D", customFbmWeights)).toBe("FBA 60D · 20%");
    expect(labelWithSalesWindowWeight("f30", "FBA 30D", customFbmWeights)).toBe("FBA 30D · 30%");
    expect(labelWithSalesWindowWeight("f15", "FBA 15D", customFbmWeights)).toBe("FBA 15D · 20%");
    expect(labelWithSalesWindowWeight("f7", "FBA 7D", customFbmWeights)).toBe("FBA 7D · 15%");
    expect(labelWithSalesWindowWeight("fpre", "FBA Pre 30D", customFbmWeights)).toBe("FBA Pre 30D · 0%");
  });
});
