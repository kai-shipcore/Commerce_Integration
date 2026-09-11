import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";

const repositoryMock = {
  listVisible: vi.fn(),
  getById: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  setLock: vi.fn(),
  delete: vi.fn(),
  reorder: vi.fn(),
  getItems: vi.fn(),
  upsertItems: vi.fn(),
  deleteItems: vi.fn(),
  getContainerOverrides: vi.fn(),
  upsertContainerOverride: vi.fn(),
  copyOverlay: vi.fn(),
  snapshotLiveIntoScenario: vi.fn(),
  getLiveQuantities: vi.fn(),
  getLiveEtas: vi.fn(),
};

const containerServiceMock = {
  findSkusMissingCbm: vi.fn(),
  upsertItem: vi.fn(),
  deleteItem: vi.fn(),
  getExistingOrThrow: vi.fn(),
  updateEta: vi.fn(),
};

vi.mock("@/lib/planning-scenarios/repository", () => ({
  PlanningScenarioRepository: repositoryMock,
}));
vi.mock("@/lib/container-planning/service", () => ({
  ContainerPlanningService: containerServiceMock,
}));

const { PlanningScenarioService } = await import("@/lib/planning-scenarios/service");

const OWNER = { userId: "u1", role: "user", userName: "Owner", userEmail: "o@x.com", ip: null };
const OTHER = { userId: "u2", role: "user", userName: "Other", userEmail: "t@x.com", ip: null };
const ADMIN = { userId: "u9", role: "admin", userName: "Admin", userEmail: "a@x.com", ip: null };

function scenario(overrides: Record<string, unknown> = {}) {
  return {
    id: "5",
    name: "Plan B",
    owner_user_id: "u1",
    visibility: "private",
    locked_by: null,
    locked_at: null,
    sort_order: 0,
    color: null,
    view_state: { filters: 1 },
    created_at: new Date("2026-09-01T00:00:00Z"),
    updated_at: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  repositoryMock.upsertItems.mockResolvedValue(undefined);
  repositoryMock.deleteItems.mockResolvedValue(undefined);
});

describe("visibility", () => {
  it("hides someone else's private tab as a 404 rather than a 403", async () => {
    repositoryMock.getById.mockResolvedValue(scenario());
    await expect(PlanningScenarioService.get("5", OTHER)).rejects.toThrow(NotFoundError);
  });

  it("lets another user read a shared tab", async () => {
    repositoryMock.getById.mockResolvedValue(scenario({ visibility: "shared" }));
    const result = await PlanningScenarioService.get("5", OTHER);
    expect(result.is_owner).toBe(false);
    expect(result.can_edit).toBe(true);
    expect(result.view_state).toEqual({ filters: 1 });
  });

  it("rejects a non-numeric id", async () => {
    await expect(PlanningScenarioService.get("abc", OWNER)).rejects.toThrow(ValidationError);
  });
});

describe("locking", () => {
  it("blocks edits from everyone but the lock holder", async () => {
    repositoryMock.getById.mockResolvedValue(
      scenario({ visibility: "shared", locked_by: "u3" }),
    );
    await expect(
      PlanningScenarioService.saveItems("5", OTHER, [{ container_id: 1, master_sku: "A", qty: 5 }]),
    ).rejects.toThrow(ForbiddenError);
    expect(repositoryMock.upsertItems).not.toHaveBeenCalled();
  });

  it("still lets the owner edit a tab someone else locked", async () => {
    repositoryMock.getById.mockResolvedValue(
      scenario({ visibility: "shared", locked_by: "u3" }),
    );
    await PlanningScenarioService.saveItems("5", OWNER, [
      { container_id: 1, master_sku: "a-1", qty: 5 },
    ]);
    expect(repositoryMock.upsertItems).toHaveBeenCalledWith(5, [
      { container_id: 1, master_sku: "A-1", qty: 5 },
    ]);
  });

  it("only lets the owner, the lock holder, or an admin unlock", async () => {
    repositoryMock.getById.mockResolvedValue(
      scenario({ visibility: "shared", locked_by: "u3" }),
    );
    await expect(PlanningScenarioService.unlock("5", OTHER)).rejects.toThrow(ForbiddenError);

    repositoryMock.setLock.mockResolvedValue(scenario({ visibility: "shared" }));
    await PlanningScenarioService.unlock("5", ADMIN);
    expect(repositoryMock.setLock).toHaveBeenCalledWith(5, null);
  });
});

