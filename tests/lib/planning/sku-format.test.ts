import { describe, it, expect } from "vitest";
import {
  carCoverSegments,
  carCoverSkuSql,
  isCarCoverSku,
  isSteeringWheelSku,
  parseUnifiedSku,
  steeringWheelSkuSql,
} from "@/lib/planning/sku-format";
import { toFinalMasterSku } from "@/lib/planning/master-sku";
import { forecastCategoryCodeForSku, isCarCover03Sku, sheetContainerEstimatedSales } from "@/lib/planning/forecast-calculations";
import { colorRuleReference, type ColorReferenceRule } from "@/lib/planning/reference-sales";
import { floorMatMasterLabel } from "@/lib/planning/floor-mat-pairing";
import { inferProduct } from "@/lib/sku-master/repository";
import { categoryCodeForRow, skuPartsForRow } from "@/components/planning/dashboard/columns";
import type { DemandRow } from "@/types/demand-planning";

// The planning team's sheet, 2026-11-18: [current SKU, SKU after the change].
const CAR_COVERS = [
  ["CC-CN-15-B-BKLG-STR", "CA-CC-15-CN-B-BKLG-STR"],
  ["CC-CN-03-D-GR-1TO", "CA-CC-03-CN-D-GR-1TO"],
  ["CC-CC-03-CHCV15-BK-1TO", "CA-CC-03-CC-CHCV15-BK-1TO"],
] as const;
const STEERING_WHEELS = [
  ["CA-SWC-05-38-BKBK", "CA-SW-13-AG-38-BK-1TO"],
  ["CA-SWC-10-38-BKRD", "CA-SW-13-ST-38-BKRD-2TO"],
  ["CA-SWC-10-38-BKBK", "CA-SW-13-SD-38-BK-1TO"],
] as const;
const FLOOR_MATS = [
  ["CA-FM-80-FM13726", "CA-FM-80-FS-13726-BK-1TO"],
  ["CA-FM-TX-80-S3-BM-X705", "CA-FM-80-S3-BM-X705-BK-1TO"],
] as const;

describe("isCarCoverSku / isSteeringWheelSku", () => {
  it("recognises a car cover in both formats", () => {
    for (const sku of CAR_COVERS.flat()) expect(isCarCoverSku(sku)).toBe(true);
    expect(isCarCoverSku(" cc-cn-15-b-bklg-str ")).toBe(true);
    expect(isCarCoverSku("CA-SC-10-F-10-BK-1TO")).toBe(false);
    expect(isCarCoverSku("CA-FM-80-FS-13726-BK-1TO")).toBe(false);
  });

  it("recognises a steering wheel cover in both formats, and the one staying on its old code", () => {
    for (const sku of STEERING_WHEELS.flat()) expect(isSteeringWheelSku(sku)).toBe(true);
    expect(isSteeringWheelSku("CA-SWC-03-38-BKDI")).toBe(true); // discontinued, not renamed
    expect(isSteeringWheelSku("CA-10-SWC-47-BKBK")).toBe(true); // before the 2026-07 rename
    expect(isSteeringWheelSku("CA-SC-10-F-10-BK-1TO")).toBe(false);
    expect(isSteeringWheelSku("CA-WS-01-W-15113-BKSV-2TO")).toBe(false);
  });

  it("builds the same rules as SQL", () => {
    expect(carCoverSkuSql("s.master_sku")).toBe("(UPPER(s.master_sku) LIKE 'CC-%' OR UPPER(s.master_sku) LIKE 'CA-CC-%')");
    expect(steeringWheelSkuSql("x")).toBe("(UPPER(x) LIKE '%SWC%' OR UPPER(x) LIKE 'CA-SW-%')");
  });
});

