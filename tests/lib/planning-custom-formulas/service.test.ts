import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/planning-custom-formulas/repository", () => ({
  PlanningCustomFormulasRepository: repository,
}));

const { PlanningCustomFormulasService } = await import("@/lib/planning-custom-formulas/service");

describe("PlanningCustomFormulasService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the shared normalized formula config", async () => {
    repository.get.mockResolvedValue([{ id: "custom_formula_1", enabled: true, name: "Shared", overrides: { SKU: "=1" } }]);
    const result = await PlanningCustomFormulasService.get();
    expect(result[0]).toMatchObject({ enabled: true, name: "Shared", overrides: { SKU: "=1" } });
    expect(result).toHaveLength(2);
  });

  it("normalizes before saving the global value", async () => {
    const result = await PlanningCustomFormulasService.save([{ id: "custom_formula_1", enabled: true, name: "  Shared  ", overrides: { SKU: "=2" } }]);
    expect(repository.save).toHaveBeenCalledWith(result);
    expect(result[0].name).toBe("Shared");
  });
});
