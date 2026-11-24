import { beforeEach, describe, expect, it, vi } from "vitest";

const getDashboardDataMock = vi.fn();
const workbenchConfigMock = vi.fn();
const workbenchRequestMock = vi.fn();

vi.mock("@/lib/demand-planning/service", () => ({
  DemandPlanningService: { getDashboardData: getDashboardDataMock },
}));
vi.mock("@/lib/workbench-container-push/repository", () => ({
  WorkbenchContainerPushRepository: { listContainers: vi.fn() },
}));
vi.mock("@/lib/workbench/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workbench/client")>("@/lib/workbench/client");
  return { ...actual, workbenchConfig: workbenchConfigMock, workbenchRequest: workbenchRequestMock };
});

const { WorkbenchApiError } = await import("@/lib/workbench/client");
const {
  WorkbenchSalesRatePushService,
  chunkSalesRates,
  parseSalesRateRejection,
  prepareSalesRates,
} = await import("@/lib/workbench-sales-rate-push/service");

const config = { baseUrl: "https://staging.cowork.coverland.com", apiKey: "test-key" };
const IMPORT_PATH = "/api/v1/master-product-sales-rates/import";

type Product = { sku: string; dailyAverageQuantity: number };

function dashboardRows(rows: { sku: string; total_avg_curr: number }[]) {
  getDashboardDataMock.mockResolvedValue({ data: { rows }, cacheStatus: "MISS" });
}

function rejection(problems: string[], total = problems.length) {
  const more = total > problems.length ? `; and ${total - problems.length} more problems` : "";
  const message = `Sales rate import rejected; nothing was saved (${total} problems): ${problems.join("; ")}${more}`;
  return new WorkbenchApiError(`Workbench POST ${IMPORT_PATH} → 422: ${message}`, 422, 40000, message);
}

/** Every import request's products, in order. */
function importedBatches(): Product[][] {
  return workbenchRequestMock.mock.calls
    .filter(([, method, path]) => method === "POST" && path === IMPORT_PATH)
    .map(([, , , options]) => (options as { body: { products: Product[] } }).body.products);
}

beforeEach(() => {
  vi.clearAllMocks();
  workbenchConfigMock.mockReturnValue(config);
});

describe("prepareSalesRates", () => {
  it("keeps one rate per SKU without regard to case, rounded to four places", () => {
    expect(
      prepareSalesRates([
        { sku: " CC-1 ", total_avg_curr: 1.234567 },
        { sku: "cc-1", total_avg_curr: 9 },
        { sku: "SC-1", total_avg_curr: 0 },
      ]),
    ).toEqual([
      { sku: "CC-1", dailyAverageQuantity: 1.2346 },
      { sku: "SC-1", dailyAverageQuantity: 0 },
    ]);
  });

  it("leaves out a row without a SKU or with no usable figure", () => {
    expect(
      prepareSalesRates([
        { sku: "", total_avg_curr: 1 },
        { sku: "A", total_avg_curr: null },
        { sku: "B", total_avg_curr: Number.NaN },
        { sku: "C", total_avg_curr: -1 },
      ]),
    ).toEqual([]);
  });
});

describe("parseSalesRateRejection", () => {
  it("reads unknown and draft SKUs, whose problem carries a semicolon of its own", () => {
    const parsed = parseSalesRateRejection(
      "Sales rate import rejected; nothing was saved (3 problems): unknown SKU A-1; SKU B-2 is a draft product; activate it first; SKU C-3 dailyAverageQuantity must be from 0 to 99999999.9999",
    );

    expect(parsed).toEqual({
      unknown: ["A-1"],
      draft: ["B-2"],
      other: ["SKU C-3 dailyAverageQuantity must be from 0 to 99999999.9999"],
      truncated: false,
    });
  });

  it("says when Workbench listed fewer problems than it counted", () => {
    const parsed = parseSalesRateRejection(
      "Sales rate import rejected; nothing was saved (52 problems): unknown SKU A-1; unknown SKU A-2; and 50 more problems",
    );

    expect(parsed?.unknown).toEqual(["A-1", "A-2"]);
    expect(parsed?.truncated).toBe(true);
  });

  it("answers null for a message that lists no problems", () => {
    expect(parseSalesRateRejection("Validation failed")).toBeNull();
  });
});

describe("chunkSalesRates", () => {
  it("splits into requests of at most 1,000 products", () => {
    const rates = Array.from({ length: 2_001 }, (_, index) => ({ sku: `S-${index}`, dailyAverageQuantity: 1 }));

    expect(chunkSalesRates(rates).map((chunk) => chunk.length)).toEqual([1_000, 1_000, 1]);
  });
});