describe("carCoverSegments", () => {
  const read = (sku: string) => {
    const segments = carCoverSegments(sku)!;
    const at = (index: number | null) => (index === null ? null : segments.parts[index]);
    return { line: at(segments.line), fabric: at(segments.fabric), size: at(segments.size), color: at(segments.color), style: at(segments.style) };
  };

  it("reads the same parts from the current and the unified SKU of one product", () => {
    expect(read("CC-CN-15-B-BKLG-STR")).toEqual({ line: "CN", fabric: "15", size: "B", color: "BKLG", style: "STR" });
    for (const [current, unified] of CAR_COVERS) expect(read(unified)).toEqual(read(current));
  });

  it("reads a custom cover, whose line is CC", () => {
    expect(read("CA-CC-03-CC-CHCV15-BK-1TO")).toEqual({ line: "CC", fabric: "03", size: "CHCV15", color: "BK", style: "1TO" });
  });

  it("reads the oldest SKUs, which have no line", () => {
    expect(read("CC-15-B-BKLG-STR")).toEqual({ line: null, fabric: "15", size: "B", color: "BKLG", style: "STR" });
  });

  it("is null for anything that is not a car cover", () => {
    expect(carCoverSegments("CA-SC-10-F-10-BK-1TO")).toBeNull();
    expect(carCoverSegments("CA-SW-13-AG-38-BK-1TO")).toBeNull();
  });
});

describe("parseUnifiedSku", () => {
  it("reads every product on the sheet", () => {
    expect(parseUnifiedSku("CA-CC-15-CN-B-BKLG-STR")).toEqual({ product: "CC", material: "15", identifier1: "CN", identifier2: "B", color: "BKLG", style: "STR" });
    expect(parseUnifiedSku("CA-SW-13-ST-38-BKRD-2TO")).toEqual({ product: "SW", material: "13", identifier1: "ST", identifier2: "38", color: "BKRD", style: "2TO" });
    expect(parseUnifiedSku("CA-FM-80-FS-13726-BK-1TO")).toEqual({ product: "FM", material: "80", identifier1: "FS", identifier2: "13726", color: "BK", style: "1TO" });
    expect(parseUnifiedSku("CA-SC-10-F-10-BK-1TO")).toEqual({ product: "SC", material: "10", identifier1: "F", identifier2: "10", color: "BK", style: "1TO" });
    expect(parseUnifiedSku("CA-NP-15-F-01-BK-1TO")).toMatchObject({ product: "NP", identifier1: "F", identifier2: "01" });
    expect(parseUnifiedSku("CA-TW-71-4PS-02-MIX-4TO")).toMatchObject({ product: "TW", identifier1: "4PS", color: "MIX", style: "4TO" });
    expect(parseUnifiedSku("CA-WS-01-W-15113-BKSV-2TO")).toMatchObject({ product: "WS", identifier2: "15113", color: "BKSV" });
  });

  it("keeps a hyphen inside the second identifier", () => {
    expect(parseUnifiedSku("CA-FM-80-S3-BM-X705-BK-1TO")).toEqual({
      product: "FM", material: "80", identifier1: "S3", identifier2: "BM-X705", color: "BK", style: "1TO",
    });
  });

  it("is null for a SKU in the current format", () => {
    for (const sku of [
      "CC-CN-15-B-BKLG-STR", "CA-SWC-05-38-BKBK", "CA-FM-80-FM13726",
      "CA-FM-TX-80-S3-BM-X705", // seven segments, but TX sits where the material goes
      "CA-NP-01-BK", "CA-TW-02-MIX", "CA-WS-10-WS15113",
    ]) expect(parseUnifiedSku(sku)).toBeNull();
  });
});

