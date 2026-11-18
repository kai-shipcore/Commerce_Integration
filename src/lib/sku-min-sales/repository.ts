/**
 * Pure data access for the Min Sales page. Raw SQL only: no Prisma model
 * exists for these tables or for fc_products.
 *  - shipcore.fc_sku_min_sales: per-SKU registrations, each a fixed floor on
 *    the Demand Planning "T.Avg 현재" column, a reference SKU and percent its
 *    sales are planned on, or both.
 *  - shipcore.fc_sales_reference_color_rules: colour rules, the same
 *    reference for every SKU of one colour.
 *
 * Methods accept an optional `executor` (defaults to the shared pool) so the
 * Service can run several calls in one transaction via `withTransaction()`.
 */

import type { Pool, PoolClient } from "pg";
import { getPrimaryPool } from "@/lib/db/primary-db";
import type { ColorRuleCategory } from "@/lib/planning/reference-sales";

export type SqlExecutor = Pick<Pool, "query">;

function pool(): SqlExecutor {
  return getPrimaryPool();
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPrimaryPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export interface SkuMinSalesRow {
  masterSku: string;
  /** Fixed floor on T.Avg current, or null when the SKU only has a reference. */
  minTotalAvgCurr: number | null;
  /** SKU whose sales this one is planned on, or null when it only has a floor. */
  referenceSku: string | null;
  /** Percent of the reference SKU's sales (30 = 30%); set together with referenceSku. */
  referencePct: number | null;
  note: string | null;
  productName: string | null;
  categoryCode: string | null;
  /**
   * Calculated T.Avg current from the SKU's own stats lane (fc_stats_custom for
   * CC/FM/SWC, fc_stats otherwise), before any floor or override. Reference only:
   * the dashboard recomputes the value from its components at read time.
   */
  calculatedTotalAvgCurr: number | null;
  /** Manual override on fc_products; when set it wins over the minimum. */
  totalAvgCurrOverride: number | null;
  updatedBy: string | null;
  updatedAt: string;
}

export interface SkuMinSalesWrite {
  masterSku: string;
  minTotalAvgCurr: number | null;
  referenceSku: string | null;
  referencePct: number | null;
  note: string | null;
}

export interface SkuOption {
  masterSku: string;
  productName: string | null;
  calculatedTotalAvgCurr: number | null;
  /** Minimum already registered for this SKU, or null. */
  registeredMin: number | null;
}

export interface ExistingSkuMinSales {
  masterSku: string;
  minTotalAvgCurr: number | null;
  referenceSku: string | null;
  referencePct: number | null;
  note: string | null;
}

export interface ColorRuleRow {
  id: number;
  categoryCode: ColorRuleCategory;
  /** Fabric / material the rule is limited to, or null for every one. */
  material: string | null;
  color: string;
  referenceColor: string;
  referencePct: number;
  note: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export interface ColorRuleWrite {
  categoryCode: ColorRuleCategory;
  material: string | null;
  color: string;
  referenceColor: string;
  referencePct: number;
  note: string | null;
}

/** Escapes LIKE wildcards so a typed "_" or "%" matches literally. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

function numberOrNull(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function isoDate(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapRow(row: Record<string, unknown>): SkuMinSalesRow {
  return {
    masterSku: row.master_sku as string,
    minTotalAvgCurr: numberOrNull(row.min_total_avg_curr),
    referenceSku: (row.reference_sku as string | null) ?? null,
    referencePct: numberOrNull(row.reference_pct),
    note: (row.note as string | null) ?? null,
    productName: (row.product_name as string | null) ?? null,
    categoryCode: (row.category_code as string | null) ?? null,
    calculatedTotalAvgCurr: numberOrNull(row.calculated_total_avg_curr),
    totalAvgCurrOverride: numberOrNull(row.total_avg_curr_override),
    updatedBy: (row.updated_by as string | null) ?? null,
    updatedAt: isoDate(row.updated_at),
  };
}

function mapColorRule(row: Record<string, unknown>): ColorRuleRow {
  return {
    id: Number(row.id),
    categoryCode: row.category_code as ColorRuleCategory,
    // Stored as '' for "every fabric / material" so the unique key covers it.
    material: (row.material as string) || null,
    color: row.color as string,
    referenceColor: row.reference_color as string,
    referencePct: Number(row.reference_pct),
    note: (row.note as string | null) ?? null,
    updatedBy: (row.updated_by as string | null) ?? null,
    updatedAt: isoDate(row.updated_at),
  };
}

const COLOR_RULE_COLUMNS = `id, category_code, material, color, reference_color,
         reference_pct::float8 AS reference_pct, note, updated_by, updated_at`;

export const SkuMinSalesRepository = {
  async list(): Promise<SkuMinSalesRow[]> {
    const result = await pool().query(
      `SELECT
         m.master_sku,
         m.min_total_avg_curr::float8                                AS min_total_avg_curr,
         m.reference_sku,
         m.reference_pct::float8                                     AS reference_pct,
         m.note,
         p.product_name,
         p.category_code,
         (CASE WHEN p.category_code IN ('CC', 'FM', 'SWC')
               THEN sc.total_avg_curr ELSE s.total_avg_curr END)::float8 AS calculated_total_avg_curr,
         p.total_avg_curr_override::float8                           AS total_avg_curr_override,
         m.updated_by,
         m.updated_at
       FROM shipcore.fc_sku_min_sales m
       JOIN shipcore.fc_products p ON p.master_sku = m.master_sku
       LEFT JOIN shipcore.fc_stats s ON s.master_sku = m.master_sku
       LEFT JOIN shipcore.fc_stats_custom sc ON sc.master_sku = m.master_sku
       ORDER BY m.master_sku`,
    );
    return result.rows.map(mapRow);
  },

  /** Active SKU Master rows matching a SKU or product-name substring, capped at `limit`. */
  async searchSkuOptions(search: string, limit: number): Promise<{ options: SkuOption[]; total: number }> {
    const result = await pool().query(
      `SELECT
         p.master_sku,
         p.product_name,
         (CASE WHEN p.category_code IN ('CC', 'FM', 'SWC')
               THEN sc.total_avg_curr ELSE s.total_avg_curr END)::float8 AS calculated_total_avg_curr,
         m.min_total_avg_curr::float8                                 AS registered_min,
         COUNT(*) OVER ()::int                                        AS total
       FROM shipcore.fc_products p
       LEFT JOIN shipcore.fc_stats s ON s.master_sku = p.master_sku
       LEFT JOIN shipcore.fc_stats_custom sc ON sc.master_sku = p.master_sku
       LEFT JOIN shipcore.fc_sku_min_sales m ON m.master_sku = p.master_sku
       WHERE p.status = 'active'
         AND ($1 = '' OR p.master_sku ILIKE $2 OR p.product_name ILIKE $2)
       ORDER BY p.master_sku
       LIMIT $3`,
      [search, likePattern(search), limit],
    );
    return {
      options: result.rows.map((row) => ({
        masterSku: row.master_sku as string,
        productName: (row.product_name as string | null) ?? null,
        calculatedTotalAvgCurr: numberOrNull(row.calculated_total_avg_curr),
        registeredMin: numberOrNull(row.registered_min),
      })),
      total: Number(result.rows[0]?.total ?? 0),
    };
  },

  async findExistingProductSkus(skus: string[], executor: SqlExecutor = pool()): Promise<Set<string>> {
    const result = await executor.query<{ master_sku: string }>(
      `SELECT master_sku FROM shipcore.fc_products WHERE master_sku = ANY($1::text[])`,
      [skus],
    );
    return new Set(result.rows.map((row) => row.master_sku));
  },

  async getForUpdate(masterSku: string, executor: SqlExecutor = pool()): Promise<ExistingSkuMinSales | null> {
    const result = await executor.query<{
      master_sku: string;
      min_total_avg_curr: number | null;
      reference_sku: string | null;
      reference_pct: number | null;
      note: string | null;
    }>(
      `SELECT master_sku, min_total_avg_curr::float8 AS min_total_avg_curr,
              reference_sku, reference_pct::float8 AS reference_pct, note
       FROM shipcore.fc_sku_min_sales
       WHERE master_sku = $1
       FOR UPDATE`,
      [masterSku],
    );
    const row = result.rows[0];
    return row
      ? {
          masterSku: row.master_sku,
          minTotalAvgCurr: numberOrNull(row.min_total_avg_curr),
          referenceSku: row.reference_sku ?? null,
          referencePct: numberOrNull(row.reference_pct),
          note: row.note,
        }
      : null;
  },

  /** Insert, or overwrite the existing registration for the same SKU. Returns true when a new row was created. */
  async upsert(row: SkuMinSalesWrite, actor: string | null, executor: SqlExecutor = pool()): Promise<boolean> {
    const result = await executor.query<{ inserted: boolean }>(
      `INSERT INTO shipcore.fc_sku_min_sales
         (master_sku, min_total_avg_curr, reference_sku, reference_pct, note, created_by, updated_by)
       VALUES ($1, $2::numeric(14,4), $3, $4::numeric(7,2), $5, $6, $6)
       ON CONFLICT (master_sku) DO UPDATE
         SET min_total_avg_curr = EXCLUDED.min_total_avg_curr,
             reference_sku      = EXCLUDED.reference_sku,
             reference_pct      = EXCLUDED.reference_pct,
             note               = EXCLUDED.note,
             updated_by         = EXCLUDED.updated_by,
             updated_at         = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [row.masterSku, row.minTotalAvgCurr, row.referenceSku, row.referencePct, row.note, actor],
    );
    return Boolean(result.rows[0]?.inserted);
  },

  async deleteMany(skus: string[], executor: SqlExecutor = pool()): Promise<string[]> {
    const result = await executor.query<{ master_sku: string }>(
      `DELETE FROM shipcore.fc_sku_min_sales WHERE master_sku = ANY($1::text[]) RETURNING master_sku`,
      [skus],
    );
    return result.rows.map((row) => row.master_sku);
  },

  async listColorRules(): Promise<ColorRuleRow[]> {
    const result = await pool().query(
      `SELECT ${COLOR_RULE_COLUMNS}
       FROM shipcore.fc_sales_reference_color_rules
       ORDER BY category_code, color, material`,
    );
    return result.rows.map(mapColorRule);
  },

  async getColorRuleForUpdate(
    key: Pick<ColorRuleWrite, "categoryCode" | "material" | "color">,
    executor: SqlExecutor = pool(),
  ): Promise<ColorRuleRow | null> {
    const result = await executor.query(
      `SELECT ${COLOR_RULE_COLUMNS}
       FROM shipcore.fc_sales_reference_color_rules
       WHERE category_code = $1 AND material = $2 AND color = $3
       FOR UPDATE`,
      [key.categoryCode, key.material ?? "", key.color],
    );
    return result.rows[0] ? mapColorRule(result.rows[0]) : null;
  },

  /** Insert, or overwrite the rule for the same category / material / colour. */
  async upsertColorRule(rule: ColorRuleWrite, actor: string | null, executor: SqlExecutor = pool()): Promise<ColorRuleRow> {
    const result = await executor.query(
      `INSERT INTO shipcore.fc_sales_reference_color_rules
         (category_code, material, color, reference_color, reference_pct, note, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5::numeric(7,2), $6, $7, $7)
       ON CONFLICT (category_code, material, color) DO UPDATE
         SET reference_color = EXCLUDED.reference_color,
             reference_pct   = EXCLUDED.reference_pct,
             note            = EXCLUDED.note,
             updated_by      = EXCLUDED.updated_by,
             updated_at      = NOW()
       RETURNING ${COLOR_RULE_COLUMNS}`,
      [rule.categoryCode, rule.material ?? "", rule.color, rule.referenceColor, rule.referencePct, rule.note, actor],
    );
    return mapColorRule(result.rows[0]);
  },

  async deleteColorRule(id: number, executor: SqlExecutor = pool()): Promise<ColorRuleRow | null> {
    const result = await executor.query(
      `DELETE FROM shipcore.fc_sales_reference_color_rules WHERE id = $1 RETURNING ${COLOR_RULE_COLUMNS}`,
      [id],
    );
    return result.rows[0] ? mapColorRule(result.rows[0]) : null;
  },

  /** Active Car Cover and Seat Cover master SKUs: the ones a colour rule can match or point at. */
  async listActiveColorRuleSkus(): Promise<string[]> {
    const result = await pool().query<{ master_sku: string }>(
      `SELECT master_sku
       FROM shipcore.fc_products
       WHERE status = 'active'
         AND (master_sku LIKE 'CC-%' OR master_sku LIKE 'CA-SC-%')
       ORDER BY master_sku`,
    );
    return result.rows.map((row) => row.master_sku);
  },
};
