import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundError, ValidationError } from "@/lib/errors";

const repositoryMock = {
  findMany: vi.fn(),
  findByCode: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  setActive: vi.fn(),
  listActiveForDropdown: vi.fn(),
};

const logAuditMock = vi.fn();
const authMock = vi.fn();

vi.mock("@/lib/warehouses/repository", () => ({ WarehousesRepository: repositoryMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));
vi.mock("@/lib/auth", () => ({ auth: authMock }));

const { WarehousesService, isStatusOnlyUpdate } = await import("@/lib/warehouses/service");

const ROW = {
  id: BigInt(1),
  warehouseCode: "WH1",
  warehouseName: "West",
  warehouseType: "own",
  country: "US",
  stateRegion: null,
  city: null,
  timezone: null,
  isActive: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1", name: "Tester", email: "t@example.com" } });
});

describe("isStatusOnlyUpdate", () => {
  it("is true when only isActive is present", () => {
    expect(isStatusOnlyUpdate({ isActive: false })).toBe(true);
  });

  it("is false when other fields are present", () => {
    expect(isStatusOnlyUpdate({ isActive: false, warehouseName: "X" })).toBe(false);
  });

  it("is false when isActive is absent", () => {
    expect(isStatusOnlyUpdate({ warehouseName: "X" })).toBe(false);
  });
});

describe("WarehousesService.listWarehouses", () => {
  it("serializes BigInt ids to strings", async () => {
    repositoryMock.findMany.mockResolvedValue([ROW]);
    const result = await WarehousesService.listWarehouses({ search: "", type: "", active: null });
    expect(result[0].id).toBe("1");
    expect(repositoryMock.findMany).toHaveBeenCalledWith({ search: "", type: "", active: null });
  });

  it("converts the active query string to a boolean", async () => {
    repositoryMock.findMany.mockResolvedValue([]);
    await WarehousesService.listWarehouses({ search: "", type: "", active: "true" });
    expect(repositoryMock.findMany).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
  });
});

describe("WarehousesService.createWarehouse", () => {
  it("throws ValidationError on a duplicate warehouse code", async () => {
    repositoryMock.findByCode.mockResolvedValue(ROW);
    await expect(
      WarehousesService.createWarehouse({ warehouseCode: "wh1", warehouseName: "West", warehouseType: "own", isActive: true }, null)
    ).rejects.toThrow(ValidationError);
    expect(repositoryMock.create).not.toHaveBeenCalled();
  });

  it("uppercases the code, creates, and logs an audit entry", async () => {
    repositoryMock.findByCode.mockResolvedValue(null);
    repositoryMock.create.mockResolvedValue(ROW);

    const result = await WarehousesService.createWarehouse(
      { warehouseCode: "wh1", warehouseName: "West", warehouseType: "own", isActive: true },
      "1.2.3.4"
    );

    expect(repositoryMock.create).toHaveBeenCalledWith(expect.objectContaining({ warehouseCode: "WH1" }));
    expect(result.id).toBe("1");
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "create", ip: "1.2.3.4" }));
  });
});

describe("WarehousesService.updateWarehouse", () => {
  it("throws NotFoundError when the warehouse doesn't exist", async () => {
    repositoryMock.findById.mockResolvedValue(null);
    await expect(WarehousesService.updateWarehouse("1", { warehouseName: "X" }, null)).rejects.toThrow(NotFoundError);
  });

  it("throws ValidationError on a duplicate code owned by another row", async () => {
    repositoryMock.findById.mockResolvedValue(ROW);
    repositoryMock.findByCode.mockResolvedValue({ ...ROW, id: BigInt(2) });

    await expect(WarehousesService.updateWarehouse("1", { warehouseCode: "wh2" }, null)).rejects.toThrow(ValidationError);
    expect(repositoryMock.update).not.toHaveBeenCalled();
  });

  it("allows keeping the same code on the same row", async () => {
    repositoryMock.findById.mockResolvedValue(ROW);
    repositoryMock.findByCode.mockResolvedValue(ROW); // same id (BigInt(1))
    repositoryMock.update.mockResolvedValue(ROW);

    await WarehousesService.updateWarehouse("1", { warehouseCode: "wh1" }, null);

    expect(repositoryMock.update).toHaveBeenCalled();
  });

  it("logs status_change for a status-only activation", async () => {
    repositoryMock.findById.mockResolvedValue({ ...ROW, isActive: false });
    repositoryMock.update.mockResolvedValue({ ...ROW, isActive: true });

    await WarehousesService.updateWarehouse("1", { isActive: true }, null);

    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "status_change", before: { isActive: false }, after: { isActive: true } }));
  });

  it("logs delete for a status-only deactivation", async () => {
    repositoryMock.findById.mockResolvedValue(ROW);
    repositoryMock.update.mockResolvedValue({ ...ROW, isActive: false });

    await WarehousesService.updateWarehouse("1", { isActive: false }, null);

    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "delete" }));
  });

  it("logs a plain update for a multi-field edit", async () => {
    repositoryMock.findById.mockResolvedValue(ROW);
    repositoryMock.update.mockResolvedValue({ ...ROW, warehouseName: "East" });

    await WarehousesService.updateWarehouse("1", { warehouseName: "East", country: "CA" }, null);

    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "update" }));
  });
});

describe("WarehousesService.deactivateWarehouse", () => {
  it("throws NotFoundError when the warehouse doesn't exist", async () => {
    repositoryMock.findById.mockResolvedValue(null);
    await expect(WarehousesService.deactivateWarehouse("1", null)).rejects.toThrow(NotFoundError);
  });

  it("deactivates and logs an audit entry", async () => {
    repositoryMock.findById.mockResolvedValue(ROW);

    await WarehousesService.deactivateWarehouse("1", "9.9.9.9");

    expect(repositoryMock.setActive).toHaveBeenCalledWith("1", false);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "delete", ip: "9.9.9.9" }));
  });
});

describe("WarehousesService.listActiveForDropdown", () => {
  it("delegates to the repository", async () => {
    repositoryMock.listActiveForDropdown.mockResolvedValue([{ warehouseCode: "WH1", warehouseName: "West", warehouseType: "own" }]);
    const result = await WarehousesService.listActiveForDropdown();
    expect(result).toHaveLength(1);
  });
});
