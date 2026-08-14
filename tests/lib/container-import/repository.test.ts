import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const releaseMock = vi.fn();
const connectMock = vi.fn(async () => ({ query: queryMock, release: releaseMock }));
vi.mock("@/lib/db/primary-db", () => ({
  getPrimaryPool: () => ({ connect: connectMock }),
}));

import { ContainerImportRepository } from "@/lib/container-import/repository";

const BACKUP_SET = [
  { sourceTable: "fc_products", tableName: "fc_products_bak_20260814", rowCount: 100 },
  { sourceTable: "fc_containers", tableName: "fc_containers_bak_20260814", rowCount: 10 },
  { sourceTable: "fc_container_items", tableName: "fc_container_items_bak_20260814", rowCount: 42 },
];

beforeEach(() => {
  vi.clearAllMocks();
});

function rowCountForSql(sql: string) {
  if (sql.includes("fc_products_bak")) return 100;
  if (sql.includes("fc_containers_bak")) return 10;
  return 42;
}

describe("ContainerImportRepository.createBackupSet", () => {
  it("replaces all three dated snapshots in one transaction before import writes", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("to_char(CURRENT_DATE")) return { rows: [{ suffix: "20260814" }] };
      if (sql.includes("COUNT(*)")) return { rows: [{ count: rowCountForSql(sql) }] };
      return { rows: [], rowCount: 0 };
    });
    const client = { query: queryMock } as never;

    await expect(ContainerImportRepository.createBackupSet(client)).resolves.toEqual({
      dateSuffix: "20260814",
      tables: BACKUP_SET,
    });
    const statements = queryMock.mock.calls.map(([sql]) => sql as string);
    expect(statements).toContain("BEGIN");
    for (const { sourceTable, tableName } of BACKUP_SET) {
      expect(statements.some((sql) => sql.includes(`DROP TABLE IF EXISTS shipcore."${tableName}"`))).toBe(true);
      expect(statements.some((sql) => sql.includes(`CREATE TABLE shipcore."${tableName}" AS TABLE shipcore."${sourceTable}"`))).toBe(true);
    }
    expect(statements.at(-1)).toBe("COMMIT");
  });
});

describe("ContainerImportRepository.restoreLatestBackupSet", () => {
  it("restores the newest complete set by primary key and advances ID sequences", async () => {
    queryMock.mockImplementation(async (sql: string, params?: string[]) => {
      if (sql.includes("FROM pg_catalog.pg_tables")) {
        return { rows: BACKUP_SET.map(({ tableName: tablename }) => ({ tablename })) };
      }
      if (sql.includes("FROM information_schema.columns")) {
        const source = params?.[0];
        const names = source === "fc_products"
          ? ["master_sku", "product_name", "cbm_per_unit", "created_at", "updated_at"]
          : source === "fc_containers"
            ? ["id", "container_number", "eta_date", "status", "created_at", "updated_at"]
            : ["id", "container_id", "master_sku", "qty", "cbm_unit", "created_at", "updated_at"];
        return { rows: names.map((column_name) => ({ column_name })) };
      }
      if (sql.includes("FROM pg_catalog.pg_index")) {
        return { rows: [{ column_name: params?.[0]?.endsWith("fc_products") ? "master_sku" : "id" }] };
      }
      if (sql.includes("pg_get_serial_sequence")) {
        return { rows: [{ sequence_name: `shipcore.${params?.[0]?.split(".").at(-1)}_id_seq` }] };
      }
      if (sql.includes("COUNT(*)")) return { rows: [{ count: rowCountForSql(sql) }] };
      return { rows: [], rowCount: 0 };
    });

    await expect(ContainerImportRepository.restoreLatestBackupSet()).resolves.toEqual({
      dateSuffix: "20260814",
      tables: BACKUP_SET,
    });
    const statements = queryMock.mock.calls.map(([sql]) => sql as string);
    for (const { sourceTable } of BACKUP_SET) {
      expect(statements.some((sql) => sql.includes(`UPDATE shipcore."${sourceTable}" AS target`))).toBe(true);
      expect(statements.some((sql) => sql.includes(`INSERT INTO shipcore."${sourceTable}"`))).toBe(true);
      expect(statements.some((sql) => sql.includes(`DELETE FROM shipcore."${sourceTable}" AS target`) && sql.includes("WHERE NOT EXISTS"))).toBe(true);
    }
    expect(statements.some((sql) => sql.includes("SELECT setval"))).toBe(true);
    expect(statements.at(-1)).toBe("COMMIT");
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("rolls back without changing data when only an incomplete dated set exists", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM pg_catalog.pg_tables")) {
        return { rows: [{ tablename: "fc_container_items_bak_20260814" }] };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(ContainerImportRepository.restoreLatestBackupSet()).rejects.toThrow(
      "No complete container import backup set is available",
    );
    expect(queryMock).toHaveBeenCalledWith("ROLLBACK");
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("DELETE FROM shipcore"))).toBe(false);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });
});
