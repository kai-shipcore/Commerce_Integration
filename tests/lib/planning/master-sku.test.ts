import { describe, it, expect } from "vitest";

import { isPartMasterSku, normalizeMasterSku, partMasterSkuSql, toFinalMasterSku } from "@/lib/planning/master-sku";

describe("toFinalMasterSku", () => {
  it("renames the discontinued TN line to TNS", () => {
    expect(toFinalMasterSku("CC-TN-03-S-GR-1TO")).toBe("CC-TNS-03-S-GR-1TO");
  });

  it("renames the discontinued BKGR colour to BKLG", () => {
    expect(toFinalMasterSku("CC-SS-15-K-BKGR-STR")).toBe("CC-SS-15-K-BKLG-STR");
  });

  it("applies both remaps at once — they live on different segments", () => {
    expect(toFinalMasterSku("CC-TN-15-V-BKGR-STR")).toBe("CC-TNS-15-V-BKLG-STR");
  });

  it("returns SKUs that are already final unchanged", () => {
    expect(toFinalMasterSku("CC-TNS-15-V-BKLG-STR")).toBe("CC-TNS-15-V-BKLG-STR");
    expect(toFinalMasterSku("CC-CN-15-D-BKRD-STR")).toBe("CC-CN-15-D-BKRD-STR");
  });

  it("only rewrites the line and colour segments, never a like-named one elsewhere", () => {
    // 'BKGR' sitting anywhere but segment 4 is a different field.
    expect(toFinalMasterSku("CC-SS-15-BKGR-K-STR")).toBe("CC-SS-15-BKGR-K-STR");
  });

  it("leaves seat cover and floor mat SKUs alone", () => {
    expect(toFinalMasterSku("CA-SC-10-F-10-BK-1TO")).toBe("CA-SC-10-F-10-BK-1TO");
    expect(toFinalMasterSku("CA-FM-80-TN")).toBe("CA-FM-80-TN");
  });

  it("is not the same thing as normalizeMasterSku — that one merges rows", () => {
    expect(normalizeMasterSku("CC-TN-03-S-GR-1TO")).toBe("CC-TN-03-S-GR-1TO");
  });
});

describe("isPartMasterSku", () => {
  it("recognises PART as a hyphen-delimited segment", () => {
    expect(isPartMasterSku("CA-SC-PART-ARM5-BR")).toBe(true);
    expect(isPartMasterSku("CA-SC-PART-ARMREST-FF25-DB")).toBe(true);
    expect(isPartMasterSku("CA-SC-PART-BB-D-WR-D")).toBe(true);
  });

  it("recognises the aggregate part rows, where PART(S) is the last segment", () => {
    expect(isPartMasterSku("INDV-SEAT-COVER-PART")).toBe(true);
    expect(isPartMasterSku("BACK-SEAT-COVER-PARTS")).toBe(true);
    expect(isPartMasterSku("FRONT-SEAT-COVER-PARTS")).toBe(true);
  });

  it("leaves ordinary product SKUs alone", () => {
    expect(isPartMasterSku("CA-SC-10-F-10-BK-1TO")).toBe(false);
    expect(isPartMasterSku("CC-CS-03-M-GR-1TO")).toBe(false);
    expect(isPartMasterSku("CA-SWC-SC-01-BK")).toBe(false);
  });

  it("does not match a word that merely starts with PART", () => {
    expect(isPartMasterSku("CA-SC-PARTNER-BK")).toBe(false);
    expect(isPartMasterSku("CA-SC-PARTIAL-BK")).toBe(false);
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(isPartMasterSku("  ca-sc-part-arm5-br  ")).toBe(true);
  });
});

describe("partMasterSkuSql", () => {
  it("matches the same rule against the given SQL expression", () => {
    const sql = partMasterSkuSql("p.master_sku");
    expect(sql).toContain("p.master_sku");
    expect(sql).toContain("~*");
    expect(sql).toContain("(^|-)PARTS?(-|$)");
  });
});
