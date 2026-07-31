/**
 * Business logic for the global V1 forecast parameters (seasonal factors,
 * sales-window weights). Stored in shipcore.fc_user_preferences under the
 * "global" sentinel user_id — reuses UserPreferencesRepository rather than
 * duplicating its upsert SQL, since it's the same generic key/value table.
 */

import { ForbiddenError } from "@/lib/errors";
import { UserPreferencesRepository } from "@/lib/user-preferences/repository";

const GLOBAL_USER_ID = "global";

const SEASONAL_FACTORS_KEY = "planning-dashboard-seasonal-factors";
const WINDOW_WEIGHTS_KEY = "planning-dashboard-sales-window-weights";

const DEFAULT_SEASONAL_FACTORS = {
  jan: 0.75, feb: 0.80, mar: 0.90, apr: 0.95,
  may: 1.00, jun: 1.00, jul: 1.00, aug: 1.00, sep: 1.00,
  oct: 1.10, nov: 1.25, dec: 1.30,
};

const DEFAULT_WINDOW_WEIGHTS = [
  { days: 90, weight: 0.10, order_type: "sales" },
  { days: 60, weight: 0.15, order_type: "sales" },
  { days: 30, weight: 0.30, order_type: "sales" },
  { days: 15, weight: 0.20, order_type: "sales" },
  { days: 7, weight: 0.15, order_type: "sales" },
  { days: 30, weight: 0.10, order_type: "preorder" },
];

export interface ForecastConfigResult {
  seasonal_factors: unknown;
  window_weights: unknown;
}

export const ForecastConfigService = {
  async getConfig(): Promise<ForecastConfigResult> {
    const rows = await UserPreferencesRepository.getAll(GLOBAL_USER_ID);
    const map: Record<string, unknown> = {};
    for (const row of rows) map[row.key] = row.value;

    return {
      seasonal_factors: map[SEASONAL_FACTORS_KEY] ?? DEFAULT_SEASONAL_FACTORS,
      window_weights: map[WINDOW_WEIGHTS_KEY] ?? DEFAULT_WINDOW_WEIGHTS,
    };
  },

  async updateConfig(role: string | undefined, body: { seasonal_factors?: unknown; window_weights?: unknown }): Promise<void> {
    if (role !== "admin") {
      throw new ForbiddenError("Forbidden");
    }

    const entries: [string, unknown][] = [];
    if (body.seasonal_factors !== undefined) entries.push([SEASONAL_FACTORS_KEY, body.seasonal_factors]);
    if (body.window_weights !== undefined) entries.push([WINDOW_WEIGHTS_KEY, body.window_weights]);
    if (entries.length === 0) return;

    await UserPreferencesRepository.upsertMany(GLOBAL_USER_ID, entries);
  },
};
