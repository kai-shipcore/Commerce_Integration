import { describe, it, expect, vi, beforeEach } from "vitest";
import { ValidationError } from "@/lib/errors";

const repositoryMock = {
  getInboundHistory: vi.fn(),
  getInbound: vi.fn(),
  getForecastMinDate: vi.fn(),
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
