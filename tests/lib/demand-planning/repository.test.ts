import { describe, it, expect, vi, beforeEach } from "vitest";

const primaryQueryMock = vi.fn();
const lookupQueryMock = vi.fn();
let lookupPool: { query: typeof lookupQueryMock } | null = { query: lookupQueryMock };

vi.mock("@/lib/db/primary-db", () => ({ getPrimaryPool: vi.fn(() => ({ query: primaryQueryMock })) }));
vi.mock("@/lib/db/supabase-lookup", () => ({ getLookupPool: vi.fn(() => lookupPool) }));

const { DemandPlanningRepository } = await import("@/lib/demand-planning/repository");

beforeEach(() => {
  vi.clearAllMocks();
  lookupPool = { query: lookupQueryMock };
});

describe("DemandPlanningRepository.getContainerHeaders", () => {
  it("adds no category filter when categoryCode is null", async () => {
    primaryQueryMock.mockResolvedValue({ rows: [] });
    await DemandPlanningRepository.getContainerHeaders(null);
    const [sql, params] = primaryQueryMock.mock.calls[0];
    expect(sql).not.toContain("p.category_code = $1");
    expect(params).toEqual([]);
  });

  it("adds the category existence filter when categoryCode is set", async () => {
    primaryQueryMock.mockResolvedValue({ rows: [] });
    await DemandPlanningRepository.getContainerHeaders("FM");
    const [sql, params] = primaryQueryMock.mock.calls[0];
    expect(sql).toContain("p.category_code = $1");
    expect(params).toEqual(["FM"]);
  });
});

describe("DemandPlanningRepository.getStatsRows", () => {
  it("uses fc_stats_custom directly in custom mode", async () => {
    primaryQueryMock.mockResolvedValue({ rows: [] });
    await DemandPlanningRepository.getStatsRows({ mode: "custom", categoryCode: null, inboundStatuses: "('shipped')" });
    const [sql] = primaryQueryMock.mock.calls[0];
    expect(sql).toContain("FROM shipcore.fc_stats_custom s");
  });

  it("uses fc_stats directly for SC category in link mode", async () => {
    primaryQueryMock.mockResolvedValue({ rows: [] });
    await DemandPlanningRepository.getStatsRows({ mode: "link", categoryCode: "SC", inboundStatuses: "('shipped')" });
    const [sql] = primaryQueryMock.mock.calls[0];
    expect(sql).toContain("FROM shipcore.fc_stats s");
    expect(sql).not.toContain("UNION ALL");
  });

  it("uses a UNION of custom+link for uncategorized link mode", async () => {
    primaryQueryMock.mockResolvedValue({ rows: [] });
    await DemandPlanningRepository.getStatsRows({ mode: "link", categoryCode: null, inboundStatuses: "('shipped')" });
    const [sql] = primaryQueryMock.mock.calls[0];
    expect(sql).toContain("UNION ALL");
  });

  it("uses the home-stats mirror WHERE clause for FM category", async () => {
    primaryQueryMock.mockResolvedValue({ rows: [] });
    await DemandPlanningRepository.getStatsRows({ mode: "link", categoryCode: "FM", inboundStatuses: "('shipped')" });
    const [sql] = primaryQueryMock.mock.calls[0];
    expect(sql).toContain("UPPER(p.category_code) = 'FM'");
  });

  it("selects Container Info from the most recent completed container per SKU", async () => {
    primaryQueryMock.mockResolvedValue({ rows: [] });
    await DemandPlanningRepository.getStatsRows({ mode: "link", categoryCode: null, inboundStatuses: "('shipped')" });
    const [sql] = primaryQueryMock.mock.calls[0];
    expect(sql).toContain("SELECT DISTINCT ON (ci.master_sku)");
    expect(sql).toContain("WHERE c.status = 'complete'");
    expect(sql).toContain("COALESCE(c.actual_arrival_date, c.eta_date)::text");
    expect(sql).toContain("COALESCE(c.actual_arrival_date, c.eta_date) DESC NULLS LAST");
    expect(sql).toContain("completed.latest_container");
  });
});

