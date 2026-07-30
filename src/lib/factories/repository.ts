import { getPrimaryPool } from "@/lib/db/primary-db";

export interface FactoryRow {
  id: string;
  factory_code: string | null;
  factory_name: string;
  origin: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface ListFactoriesFilter {
  active: boolean | null;
  search: string;
}

export interface CreateFactoryInput {
  factoryName: string;
  factoryCode: string | null;
  origin: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
}

export interface UpdateFactoryInput {
  factoryName: string;
  origin: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
}

const FACTORY_ROW_SELECT_SQL = `
  id::text,
  factory_code,
  factory_name,
  origin,
  contact_name,
  email,
  phone,
  is_active,
  created_at,
  updated_at
`;

/**
 * Pure data access for factory master records (`shipcore.fc_factories` on
 * the primary DB). Caching/validation/audit orchestration are Service
 * concerns (see factories/service.ts) — this repository only runs queries.
 */
export const FactoriesRepository = {
  async ensureFactoryCodes(): Promise<void> {
    const pool = getPrimaryPool();

    await pool.query("CREATE SEQUENCE IF NOT EXISTS shipcore.fc_factory_code_seq START 1");
    await pool.query(`
      WITH code_state AS (
        SELECT COALESCE((
            SELECT MAX((regexp_match(factory_code, '^FC-([0-9]+)$'))[1]::bigint)
            FROM shipcore.fc_factories
            WHERE factory_code ~ '^FC-[0-9]+$'
          ), 0) AS max_code
      )
      SELECT setval(
        'shipcore.fc_factory_code_seq',
        GREATEST(code_state.max_code, shipcore.fc_factory_code_seq.last_value, 1),
        code_state.max_code > 0 OR shipcore.fc_factory_code_seq.is_called
      )
      FROM code_state, shipcore.fc_factory_code_seq
    `);
    await pool.query(`
      WITH missing AS (
        SELECT id
        FROM shipcore.fc_factories
        WHERE factory_code IS NULL OR btrim(factory_code) = ''
        ORDER BY id
        FOR UPDATE
      )
      UPDATE shipcore.fc_factories factory
      SET factory_code = 'FC-' || LPAD(nextval('shipcore.fc_factory_code_seq')::text, 4, '0'),
          updated_at = now()
      FROM missing
      WHERE factory.id = missing.id
    `);
  },

  async listFactories(filter: ListFactoriesFilter): Promise<FactoryRow[]> {
    const pool = getPrimaryPool();
    const filters: string[] = [];
    const params: unknown[] = [];

    if (filter.active !== null) {
      params.push(filter.active);
      filters.push(`is_active = $${params.length}`);
    }

    if (filter.search) {
      params.push(`%${filter.search}%`);
      filters.push(`(factory_name ILIKE $${params.length} OR COALESCE(factory_code, '') ILIKE $${params.length})`);
    }

    const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
    const result = await pool.query<FactoryRow>(
      `SELECT ${FACTORY_ROW_SELECT_SQL}
       FROM shipcore.fc_factories
       ${where}
       ORDER BY factory_name ASC`,
      params
    );
    return result.rows;
  },

  async createFactory(input: CreateFactoryInput): Promise<FactoryRow> {
    const pool = getPrimaryPool();
    const result = await pool.query<FactoryRow>(
      `INSERT INTO shipcore.fc_factories
         (factory_code, factory_name, origin, contact_name, email, phone)
       VALUES (
         COALESCE($1, 'FC-' || LPAD(nextval('shipcore.fc_factory_code_seq')::text, 4, '0')),
         $2,
         $3,
         $4,
         $5,
         $6
       )
       ON CONFLICT (factory_name) DO UPDATE SET
         factory_code = COALESCE(shipcore.fc_factories.factory_code, EXCLUDED.factory_code),
         origin = COALESCE(EXCLUDED.origin, shipcore.fc_factories.origin),
         contact_name = COALESCE(EXCLUDED.contact_name, shipcore.fc_factories.contact_name),
         email = COALESCE(EXCLUDED.email, shipcore.fc_factories.email),
         phone = COALESCE(EXCLUDED.phone, shipcore.fc_factories.phone),
         is_active = true,
         updated_at = now()
       RETURNING ${FACTORY_ROW_SELECT_SQL}`,
      [input.factoryCode, input.factoryName, input.origin, input.contactName, input.email, input.phone]
    );
    return result.rows[0];
  },

  async findById(id: string): Promise<FactoryRow | null> {
    const pool = getPrimaryPool();
    const result = await pool.query<FactoryRow>(
      `SELECT ${FACTORY_ROW_SELECT_SQL} FROM shipcore.fc_factories WHERE id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  },

  async existsByNameExcludingId(factoryName: string, excludeId: string): Promise<boolean> {
    const pool = getPrimaryPool();
    const result = await pool.query<{ id: string }>(
      "SELECT id::text FROM shipcore.fc_factories WHERE factory_name = $1 AND id != $2",
      [factoryName, excludeId]
    );
    return result.rows.length > 0;
  },

  async updateFactory(id: string, input: UpdateFactoryInput): Promise<FactoryRow | null> {
    const pool = getPrimaryPool();
    const result = await pool.query<FactoryRow>(
      `UPDATE shipcore.fc_factories SET
         factory_name = $1,
         origin = $2,
         contact_name = $3,
         email = $4,
         phone = $5,
         updated_at = now()
       WHERE id = $6
       RETURNING ${FACTORY_ROW_SELECT_SQL}`,
      [input.factoryName, input.origin, input.contactName, input.email, input.phone, id]
    );
    return result.rows[0] ?? null;
  },

  async setActive(id: string, isActive: boolean): Promise<FactoryRow | null> {
    const pool = getPrimaryPool();
    const result = await pool.query<FactoryRow>(
      `UPDATE shipcore.fc_factories SET
         is_active = $1,
         updated_at = now()
       WHERE id = $2
       RETURNING ${FACTORY_ROW_SELECT_SQL}`,
      [isActive, id]
    );
    return result.rows[0] ?? null;
  },
};
