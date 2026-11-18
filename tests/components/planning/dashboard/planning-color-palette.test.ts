import { describe, expect, it } from "vitest";
import {
  addSavedCustomColor,
  normalizeSavedCustomColors,
  removeSavedCustomColor,
} from "@/components/planning/dashboard/planning-color-palette";

describe("saved planning colors", () => {
  it("normalizes, deduplicates, and rejects invalid saved colors", () => {
    expect(normalizeSavedCustomColors(["#ffe599", "#FFE599", "red", null])).toEqual(["#FFE599"]);
  });

  it("saves the newest color first and deletes it", () => {
    const saved = addSavedCustomColor(["#FFE599"], "#fecaca");
    expect(saved).toEqual(["#FECACA", "#FFE599"]);
    expect(removeSavedCustomColor(saved, "#fecaca")).toEqual(["#FFE599"]);
  });
});
