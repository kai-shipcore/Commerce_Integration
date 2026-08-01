/**
 * Data access for the generic per-user key/value preferences store
 * (shipcore.fc_user_preferences). Scoped by user_id — the forecast-config
 * domain reuses this same repository with the "global" sentinel user_id
 * rather than duplicating the upsert SQL.
 */

import { getPrimaryPool } from "@/lib/db/primary-db";

export interface PreferenceRow {
  key: string;
  value: unknown;
}

export const UserPreferencesRepository = {
  async getAll(userId: string): Promise<PreferenceRow[]> {
    const result = await getPrimaryPool().query<PreferenceRow>(
      `SELECT key, value FROM shipcore.fc_user_preferences WHERE user_id = $1`,
      [userId],
    );
    return result.rows;
  },

  async upsertMany(userId: string, entries: [string, unknown][]): Promise<void> {
    if (entries.length === 0) return;

    const placeholders = entries.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3}::jsonb, now())`).join(", ");
    const params: unknown[] = [userId];
    for (const [key, value] of entries) {
      params.push(key, JSON.stringify(value));
    }

    await getPrimaryPool().query(
      `INSERT INTO shipcore.fc_user_preferences (user_id, key, value, updated_at)
       VALUES ${placeholders}
       ON CONFLICT (user_id, key) DO UPDATE
         SET value = EXCLUDED.value,
             updated_at = now()`,
      params,
    );
  },
};
