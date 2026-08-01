import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenError } from "@/lib/errors";

const repositoryMock = { getAll: vi.fn(), upsertMany: vi.fn() };
vi.mock("@/lib/user-preferences/repository", () => ({ UserPreferencesRepository: repositoryMock }));

const { ForecastConfigService } = await import("@/lib/forecast-config/service");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ForecastConfigService.getConfig", () => {
  it("returns defaults when nothing is stored", async () => {
    repositoryMock.getAll.mockResolvedValue([]);
    const result = await ForecastConfigService.getConfig();
    expect(result.seasonal_factors).toEqual(expect.objectContaining({ jan: 0.75 }));
    expect(Array.isArray(result.window_weights)).toBe(true);
  });

  it("uses stored values from the global preferences row when present", async () => {
    repositoryMock.getAll.mockResolvedValue([
      { key: "planning-dashboard-seasonal-factors", value: { jan: 1 } },
    ]);
    const result = await ForecastConfigService.getConfig();
    expect(result.seasonal_factors).toEqual({ jan: 1 });
    expect(repositoryMock.getAll).toHaveBeenCalledWith("global");
  });
});

describe("ForecastConfigService.updateConfig", () => {
  it("throws ForbiddenError for a non-admin role", async () => {
    await expect(ForecastConfigService.updateConfig("user", { seasonal_factors: {} })).rejects.toThrow(ForbiddenError);
    expect(repositoryMock.upsertMany).not.toHaveBeenCalled();
  });

  it("throws ForbiddenError when role is undefined", async () => {
    await expect(ForecastConfigService.updateConfig(undefined, { seasonal_factors: {} })).rejects.toThrow(ForbiddenError);
  });

  it("upserts only the provided keys under the global user id", async () => {
    await ForecastConfigService.updateConfig("admin", { window_weights: [{ days: 1, weight: 1, order_type: "sales" }] });
    expect(repositoryMock.upsertMany).toHaveBeenCalledWith("global", [
      ["planning-dashboard-sales-window-weights", [{ days: 1, weight: 1, order_type: "sales" }]],
    ]);
  });

  it("is a no-op when neither field is provided", async () => {
    await ForecastConfigService.updateConfig("admin", {});
    expect(repositoryMock.upsertMany).not.toHaveBeenCalled();
  });
});
