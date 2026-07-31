import { describe, it, expect, vi, beforeEach } from "vitest";

const repositoryMock = { saveMemo: vi.fn() };
const invalidateMock = vi.fn();

vi.mock("@/lib/sku-memo/repository", () => ({ SkuMemoRepository: repositoryMock }));
vi.mock("@/lib/planning/dashboard-cache", () => ({ invalidatePlanningDashboardCache: invalidateMock }));

const { SkuMemoService } = await import("@/lib/sku-memo/service");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SkuMemoService.saveMemo", () => {
  it("persists the memo and invalidates the dashboard cache", async () => {
    await SkuMemoService.saveMemo("SKU-1", "note text");
    expect(repositoryMock.saveMemo).toHaveBeenCalledWith("SKU-1", "note text");
    expect(invalidateMock).toHaveBeenCalled();
  });

  it("stores an empty memo as null", async () => {
    await SkuMemoService.saveMemo("SKU-1", "");
    expect(repositoryMock.saveMemo).toHaveBeenCalledWith("SKU-1", null);
  });
});
