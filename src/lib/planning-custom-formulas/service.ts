import { normalizeFormulaConfig, type FormulaConfig } from "@/lib/planning/custom-formulas";
import { PlanningCustomFormulasRepository } from "@/lib/planning-custom-formulas/repository";

export const PlanningCustomFormulasService = {
  async get(): Promise<FormulaConfig> {
    return normalizeFormulaConfig(await PlanningCustomFormulasRepository.get());
  },

  async save(raw: unknown): Promise<FormulaConfig> {
    const normalized = normalizeFormulaConfig(raw);
    await PlanningCustomFormulasRepository.save(normalized);
    return normalized;
  },
};
