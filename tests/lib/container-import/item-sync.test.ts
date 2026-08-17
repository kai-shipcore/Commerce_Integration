import { describe, expect, it } from "vitest";
import { planContainerItemSync } from "@/lib/container-import/item-sync";

describe("planContainerItemSync", () => {
  it("removes sheet-missing and duplicate rows while retaining one matching row", () => {
    const plan = planContainerItemSync({
      containerNames: ["112-CA"],
      sourceRows: [
        { masterSku: "SKU-A", qtys: { "112-CA": 10 } },
        { masterSku: "SKU-ZERO", qtys: {} },
      ],
      validSkus: new Set(["SKU-A", "SKU-ZERO"]),
      existingItems: [
        { id: "1", containerId: "112", masterSku: "SKU-A" },
        { id: "2", containerId: "112", masterSku: "SKU-A" },
        { id: "3", containerId: "112", masterSku: "SKU-ZERO" },
        { id: "4", containerId: "112", masterSku: "OLD-SKU" },
      ],
      containerIdToName: new Map([["112", "112-CA"]]),
    });

    expect(plan.retainedItemIds.get("112-CA")?.get("SKU-A")).toBe("1");
    expect(plan.staleItemIds).toEqual(["2", "3", "4"]);
  });

  it("is idempotent when the DB already matches the sheet", () => {
    const plan = planContainerItemSync({
      containerNames: ["112-CA"],
      sourceRows: [{ masterSku: "SKU-A", qtys: { "112-CA": 10 } }],
      validSkus: new Set(["SKU-A"]),
      existingItems: [{ id: "1", containerId: "112", masterSku: "SKU-A" }],
      containerIdToName: new Map([["112", "112-CA"]]),
    });

    expect(plan.staleItemIds).toEqual([]);
    expect(plan.retainedItemIds.get("112-CA")?.get("SKU-A")).toBe("1");
  });
});
