import { describe, it, expect, vi, beforeEach } from "vitest";

const poolQueryMock = vi.fn();
vi.mock("@/lib/db/primary-db", () => ({
  getPrimaryPool: vi.fn(() => ({ query: poolQueryMock })),
}));

const { PlanningScenarioRepository, inboundStatuses } = await import(
  "@/lib/planning-scenarios/repository"
);

/** Collapses whitespace so assertions can quote SQL readably. */
function sql(call: unknown[]): string {
  return String(call[0]).replace(/\s+/g, " ").trim();
}

beforeEach(() => {
  vi.clearAllMocks();
  poolQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("listVisible", () => {
  it("returns the caller's own tabs plus shared ones, in tab order", async () => {
    await PlanningScenarioRepository.listVisible("u1");
    const [query, params] = poolQueryMock.mock.calls[0];
    expect(String(query).replace(/\s+/g, " ")).toContain(
      "WHERE owner_user_id = $1 OR visibility = 'shared'",
    );
    expect(String(query)).toContain("ORDER BY sort_order, id");
    expect(params).toEqual(["u1"]);
  });
});

describe("update", () => {
  it("only sets the fields that were given", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ id: "5" }], rowCount: 1 });
    await PlanningScenarioRepository.update(5, { name: "Renamed" });

    const [query, params] = poolQueryMock.mock.calls[0];
    expect(sql([query])).toContain("SET name = $2, updated_at = now()");
    expect(sql([query])).not.toContain("visibility =");
    expect(params).toEqual([5, "Renamed"]);
  });

  it("clears the color when explicitly passed null", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ id: "5" }], rowCount: 1 });
    await PlanningScenarioRepository.update(5, { color: null });
    expect(poolQueryMock.mock.calls[0][1]).toEqual([5, null]);
  });

  it("falls back to a plain read when the patch is empty", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ id: "5" }], rowCount: 1 });
    await PlanningScenarioRepository.update(5, {});
    expect(sql(poolQueryMock.mock.calls[0])).toContain("SELECT");
    expect(sql(poolQueryMock.mock.calls[0])).not.toContain("UPDATE");
  });
});

describe("setLock", () => {
  it("stamps locked_at when locking and clears it when unlocking", async () => {
    poolQueryMock.mockResolvedValue({ rows: [{ id: "5" }], rowCount: 1 });
    await PlanningScenarioRepository.setLock(5, "u2");
    expect(poolQueryMock.mock.calls[0][1]).toEqual([5, "u2"]);
    expect(sql(poolQueryMock.mock.calls[0])).toContain(
      "locked_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END",
    );
  });
});

describe("upsertItems", () => {
  it("builds one tuple per cell and shares the scenario id placeholder", async () => {
    await PlanningScenarioRepository.upsertItems(5, [
      { container_id: 11, master_sku: "A", qty: 3 },
      { container_id: 12, master_sku: "B", qty: 0 },
    ]);

    const [query, params] = poolQueryMock.mock.calls[0];
    expect(sql([query])).toContain("VALUES ($1, $2, $3, $4), ($1, $5, $6, $7)");
    expect(sql([query])).toContain(
      "ON CONFLICT (scenario_id, container_id, master_sku) DO UPDATE",
    );
    expect(params).toEqual([5, 11, "A", 3, 12, "B", 0]);
  });

  it("does not query at all for an empty batch", async () => {
    await PlanningScenarioRepository.upsertItems(5, []);
    expect(poolQueryMock).not.toHaveBeenCalled();
  });
});

describe("deleteItems", () => {
  it("matches on the (container, sku) pair", async () => {
    await PlanningScenarioRepository.deleteItems(5, [{ container_id: 11, master_sku: "A" }]);
    const [query, params] = poolQueryMock.mock.calls[0];
    expect(sql([query])).toContain("(container_id, master_sku) IN (($2::bigint, $3::text))");
    expect(params).toEqual([5, 11, "A"]);
  });

  it("does not query at all for an empty batch", async () => {
    await PlanningScenarioRepository.deleteItems(5, []);
    expect(poolQueryMock).not.toHaveBeenCalled();
  });
});

describe("reorder", () => {
  it("writes sort_order from the array position, zero-based", async () => {
    await PlanningScenarioRepository.reorder([7, 5, 6]);
    const [query, params] = poolQueryMock.mock.calls[0];
    expect(sql([query])).toContain("SET sort_order = o.ord - 1");
    expect(params).toEqual([[7, 5, 6]]);
  });
});

describe("inbound status set", () => {
  it("adds draft containers only when drafts are included", () => {
    expect(inboundStatuses(false)).toEqual(["shipped", "packing_received"]);
    expect(inboundStatuses(true)).toEqual(["shipped", "packing_received", "draft"]);
  });

  it("is what the Live snapshot and diff queries filter on", async () => {
    await PlanningScenarioRepository.snapshotLiveIntoScenario(7, true);
    expect(poolQueryMock.mock.calls[0][1]).toEqual([
      7, ["shipped", "packing_received", "draft"],
    ]);

    poolQueryMock.mockClear();
    await PlanningScenarioRepository.getLiveQuantities(false);
    expect(poolQueryMock.mock.calls[0][1]).toEqual([["shipped", "packing_received"]]);
  });
});

describe("getLiveQuantities", () => {
  it("sums duplicate rows per cell and keeps every underlying item id", async () => {
    await PlanningScenarioRepository.getLiveQuantities(false);
    const query = sql(poolQueryMock.mock.calls[0]);
    expect(query).toContain("SUM(i.qty)::int AS qty");
    expect(query).toContain("ARRAY_AGG(i.id ORDER BY i.id) AS item_ids");
    expect(query).toContain("GROUP BY i.container_id, i.master_sku");
  });
});
