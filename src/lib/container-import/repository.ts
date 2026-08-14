import type { PoolClient } from "pg";
import { getPrimaryPool } from "@/lib/db/primary-db";

const SOURCE_TABLES = ["fc_products", "fc_containers", "fc_container_items"] as const;
type SourceTable = (typeof SOURCE_TABLES)[number];
const BACKUP_TABLE_PATTERN = /^(fc_products|fc_containers|fc_container_items)_bak_(\d{8})$/;
export const CONTAINER_IMPORT_LOCK_KEY = "shipcore.fc_container_items_import";

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function qualifiedTable(tableName: string) {
  if (!SOURCE_TABLES.includes(tableName as SourceTable) && !BACKUP_TABLE_PATTERN.test(tableName)) {
    throw new Error("Invalid container import table name");
  }
  return `shipcore.${quoteIdentifier(tableName)}`;
}

async function currentDateSuffix(client: PoolClient) {
  const result = await client.query<{ suffix: string }>(
    "SELECT to_char(CURRENT_DATE, 'YYYYMMDD') AS suffix",
  );
  return result.rows[0].suffix;
}

export interface ContainerImportBackupTableResult {
  sourceTable: SourceTable;
  tableName: string;
  rowCount: number;
}

export interface ContainerImportBackupSetResult {
  dateSuffix: string;
  tables: ContainerImportBackupTableResult[];
}

