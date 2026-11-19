import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  localDateKey,
  monthGridDates,
  offsetContainerDate,
} from "@/lib/planning/container-schedule-dates";

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

describe("localDateKey", () => {
  it("is the local calendar date of a local midnight, in any timezone", () => {
    expect(localDateKey(new Date(2026, 10, 30))).toBe("2026-11-30");
    expect(localDateKey(new Date(2026, 0, 1))).toBe("2026-01-01");
  });
});

describe("addCalendarDays", () => {
  it("moves one date per day across a daylight saving change", () => {
    // US clocks go back on 2026-11-01 and forward on 2026-03-08.
    expect(localDateKey(addCalendarDays(new Date(2026, 10, 1), 1))).toBe("2026-11-02");
    expect(localDateKey(addCalendarDays(new Date(2026, 2, 8), 1))).toBe("2026-03-09");
    expect(localDateKey(addCalendarDays(new Date(2026, 10, 2), -40))).toBe("2026-09-23");
  });
});

describe("monthGridDates", () => {
  it("lays November 2026 out Monday-first with every date once", () => {
    const keys = monthGridDates(2026, 10).map(localDateKey);

    expect(keys).toHaveLength(42);
    expect(keys[0]).toBe("2026-10-26");
    expect(keys[6]).toBe("2026-11-01");
    expect(keys[7]).toBe("2026-11-02");
    expect(keys[35]).toBe("2026-11-30");
    expect(keys[41]).toBe("2026-12-06");
    expect(new Set(keys).size).toBe(42);
  });

  it("puts each date under its own weekday", () => {
    for (const month of [2, 10]) {
      monthGridDates(2026, month).forEach((date, index) => {
        expect((date.getDay() + 6) % 7).toBe(index % 7);
        expect(date.getHours()).toBe(0);
      });
    }
  });
});
