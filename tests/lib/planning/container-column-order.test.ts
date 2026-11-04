import { describe, expect, it } from "vitest";

import { keepContainerColumnsTogether, resetContainerSubcolumnOrder } from "@/lib/planning/container-column-order";

describe("keepContainerColumnsTogether", () => {
  it("allows a formula to stay between native columns in a container", () => {
    expect(keepContainerColumnsTogether([
      "sku",
      "209::con_qty",
      "formula:calc-1",
      "209::rem_qty",
      "209::open_ord",
      "next_eta",
    ])).toEqual([
      "sku",
      "209::con_qty",
      "formula:calc-1",
      "209::rem_qty",
      "209::open_ord",
      "next_eta",
    ]);
  });

  it("keeps a custom column in place while separating interleaved containers", () => {
    expect(keepContainerColumnsTogether([
      "A::con_qty",
      "formula:custom",
      "B::con_qty",
      "A::rem_qty",
      "B::rem_qty",
    ])).toEqual([
      "A::con_qty",
      "formula:custom",
      "A::rem_qty",
      "B::con_qty",
      "B::rem_qty",
    ]);
  });

  it("restores interleaved container columns as separate atomic blocks", () => {
    expect(keepContainerColumnsTogether([
      "A::con_qty",
      "B::con_qty",
      "A::rem_qty",
      "B::rem_qty",
    ])).toEqual([
      "A::con_qty",
      "A::rem_qty",
      "B::con_qty",
      "B::rem_qty",
    ]);
  });

  it("does not change an already valid order", () => {
    const order = ["sku", "A::con_qty", "A::rem_qty", "formula:calc-1", "B::con_qty", "B::rem_qty"];
    expect(keepContainerColumnsTogether(order)).toEqual(order);
  });
});

describe("resetContainerSubcolumnOrder", () => {
  it("restores moved cells to the canonical container order", () => {
    expect(resetContainerSubcolumnOrder(
      "209-CA-SEAT-2",
      ["209-CA-SEAT-2::avail", "209-CA-SEAT-2::con_qty", "209-CA-SEAT-2::rem_qty"],
      ["con_qty", "rem_qty", "avail"],
    )).toEqual([
      "209-CA-SEAT-2::con_qty",
      "209-CA-SEAT-2::rem_qty",
      "209-CA-SEAT-2::avail",
    ]);
  });

  it("keeps unknown columns without letting them displace known columns", () => {
    expect(resetContainerSubcolumnOrder(
      "A",
      ["A::custom", "A::rem_qty", "A::con_qty"],
      ["con_qty", "rem_qty", "avail"],
    )).toEqual(["A::con_qty", "A::rem_qty", "A::custom", "A::avail"]);
  });
});