describe("WorkbenchSalesRatePushService.push", () => {
  it("is skipped when Workbench is not configured", async () => {
    workbenchConfigMock.mockReturnValue(null);

    const result = await WorkbenchSalesRatePushService.push();

    expect(result).toEqual({ status: "skipped", reason: "WORKBENCH_API_URL or WORKBENCH_API_KEY is not set" });
    expect(getDashboardDataMock).not.toHaveBeenCalled();
  });

  it("sends every active SKU's T.Avg current, read with the Sync's own weights", async () => {
    dashboardRows([
      { sku: "CC-1", total_avg_curr: 2.5 },
      { sku: "SC-1", total_avg_curr: 0.03 },
    ]);
    workbenchRequestMock.mockResolvedValue({ data: { received: 2, changed: 1 } });
    const weights = { d90: 0.2 };

    const result = await WorkbenchSalesRatePushService.push({ requestId: "job-1", salesWindowWeights: weights });

    expect(getDashboardDataMock).toHaveBeenCalledWith({
      mode: "custom",
      includeContainers: false,
      rawContainers: false,
      includeDrafts: false,
      categoryCodes: null,
      asOf: null,
      salesWeightsParam: JSON.stringify(weights),
    });
    expect(importedBatches()).toEqual([
      [
        { sku: "CC-1", dailyAverageQuantity: 2.5 },
        { sku: "SC-1", dailyAverageQuantity: 0.03 },
      ],
    ]);
    expect(result).toMatchObject({
      status: "succeeded",
      target: "staging.cowork.coverland.com",
      considered: 2,
      sent: 2,
      changed: 1,
      unknownSkuCount: 0,
      draftSkuCount: 0,
      failed: 0,
      errors: [],
    });
  });

  it("takes out the SKUs Workbench does not have or holds as drafts, and sends the rest again", async () => {
    dashboardRows([
      { sku: "KNOWN", total_avg_curr: 1 },
      { sku: "MISSING", total_avg_curr: 2 },
      { sku: "DRAFT", total_avg_curr: 3 },
    ]);
    workbenchRequestMock
      .mockRejectedValueOnce(rejection(["unknown SKU MISSING", "SKU draft is a draft product; activate it first"]))
      .mockResolvedValueOnce({ data: { received: 1, changed: 1 } });

    const result = await WorkbenchSalesRatePushService.push();

    expect(importedBatches()[1]).toEqual([{ sku: "KNOWN", dailyAverageQuantity: 1 }]);
    expect(result).toMatchObject({
      status: "succeeded",
      considered: 3,
      sent: 1,
      unknownSkuCount: 1,
      draftSkuCount: 1,
      notSentSkus: ["MISSING", "draft"],
      failed: 0,
    });
  });

  it("reads Workbench's catalogue once when a rejection is cut short", async () => {
    dashboardRows([
      { sku: "KNOWN", total_avg_curr: 1 },
      { sku: "GONE-1", total_avg_curr: 2 },
      { sku: "GONE-2", total_avg_curr: 3 },
    ]);
    workbenchRequestMock.mockImplementation((_config: unknown, method: string, path: string) => {
      if (method === "GET" && path === "/api/v1/master-products") {
        return Promise.resolve({ data: [{ sku: "known" }], meta: { pagination: { total: 1 } } });
      }
      const sent = importedBatches().at(-1) ?? [];
      return sent.length > 1
        ? Promise.reject(rejection(["unknown SKU GONE-1"], 2))
        : Promise.resolve({ data: { received: sent.length, changed: 0 } });
    });

    const result = await WorkbenchSalesRatePushService.push();

    expect(importedBatches()).toEqual([
      [
        { sku: "KNOWN", dailyAverageQuantity: 1 },
        { sku: "GONE-1", dailyAverageQuantity: 2 },
        { sku: "GONE-2", dailyAverageQuantity: 3 },
      ],
      [{ sku: "KNOWN", dailyAverageQuantity: 1 }],
    ]);
    expect(result).toMatchObject({ status: "succeeded", sent: 1, unknownSkuCount: 2, failed: 0 });
  });

  it("sends a request again once after a 409", async () => {
    dashboardRows([{ sku: "CC-1", total_avg_curr: 1 }]);
    workbenchRequestMock
      .mockRejectedValueOnce(new WorkbenchApiError("conflict", 409, 40001))
      .mockResolvedValueOnce({ data: { received: 1, changed: 0 } });

    const result = await WorkbenchSalesRatePushService.push();

    expect(importedBatches()).toHaveLength(2);
    expect(result).toMatchObject({ status: "succeeded", sent: 1 });
  });

  it("stops at an outage and counts every rate not saved", async () => {
    dashboardRows(Array.from({ length: 1_500 }, (_, index) => ({ sku: `S-${index}`, total_avg_curr: 1 })));
    workbenchRequestMock.mockRejectedValue(new WorkbenchApiError("Workbench did not answer", 0));

    const result = await WorkbenchSalesRatePushService.push();

    expect(importedBatches()).toHaveLength(1);
    expect(result).toMatchObject({ status: "failed", sent: 0, failed: 1_500 });
    expect(result.status !== "skipped" && result.errors).toEqual(["Workbench did not answer"]);
  });

  it("keeps the other requests when one is rejected for a reason it cannot fix", async () => {
    dashboardRows(Array.from({ length: 1_001 }, (_, index) => ({ sku: `S-${index}`, total_avg_curr: 1 })));
    workbenchRequestMock
      .mockRejectedValueOnce(rejection(["SKU S-0 dailyAverageQuantity must be from 0 to 99999999.9999"]))
      .mockResolvedValueOnce({ data: { received: 1, changed: 1 } });

    const result = await WorkbenchSalesRatePushService.push();

    expect(result).toMatchObject({ status: "partial", sent: 1, failed: 1_000 });
  });

  it("reports a failed read of the rates without calling Workbench", async () => {
    getDashboardDataMock.mockRejectedValue(new Error("No database connection available"));

    const result = await WorkbenchSalesRatePushService.push();

    expect(workbenchRequestMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "failed",
      considered: 0,
      errors: ["Could not read the sales rates: No database connection available"],
    });
  });
});