describe("DemandPlanningRepository.getVelocitySnapshot", () => {
  it("queries the link snapshot table with link columns", async () => {
    primaryQueryMock.mockResolvedValue({ rows: [] });
    await DemandPlanningRepository.getVelocitySnapshot("link", "2026-01-01");
    const [sql, params] = primaryQueryMock.mock.calls[0];
    expect(sql).toContain("shipcore.fc_velocity_link_snapshot");
    expect(sql).toContain("link_master_sku AS master_sku");
    expect(params).toEqual(["2026-01-01"]);
  });

  it("queries the custom snapshot table with custom columns", async () => {
    primaryQueryMock.mockResolvedValue({ rows: [] });
    await DemandPlanningRepository.getVelocitySnapshot("custom", "2026-01-01");
    const [sql] = primaryQueryMock.mock.calls[0];
    expect(sql).toContain("shipcore.fc_velocity_custom_snapshot");
    expect(sql).toContain("custom_master_sku AS master_sku");
  });
});

describe("DemandPlanningRepository.getInventoryByWarehouse", () => {
  it("returns null when no lookup pool is available", async () => {
    lookupPool = null;
    const rows = await DemandPlanningRepository.getInventoryByWarehouse();
    expect(rows).toBeNull();
  });

  it("returns rows from the lookup pool when available", async () => {
    lookupQueryMock.mockResolvedValue({ rows: [{ master_sku: "SKU-1" }] });
    const rows = await DemandPlanningRepository.getInventoryByWarehouse();
    expect(rows).toEqual([{ master_sku: "SKU-1" }]);
  });
});

describe("DemandPlanningRepository.getOosEpisodes", () => {
  it("returns an empty array when no lookup pool is available", async () => {
    lookupPool = null;
    const rows = await DemandPlanningRepository.getOosEpisodes();
    expect(rows).toEqual([]);
  });
});

describe("DemandPlanningRepository.getOosLostDemandRaw", () => {
  it.each([
    ["link", "shipcore.fc_velocity_link_snapshot", "link_master_sku", "link_qty"],
    ["custom", "shipcore.fc_velocity_custom_snapshot", "custom_master_sku", "custom_qty"],
  ] as const)("aggregates %s marketplace quantities from one joined snapshot scan", async (source, table, skuColumn, qtyColumn) => {
    primaryQueryMock.mockResolvedValue({ rows: [] });

    await DemandPlanningRepository.getOosLostDemandRaw(source);

    const [sql] = primaryQueryMock.mock.calls[0];
    expect(sql).toContain(`LEFT JOIN ${table} v`);
    expect(sql).toContain(`ON v.${skuColumn} = ed.master_sku`);
    expect(sql).toContain(`SUM(v.${qtyColumn}) FILTER`);
    expect(sql).toContain("ed.episode_id");
    expect(sql).toContain("GROUP BY");
    expect(sql).not.toContain("SELECT SUM(v.");
  });
});

describe("DemandPlanningRepository.getSalesVelocity", () => {
  it("substitutes $1::date for CURRENT_DATE and passes planningDate", async () => {
    primaryQueryMock.mockResolvedValue({ rows: [] });
    await DemandPlanningRepository.getSalesVelocity("link", "2026-03-01");
    const [sql, params] = primaryQueryMock.mock.calls[0];
    expect(sql).not.toContain("CURRENT_DATE");
    expect(sql).toContain("$1::date - 91");
    expect(params).toEqual(["2026-03-01"]);
  });
});

describe("DemandPlanningRepository.batchUpsert", () => {
  it("splits rows into batches and builds one INSERT per batch", async () => {
    primaryQueryMock.mockResolvedValue({ rows: [] });
    const rows = Array.from({ length: 3 }, (_, i) => ({ master_sku: `SKU-${i}`, qty: i }));
    await DemandPlanningRepository.batchUpsert("shipcore.fc_stats", rows, ["master_sku", "qty"], "qty = EXCLUDED.qty", ["master_sku"], 2);
    expect(primaryQueryMock).toHaveBeenCalledTimes(2);
    const [firstSql, firstParams] = primaryQueryMock.mock.calls[0];
    expect(firstSql).toContain("INSERT INTO shipcore.fc_stats");
    expect(firstParams).toEqual(["SKU-0", 0, "SKU-1", 1]);
  });
});
