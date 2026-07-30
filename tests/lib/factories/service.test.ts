import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundError, ValidationError } from "@/lib/errors";

const repositoryMock = {
  ensureFactoryCodes: vi.fn(),
  listFactories: vi.fn(),
  createFactory: vi.fn(),
  findById: vi.fn(),
  existsByNameExcludingId: vi.fn(),
  updateFactory: vi.fn(),
  setActive: vi.fn(),
};

const logAuditMock = vi.fn();
const authMock = vi.fn();

vi.mock("@/lib/factories/repository", () => ({ FactoriesRepository: repositoryMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));
vi.mock("@/lib/auth", () => ({ auth: authMock }));

const { FactoriesService } = await import("@/lib/factories/service");

const ROW = {
  id: "1",
  factory_code: "FC-0001",
  factory_name: "Acme",
  origin: "CN",
  contact_name: "Jane",
  email: "jane@acme.com",
  phone: "123",
  is_active: true,
  created_at: new Date("2026-01-01T00:00:00.000Z"),
  updated_at: new Date("2026-01-02T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1", name: "Tester", email: "t@example.com" } });
});

describe("FactoriesService.listFactories", () => {
  it("ensures factory codes, then filters and serializes rows", async () => {
    repositoryMock.listFactories.mockResolvedValue([ROW]);

    const result = await FactoriesService.listFactories({ active: "true", search: " acme " });

    expect(repositoryMock.ensureFactoryCodes).toHaveBeenCalled();
    expect(repositoryMock.listFactories).toHaveBeenCalledWith({ active: true, search: "acme" });
    expect(result[0]).toMatchObject({ id: "1", factoryCode: "FC-0001", isActive: true });
    expect(result[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("passes null active through when no filter is given", async () => {
    repositoryMock.listFactories.mockResolvedValue([]);
    await FactoriesService.listFactories({ active: null, search: "" });
    expect(repositoryMock.listFactories).toHaveBeenCalledWith({ active: null, search: "" });
  });
});

describe("FactoriesService.createFactory", () => {
  it("creates, serializes, and logs an audit entry", async () => {
    repositoryMock.createFactory.mockResolvedValue(ROW);

    const result = await FactoriesService.createFactory({ factoryName: " Acme " }, "1.1.1.1");

    expect(repositoryMock.createFactory).toHaveBeenCalledWith(
      expect.objectContaining({ factoryName: "Acme", factoryCode: null })
    );
    expect(result.factoryName).toBe("Acme");
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "create", entityId: "1", ip: "1.1.1.1" }));
  });
});

describe("FactoriesService.updateFactory", () => {
  it("throws NotFoundError when the factory doesn't exist", async () => {
    repositoryMock.findById.mockResolvedValue(null);
    await expect(FactoriesService.updateFactory("missing", { factoryName: "X" }, null)).rejects.toThrow(NotFoundError);
  });

  it("throws ValidationError on a duplicate factory name", async () => {
    repositoryMock.findById.mockResolvedValue(ROW);
    repositoryMock.existsByNameExcludingId.mockResolvedValue(true);

    await expect(FactoriesService.updateFactory("1", { factoryName: "Acme" }, null)).rejects.toThrow(ValidationError);
    expect(repositoryMock.updateFactory).not.toHaveBeenCalled();
  });

  it("updates and logs before/after audit values", async () => {
    repositoryMock.findById.mockResolvedValue(ROW);
    repositoryMock.existsByNameExcludingId.mockResolvedValue(false);
    repositoryMock.updateFactory.mockResolvedValue({ ...ROW, factory_name: "Acme Corp" });

    const result = await FactoriesService.updateFactory("1", { factoryName: "Acme Corp" }, "2.2.2.2");

    expect(result.factoryName).toBe("Acme Corp");
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update",
        before: expect.objectContaining({ factoryName: "Acme" }),
        after: expect.objectContaining({ factoryName: "Acme Corp" }),
      })
    );
  });
});

describe("FactoriesService.setActive", () => {
  it("throws NotFoundError when the factory doesn't exist", async () => {
    repositoryMock.setActive.mockResolvedValue(null);
    await expect(FactoriesService.setActive("missing", false, null)).rejects.toThrow(NotFoundError);
  });

  it("logs status_change when activating", async () => {
    repositoryMock.setActive.mockResolvedValue({ ...ROW, is_active: true });
    await FactoriesService.setActive("1", true, null);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "status_change" }));
  });

  it("logs delete when deactivating", async () => {
    repositoryMock.setActive.mockResolvedValue({ ...ROW, is_active: false });
    await FactoriesService.setActive("1", false, null);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "delete" }));
  });
});
