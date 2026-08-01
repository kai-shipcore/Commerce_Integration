/**
 * Business logic for the per-user preferences store: shapes the key/value
 * rows into a flat object and validates the save payload.
 */

import { ValidationError } from "@/lib/errors";
import { UserPreferencesRepository } from "@/lib/user-preferences/repository";

export const UserPreferencesService = {
  async getPreferences(userId: string): Promise<Record<string, unknown>> {
    const rows = await UserPreferencesRepository.getAll(userId);
    const preferences: Record<string, unknown> = {};
    for (const row of rows) preferences[row.key] = row.value;
    return preferences;
  },

  async savePreferences(userId: string, rawPreferences: unknown): Promise<void> {
    if (!rawPreferences || typeof rawPreferences !== "object") {
      throw new ValidationError("Invalid body");
    }

    const entries = Object.entries(rawPreferences as Record<string, unknown>);
    if (entries.length === 0) return;

    await UserPreferencesRepository.upsertMany(userId, entries);
  },
};
