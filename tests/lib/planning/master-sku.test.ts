import { describe, it, expect } from "vitest";

import { normalizeMasterSku, toFinalMasterSku } from "@/lib/planning/master-sku";

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
