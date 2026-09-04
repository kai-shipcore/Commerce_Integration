import { describe, expect, it } from "vitest";
import { offsetContainerDate } from "@/lib/planning/container-schedule-dates";

describe("offsetContainerDate", () => {
  it("sets Est. Loading seven days before ETD NGB", () => {
    expect(offsetContainerDate("2026-09-10", -7)).toBe("2026-09-03");
  });

  it("sets Warehouse ETA seven days after ETA LAX/LGB across month boundaries", () => {
    expect(offsetContainerDate("2026-09-28", 7)).toBe("2026-10-05");
  });

  it("returns an empty value for empty or invalid dates", () => {
    expect(offsetContainerDate("", 7)).toBe("");
    expect(offsetContainerDate("2026-02-30", 7)).toBe("");
  });
});