describe("the planning logic reads both formats alike", () => {
  it("classifies a new SKU the same as the one it replaces", () => {
    for (const [current, unified] of [...CAR_COVERS, ...STEERING_WHEELS, ...FLOOR_MATS]) {
      expect(inferProduct(unified).categoryCode).toBe(inferProduct(current).categoryCode);
      expect(inferProduct(unified).moq).toBe(inferProduct(current).moq);
      expect(inferProduct(unified).cbmPerUnit).toBe(inferProduct(current).cbmPerUnit);
      const row = (sku: string) => ({ sku, category_code: null }) as unknown as DemandRow;
      expect(categoryCodeForRow(row(unified))).toBe(categoryCodeForRow(row(current)));
    }
    expect(inferProduct("CA-SW-13-AG-38-BK-1TO").categoryCode).toBe("SWC");
    expect(inferProduct("CA-CC-15-CN-B-BKLG-STR").categoryCode).toBe("CC");
  });

  it("uses the car cover average for a unified car cover SKU", () => {
    for (const [current, unified] of CAR_COVERS) {
      expect(forecastCategoryCodeForSku(current)).toBe("CC");
      expect(forecastCategoryCodeForSku(unified)).toBe("CC");
    }
    expect(forecastCategoryCodeForSku("CA-FM-80-FS-13726-BK-1TO")).toBe("FM");
    expect(forecastCategoryCodeForSku("CA-SC-10-F-10-BK-1TO")).toBe("SC");
  });

  it("applies the Fabric 03 back order rule in both formats", () => {
    expect(isCarCover03Sku("CC-CN-03-D-GR-1TO")).toBe(true);
    expect(isCarCover03Sku("CA-CC-03-CN-D-GR-1TO")).toBe(true);
    expect(isCarCover03Sku("CA-CC-15-CN-B-BKLG-STR")).toBe(false);
    // A car cover with nothing available sells nothing until stock arrives.
    expect(sheetContainerEstimatedSales("CC-CN-15-B-BKLG-STR", 10, 2, 1, 0, 0)).toBe(0);
    expect(sheetContainerEstimatedSales("CA-CC-15-CN-B-BKLG-STR", 10, 2, 1, 0, 0)).toBe(0);
  });

  it("rolls a discontinued line and colour onto the final SKU in both formats", () => {
    expect(toFinalMasterSku("CC-TN-15-B-BKGR-STR")).toBe("CC-TNS-15-B-BKLG-STR");
    expect(toFinalMasterSku("CA-CC-15-TN-B-BKGR-STR")).toBe("CA-CC-15-TNS-B-BKLG-STR");
    expect(toFinalMasterSku("CA-CC-15-CN-B-BKLG-STR")).toBe("CA-CC-15-CN-B-BKLG-STR");
    // The size of a unified SKU sits where the current format keeps the colour.
    expect(toFinalMasterSku("CA-CC-15-CN-BKGR-BK-1TO")).toBe("CA-CC-15-CN-BKGR-BK-1TO");
  });

  it("pairs colours by rule in both formats", () => {
    const rule: ColorReferenceRule[] = [{ categoryCode: "CC", material: "03", color: "BK", referenceColor: "GR", pct: 30 }];
    expect(colorRuleReference("CC-TT-03-Y-BK-1TO", rule)).toEqual({ referenceSku: "CC-TT-03-Y-GR-1TO", pct: 30 });
    expect(colorRuleReference("CA-CC-03-TT-Y-BK-1TO", rule)).toEqual({ referenceSku: "CA-CC-03-TT-Y-GR-1TO", pct: 30 });
    expect(colorRuleReference("CA-CC-15-TT-Y-BK-1TO", rule)).toBeNull(); // another fabric
  });

  it("fills the grid's car cover filters the same for both formats", () => {
    const parts = (sku: string) => skuPartsForRow({ sku, seat: "", no: 0, color: "", tone: "", category_code: "CC" });
    for (const [current, unified] of CAR_COVERS) expect(parts(unified)).toEqual(parts(current));
    expect(parts("CA-CC-15-CN-B-BKLG-STR")).toMatchObject({ formula: "CN", fabric: "15", size: "B", color: "BKLG", type: "STR" });
  });

  it("fills the grid's filters for a unified steering wheel and floor mat SKU", () => {
    expect(skuPartsForRow({ sku: "CA-SW-13-AG-38-BK-1TO", seat: "", no: 0, color: "", tone: "", category_code: "SWC" }))
      .toMatchObject({ formula: "AG", fabric: "13", size: "38", color: "BK", type: "1TO" });
    expect(skuPartsForRow({ sku: "CA-FM-80-S3-BM-X705-BK-1TO", seat: "", no: 0, color: "", tone: "", category_code: "FM" }))
      .toMatchObject({ prefix: "CA", productCode: "FM", material: "80", vehiclePosition: "S3", make: "BM", model: "X705" });
    expect(skuPartsForRow({ sku: "CA-FM-80-FS-13726-BK-1TO", seat: "", no: 0, color: "", tone: "", category_code: "FM" }))
      .toMatchObject({ material: "80", vehiclePosition: "FS", make: "", model: "13726" });
  });

  it("labels a floor mat by the code on its box", () => {
    expect(floorMatMasterLabel("CA-FM-80-FM13726")).toBe("FM13726");
    expect(floorMatMasterLabel("CA-FM-80-FS-13726-BK-1TO")).toBe("FS-13726");
    expect(floorMatMasterLabel("CA-FM-80-S3-BM-X705-BK-1TO")).toBe("S3-BM-X705");
  });
});
