import { UserPreferencesRepository } from "@/lib/user-preferences/repository";

const GLOBAL_USER_ID = "global";
const LIVE_FORMULAS_KEY = "planning-live-custom-formulas-v1";

export const PlanningCustomFormulasRepository = {
  async get(): Promise<unknown> {
    const rows = await UserPreferencesRepository.getAll(GLOBAL_USER_ID);
    return rows.find((row) => row.key === LIVE_FORMULAS_KEY)?.value;
  },

  async save(value: unknown): Promise<void> {
    await UserPreferencesRepository.upsertMany(GLOBAL_USER_ID, [[LIVE_FORMULAS_KEY, value]]);
  },
};
