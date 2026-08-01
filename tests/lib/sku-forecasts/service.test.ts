import { describe, it, expect, vi, beforeEach } from "vitest";
import { ValidationError } from "@/lib/errors";

const repositoryMock = {
  getInboundHistory: vi.fn(),
  getInbound: vi.fn(),
  getForecastMinDate: vi.fn(),
  getSalesHistory: vi.fn(),
};

vi.mock("@/lib/sku-forecasts/repository", () => ({ SkuForecastsRepository: repositoryMock }));

const { SkuForecastsService } = await import("@/lib/sku-forecasts/service");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SkuForecastsService.getInboundHistory", () => {
  it("throws ValidationError when masterSku is missing or blank", async () => {
    await expect(SkuForecastsService.getInboundHistory(null)).rejects.toThrow(ValidationError);
    await expect(SkuForecastsService.getInboundHistory("   ")).rejects.toThrow("masterSku is required");
  });

  it("trims and uppercases the sku before querying", async () => {
    repositoryMock.getInboundHistory.mockResolvedValue([]);
    await SkuForecastsService.getInboundHistory(" sku-1 ");
    expect(repositoryMock.getInboundHistory).toHaveBeenCalledWith("SKU-1");
  });
});

describe("SkuForecastsService.getInbound", () => {
  it("throws ValidationError when masterSku is missing", async () => {
    await expect(SkuForecastsService.getInbound(null, false)).rejects.toThrow(ValidationError);
  });

  it("passes includeDrafts through", async () => {
    repositoryMock.getInbound.mockResolvedValue([]);
    await SkuForecastsService.getInbound("sku-1", true);
    expect(repositoryMock.getInbound).toHaveBeenCalledWith("SKU-1", true);
  });
});

describe("SkuForecastsService.getForecastBounds", () => {
  it("delegates to the repository", async () => {
    repositoryMock.getForecastMinDate.mockResolvedValue("2024-01-01");
    expect(await SkuForecastsService.getForecastBounds()).toBe("2024-01-01");
  });
});

describe("SkuForecastsService.getSalesHistory", () => {
  const baseParams = { sku: "sku-1", from: "2026-01-01", to: "2026-01-10", category: null, bucket: null };

  it("throws ValidationError when sku is missing", async () => {
    await expect(SkuForecastsService.getSalesHistory({ ...baseParams, sku: null })).rejects.toThrow("Missing sku");
  });

  it("throws ValidationError when a date is malformed", async () => {
    await expect(SkuForecastsService.getSalesHistory({ ...baseParams, from: "not-a-date" })).rejects.toThrow("Invalid date range");
  });

  it("throws ValidationError when from is after to", async () => {
    await expect(SkuForecastsService.getSalesHistory({ ...baseParams, from: "2026-01-10", to: "2026-01-01" })).rejects.toThrow("Invalid date range");
  });

  it("throws ValidationError when the range exceeds the max window", async () => {
    await expect(
      SkuForecastsService.getSalesHistory({ ...baseParams, from: "2020-01-01", to: "2026-01-01" }),
    ).rejects.toThrow(/Date range is too large/);
  });

  it("uses the SC velocity source (link snapshot) for an SC category", async () => {
    repositoryMock.getSalesHistory.mockResolvedValue([]);
    await SkuForecastsService.getSalesHistory({ ...baseParams, category: "SC" });
    expect(repositoryMock.getSalesHistory).toHaveBeenCalledWith(
      expect.objectContaining({ table: "shipcore.fc_velocity_link_snapshot", skuColumn: "link_master_sku", qtyColumn: "link_qty" }),
    );
  });

  it("uses the custom velocity source for a CC/FM category", async () => {
    repositoryMock.getSalesHistory.mockResolvedValue([]);
    await SkuForecastsService.getSalesHistory({ ...baseParams, category: "CC" });
    expect(repositoryMock.getSalesHistory).toHaveBeenCalledWith(
      expect.objectContaining({ table: "shipcore.fc_velocity_custom_snapshot", skuColumn: "custom_master_sku", qtyColumn: "custom_qty" }),
    );
  });

  it("defaults the bucket to day for short ranges and week for longer ones", async () => {
    repositoryMock.getSalesHistory.mockResolvedValue([]);
    const short = await SkuForecastsService.getSalesHistory({ ...baseParams, category: "CC" });
    expect(short.bucket).toBe("day");

    const long = await SkuForecastsService.getSalesHistory({ ...baseParams, category: "CC", from: "2026-01-01", to: "2026-06-01" });
    expect(long.bucket).toBe("week");
  });

  it("respects an explicit bucket override", async () => {
    repositoryMock.getSalesHistory.mockResolvedValue([]);
    const result = await SkuForecastsService.getSalesHistory({ ...baseParams, category: "CC", bucket: "month" });
    expect(result.bucket).toBe("month");
  });

  it("sums points into totals and defaults missing values to 0", async () => {
    repositoryMock.getSalesHistory.mockResolvedValue([
      { bucket_label: "2026-01-01", west: "3", east: null, total: "3" },
      { bucket_label: "2026-01-02", west: 5, east: 2, total: 7 },
    ]);
    const result = await SkuForecastsService.getSalesHistory({ ...baseParams, category: "CC" });
    expect(result.points).toEqual([
      { date: "2026-01-01", west: 3, east: 0, total: 3 },
      { date: "2026-01-02", west: 5, east: 2, total: 7 },
    ]);
    expect(result.totals).toEqual({ west: 8, east: 2, total: 10 });
  });
});