async function restoreTableFromSnapshot(
  client: PoolClient,
  sourceTable: SourceTable,
  backupTable: string,
): Promise<number> {
  const columns = await client.query<{
    column_name: string;
  }>(
    `SELECT current_col.column_name
     FROM information_schema.columns current_col
     JOIN information_schema.columns backup_col
       ON backup_col.table_schema = 'shipcore'
      AND backup_col.table_name = $2
      AND backup_col.column_name = current_col.column_name
     WHERE current_col.table_schema = 'shipcore'
       AND current_col.table_name = $1
       AND current_col.is_generated = 'NEVER'
     ORDER BY current_col.ordinal_position`,
    [sourceTable, backupTable],
  );
  const primaryKey = await client.query<{ column_name: string }>(
    `SELECT attribute.attname AS column_name
     FROM pg_catalog.pg_index index_info
     JOIN pg_catalog.pg_attribute attribute
       ON attribute.attrelid = index_info.indrelid
      AND attribute.attnum = ANY(index_info.indkey)
     WHERE index_info.indrelid = $1::regclass
       AND index_info.indisprimary
     ORDER BY array_position(index_info.indkey, attribute.attnum)`,
    [`shipcore.${sourceTable}`],
  );

  const columnNames = columns.rows.map(({ column_name }) => column_name);
  const primaryKeyNames = primaryKey.rows.map(({ column_name }) => column_name);
  if (!columnNames.length || !primaryKeyNames.length || primaryKeyNames.some((name) => !columnNames.includes(name))) {
    throw new Error(`The ${backupTable} snapshot has no safe restorable key`);
  }

  const current = qualifiedTable(sourceTable);
  const backup = qualifiedTable(backupTable);
  const keyMatch = primaryKeyNames
    .map((name) => `target.${quoteIdentifier(name)} = snapshot.${quoteIdentifier(name)}`)
    .join(" AND ");
  const updateColumns = columnNames.filter((name) => !primaryKeyNames.includes(name));

  if (updateColumns.length) {
    const assignments = updateColumns
      .map((name) => `${quoteIdentifier(name)} = snapshot.${quoteIdentifier(name)}`)
      .join(", ");
    await client.query(
      `UPDATE ${current} AS target
       SET ${assignments}
       FROM ${backup} AS snapshot
       WHERE ${keyMatch}`,
    );
  }

  const columnList = columnNames.map(quoteIdentifier).join(", ");
  const backupColumnList = columnNames.map((name) => `snapshot.${quoteIdentifier(name)}`).join(", ");
  await client.query(
    `INSERT INTO ${current} (${columnList})
     SELECT ${backupColumnList}
     FROM ${backup} AS snapshot
     WHERE NOT EXISTS (
       SELECT 1 FROM ${current} AS target WHERE ${keyMatch}
     )`,
  );
  await client.query(
    `DELETE FROM ${current} AS target
     WHERE NOT EXISTS (
       SELECT 1 FROM ${backup} AS snapshot WHERE ${keyMatch}
     )`,
  );

  if (columnNames.includes("id")) {
    const sequence = await client.query<{ sequence_name: string | null }>(
      "SELECT pg_get_serial_sequence($1, 'id') AS sequence_name",
      [`shipcore.${sourceTable}`],
    );
    if (sequence.rows[0]?.sequence_name) {
      await client.query(
        `SELECT setval($1::regclass,
           COALESCE((SELECT MAX(id) FROM ${current}), 1),
           EXISTS (SELECT 1 FROM ${current}))`,
        [sequence.rows[0].sequence_name],
      );
    }
  }

  const count = await client.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${backup}`);
  return count.rows[0].count;
}

export const ContainerImportRepository = {
  /** Replaces today's complete snapshot so it represents the state immediately
   * before the latest non-dry-run import. It commits before import writes begin,
   * leaving a durable and internally consistent recovery point. */
  async createBackupSet(client: PoolClient): Promise<ContainerImportBackupSetResult> {
    const dateSuffix = await currentDateSuffix(client);
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [CONTAINER_IMPORT_LOCK_KEY]);
      const tables: ContainerImportBackupTableResult[] = [];
      for (const sourceTable of SOURCE_TABLES) {
        const tableName = `${sourceTable}_bak_${dateSuffix}`;
        const source = qualifiedTable(sourceTable);
        const backup = qualifiedTable(tableName);
        await client.query(`DROP TABLE IF EXISTS ${backup}`);
        await client.query(`CREATE TABLE ${backup} AS TABLE ${source}`);
        const count = await client.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${backup}`);
        tables.push({ sourceTable, tableName, rowCount: count.rows[0].count });
      }
      await client.query("COMMIT");
      return { dateSuffix, tables };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  },

  /** Restores the newest complete three-table snapshot atomically. Existing
   * primary keys are updated in place to preserve unrelated foreign-key links;
   * only rows absent from the snapshot are removed. Generated columns are
   * omitted and recalculated by PostgreSQL. */
  async restoreLatestBackupSet(): Promise<ContainerImportBackupSetResult> {
    const client = await getPrimaryPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [CONTAINER_IMPORT_LOCK_KEY]);
      const available = await client.query<{ tablename: string }>(
        `SELECT tablename
         FROM pg_catalog.pg_tables
         WHERE schemaname = 'shipcore'
           AND tablename ~ '^fc_(products|containers|container_items)_bak_[0-9]{8}$'
         ORDER BY tablename DESC`,
      );

      const sets = new Map<string, Map<SourceTable, string>>();
      for (const { tablename } of available.rows) {
        const match = BACKUP_TABLE_PATTERN.exec(tablename);
        if (!match) continue;
        const sourceTable = match[1] as SourceTable;
        const dateSuffix = match[2];
        const set = sets.get(dateSuffix) ?? new Map<SourceTable, string>();
        set.set(sourceTable, tablename);
        sets.set(dateSuffix, set);
      }
      const dateSuffix = [...sets.keys()]
        .sort((left, right) => right.localeCompare(left))
        .find((suffix) => SOURCE_TABLES.every((table) => sets.get(suffix)?.has(table)));
      if (!dateSuffix) throw new Error("No complete container import backup set is available");

      const backupSet = sets.get(dateSuffix)!;
      const tables: ContainerImportBackupTableResult[] = [];
      for (const sourceTable of SOURCE_TABLES) {
        const tableName = backupSet.get(sourceTable)!;
        const rowCount = await restoreTableFromSnapshot(client, sourceTable, tableName);
        tables.push({ sourceTable, tableName, rowCount });
      }
      await client.query("COMMIT");
      return { dateSuffix, tables };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
};