describe("saveItems", () => {
  it("upserts a qty and clears an override when qty is null", async () => {
    repositoryMock.getById.mockResolvedValue(scenario());
    await PlanningScenarioService.saveItems("5", OWNER, [
      { container_id: 1, master_sku: "keep", qty: 0 },
      { container_id: 2, master_sku: "drop", qty: null },
    ]);

    // qty 0 is an explicit "ship none", so it is stored, not deleted.
    expect(repositoryMock.upsertItems).toHaveBeenCalledWith(5, [
      { container_id: 1, master_sku: "KEEP", qty: 0 },
    ]);
    expect(repositoryMock.deleteItems).toHaveBeenCalledWith(5, [
      { container_id: 2, master_sku: "DROP" },
    ]);
  });
});

describe("update", () => {
  it("refuses a share change from a non-owner editor", async () => {
    repositoryMock.getById.mockResolvedValue(scenario({ visibility: "shared" }));
    await expect(
      PlanningScenarioService.update("5", OTHER, { visibility: "private" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("lets a non-owner editor save the view state of a shared tab", async () => {
    repositoryMock.getById.mockResolvedValue(scenario({ visibility: "shared" }));
    repositoryMock.update.mockResolvedValue(scenario({ visibility: "shared" }));
    await PlanningScenarioService.update("5", OTHER, { viewState: { a: 1 } });
    expect(repositoryMock.update).toHaveBeenCalledWith(5, expect.objectContaining({
      viewState: { a: 1 },
    }));
  });
});

describe("duplicate", () => {
  it("snapshots Live when there is no source tab", async () => {
    repositoryMock.insert.mockResolvedValue(scenario({ id: "7", name: "Copy" }));
    await PlanningScenarioService.duplicate(OWNER, {
      fromId: null, name: "Copy", includeDrafts: true,
    });
    expect(repositoryMock.snapshotLiveIntoScenario).toHaveBeenCalledWith(7, true);
    expect(repositoryMock.copyOverlay).not.toHaveBeenCalled();
  });

  it("copies the source overlay and its view when duplicating a tab", async () => {
    repositoryMock.getById.mockResolvedValue(scenario());
    repositoryMock.insert.mockResolvedValue(scenario({ id: "7", name: "Copy" }));
    await PlanningScenarioService.duplicate(OWNER, { fromId: "5", name: "Copy" });
    expect(repositoryMock.insert).toHaveBeenCalledWith(expect.objectContaining({
      viewState: { filters: 1 },
      visibility: "private",
    }));
    expect(repositoryMock.copyOverlay).toHaveBeenCalledWith(5, 7);
  });
});

describe("reorder", () => {
  it("drops ids the caller cannot see", async () => {
    repositoryMock.listVisible.mockResolvedValue([scenario({ id: "5" }), scenario({ id: "6" })]);
    await PlanningScenarioService.reorder(OWNER, ["6", "99", "5"]);
    expect(repositoryMock.reorder).toHaveBeenCalledWith([6, 5]);
  });
});

describe("previewApply", () => {
  beforeEach(() => {
    repositoryMock.getById.mockResolvedValue(scenario());
    repositoryMock.getContainerOverrides.mockResolvedValue([]);
    repositoryMock.getLiveEtas.mockResolvedValue([
      { container_id: "1", eta_date: "2026-10-01" },
    ]);
  });

  it("classifies adds, changes and removals, and leaves untouched cells alone", async () => {
    repositoryMock.getItems.mockResolvedValue([
      { container_id: "1", master_sku: "NEW", qty: 10 },
      { container_id: "1", master_sku: "CHANGED", qty: 25 },
      { container_id: "1", master_sku: "REMOVED", qty: 0 },
      { container_id: "1", master_sku: "SAME", qty: 4 },
    ]);
    repositoryMock.getLiveQuantities.mockResolvedValue([
      { container_id: "1", master_sku: "CHANGED", qty: 20, item_ids: [101] },
      { container_id: "1", master_sku: "REMOVED", qty: 7, item_ids: [102, 103] },
      { container_id: "1", master_sku: "SAME", qty: 4, item_ids: [104] },
      { container_id: "1", master_sku: "UNTOUCHED", qty: 99, item_ids: [105] },
    ]);

    const diff = await PlanningScenarioService.previewApply("5", OWNER, false);

    expect(diff.added).toEqual([{ container_id: 1, master_sku: "NEW", qty: 10 }]);
    expect(diff.changed).toEqual([
      { container_id: 1, master_sku: "CHANGED", from: 20, to: 25 },
    ]);
    expect(diff.removed).toEqual([
      { container_id: 1, master_sku: "REMOVED", from: 7, item_ids: [102, 103] },
    ]);
    // A cell the scenario has no row for is not an opinion, so it is untouched.
    expect(diff.added.concat(diff.changed as never[])).not.toContainEqual(
      expect.objectContaining({ master_sku: "UNTOUCHED" }),
    );
  });

  it("ignores overlay rows for containers no longer inbound", async () => {
    repositoryMock.getItems.mockResolvedValue([
      { container_id: "42", master_sku: "GONE", qty: 10 },
    ]);
    repositoryMock.getLiveQuantities.mockResolvedValue([]);

    const diff = await PlanningScenarioService.previewApply("5", OWNER, false);
    expect(diff.added).toEqual([]);
  });

  it("reports an ETA override that differs from Live", async () => {
    repositoryMock.getItems.mockResolvedValue([]);
    repositoryMock.getLiveQuantities.mockResolvedValue([]);
    repositoryMock.getContainerOverrides.mockResolvedValue([
      { container_id: "1", eta_date: "2026-11-15" },
    ]);

    const diff = await PlanningScenarioService.previewApply("5", OWNER, false);
    expect(diff.eta_changes).toEqual([
      { container_id: 1, from: "2026-10-01", to: "2026-11-15" },
    ]);
  });
});

describe("applyToLive", () => {
  beforeEach(() => {
    repositoryMock.getById.mockResolvedValue(scenario());
    repositoryMock.getContainerOverrides.mockResolvedValue([]);
    repositoryMock.getLiveEtas.mockResolvedValue([{ container_id: "1", eta_date: "2026-10-01" }]);
    containerServiceMock.findSkusMissingCbm.mockResolvedValue([]);
  });

  it("writes nothing when a SKU has no CBM on file", async () => {
    repositoryMock.getItems.mockResolvedValue([
      { container_id: "1", master_sku: "NOCBM", qty: 5 },
    ]);
    repositoryMock.getLiveQuantities.mockResolvedValue([]);
    containerServiceMock.findSkusMissingCbm.mockResolvedValue(["NOCBM"]);

    await expect(PlanningScenarioService.applyToLive("5", OWNER, false))
      .rejects.toThrow(ValidationError);
    expect(containerServiceMock.upsertItem).not.toHaveBeenCalled();
  });

  it("goes through ContainerPlanningService so allocations and audit still run", async () => {
    repositoryMock.getItems.mockResolvedValue([
      { container_id: "1", master_sku: "NEW", qty: 10 },
      { container_id: "1", master_sku: "REMOVED", qty: 0 },
    ]);
    repositoryMock.getLiveQuantities.mockResolvedValue([
      { container_id: "1", master_sku: "REMOVED", qty: 7, item_ids: [102, 103] },
    ]);

    const result = await PlanningScenarioService.applyToLive("5", OWNER, false);

    expect(containerServiceMock.upsertItem).toHaveBeenCalledWith(1, "NEW", 10, 0, null);
    expect(containerServiceMock.deleteItem).toHaveBeenCalledWith(102);
    expect(containerServiceMock.deleteItem).toHaveBeenCalledWith(103);
    expect(result.applied).toBe(2);
  });
});
