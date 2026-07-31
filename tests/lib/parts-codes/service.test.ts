import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundError } from "@/lib/errors";

const repositoryMock = {
  PartsRepository: { list: vi.fn(), findByKey: vi.fn(), findById: vi.fn(), create: vi.fn(), update: vi.fn() },
  CodesRepository: { list: vi.fn(), findByKey: vi.fn(), findById: vi.fn(), create: vi.fn(), update: vi.fn() },
  DesignerInitialsRepository: { list: vi.fn(), findByKey: vi.fn(), findById: vi.fn(), create: vi.fn(), update: vi.fn() },
};

const logAuditMock = vi.fn();

vi.mock("@/lib/parts-codes/repository", () => repositoryMock);
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));

const { MasterDataService, MASTER_DATA_CONFIGS } = await import("@/lib/parts-codes/service");

const WHO = { userId: "u1", userName: "Alice", userEmail: "a@x.com", ip: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MasterDataService.create", () => {
  it("does not uppercase the part name (parts config)", async () => {
    repositoryMock.PartsRepository.findByKey.mockResolvedValue(null);
    repositoryMock.PartsRepository.create.mockResolvedValue({ id: BigInt(1), partName: "seat belt", description: "d", isActive: true });

    await MasterDataService.create(MASTER_DATA_CONFIGS.part, { partName: "seat belt", description: "d" }, WHO);

    expect(repositoryMock.PartsRepository.findByKey).toHaveBeenCalledWith("seat belt");
    expect(repositoryMock.PartsRepository.create).toHaveBeenCalledWith(expect.objectContaining({ partName: "seat belt" }));
  });

  it("uppercases the code before checking duplicates (codes config)", async () => {
    repositoryMock.CodesRepository.findByKey.mockResolvedValue(null);
    repositoryMock.CodesRepository.create.mockResolvedValue({ id: BigInt(1), code: "AB", description: null, isActive: true });

    await MasterDataService.create(MASTER_DATA_CONFIGS.code, { code: "ab" }, WHO);

    expect(repositoryMock.CodesRepository.findByKey).toHaveBeenCalledWith("AB");
    expect(repositoryMock.CodesRepository.create).toHaveBeenCalledWith(expect.objectContaining({ code: "AB" }));
  });

  it("throws ValidationError with the entity-specific message on duplicate", async () => {
    repositoryMock.DesignerInitialsRepository.findByKey.mockResolvedValue({ id: BigInt(1), initial: "KM" });
    await expect(
      MasterDataService.create(MASTER_DATA_CONFIGS.designerInitial, { initial: "km", designerName: "Kim" }, WHO),
    ).rejects.toThrow("Initial already exists: KM");
    expect(repositoryMock.DesignerInitialsRepository.create).not.toHaveBeenCalled();
  });

  it("audit-logs create with the entity-specific 'after' payload", async () => {
    repositoryMock.PartsRepository.findByKey.mockResolvedValue(null);
    repositoryMock.PartsRepository.create.mockResolvedValue({ id: BigInt(7), partName: "Headrest", description: "foam", isActive: true });

    await MasterDataService.create(MASTER_DATA_CONFIGS.part, { partName: "Headrest", description: "foam" }, WHO);

    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "production_part", action: "create", entityId: "7", entityLabel: "Headrest",
      after: { description: "foam" },
    }));
  });
});

describe("MasterDataService.update", () => {
  it("throws NotFoundError with the entity-specific message when missing", async () => {
    repositoryMock.CodesRepository.findById.mockResolvedValue(null);
    await expect(MasterDataService.update(MASTER_DATA_CONFIGS.code, BigInt(1), { description: "x" }, WHO)).rejects.toThrow(NotFoundError);
    await expect(MasterDataService.update(MASTER_DATA_CONFIGS.code, BigInt(1), { description: "x" }, WHO)).rejects.toThrow("Code not found");
  });

  it("treats a lone isActive field as a status-only update with a uniform before/after shape", async () => {
    repositoryMock.PartsRepository.findById.mockResolvedValue({ id: BigInt(1), partName: "P", description: null, isActive: true });
    repositoryMock.PartsRepository.update.mockResolvedValue({ id: BigInt(1), partName: "P", description: null, isActive: false });

    await MasterDataService.update(MASTER_DATA_CONFIGS.part, BigInt(1), { isActive: false }, WHO);

    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "delete",
      before: { isActive: true },
      after: { isActive: false },
    }));
  });

  it("uses status_change action when isActive flips to true", async () => {
    repositoryMock.PartsRepository.findById.mockResolvedValue({ id: BigInt(1), partName: "P", isActive: false });
    repositoryMock.PartsRepository.update.mockResolvedValue({ id: BigInt(1), partName: "P", isActive: true });

    await MasterDataService.update(MASTER_DATA_CONFIGS.part, BigInt(1), { isActive: true }, WHO);

    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "status_change" }));
  });

  it("throws ValidationError on rename collision, excluding the record's own id", async () => {
    repositoryMock.CodesRepository.findById.mockResolvedValue({ id: BigInt(1), code: "AB" });
    repositoryMock.CodesRepository.findByKey.mockResolvedValue({ id: BigInt(2), code: "CD" });

    await expect(MasterDataService.update(MASTER_DATA_CONFIGS.code, BigInt(1), { code: "cd" }, WHO)).rejects.toThrow(
      "Code already exists: CD",
    );
  });

  it("allows renaming to the same value it already has (duplicate id matches self)", async () => {
    repositoryMock.CodesRepository.findById.mockResolvedValue({ id: BigInt(1), code: "AB" });
    repositoryMock.CodesRepository.findByKey.mockResolvedValue({ id: BigInt(1), code: "AB" });
    repositoryMock.CodesRepository.update.mockResolvedValue({ id: BigInt(1), code: "AB", description: "d" });

    await expect(MasterDataService.update(MASTER_DATA_CONFIGS.code, BigInt(1), { code: "ab", description: "d" }, WHO)).resolves.toBeTruthy();
  });

  it("codes' non-status update audit payload omits the code field itself", async () => {
    repositoryMock.CodesRepository.findById.mockResolvedValue({ id: BigInt(1), code: "AB", description: "old" });
    repositoryMock.CodesRepository.update.mockResolvedValue({ id: BigInt(1), code: "AB", description: "new" });

    await MasterDataService.update(MASTER_DATA_CONFIGS.code, BigInt(1), { description: "new" }, WHO);

    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      before: { description: "old" },
      after: { description: "new" },
    }));
  });

  it("parts' non-status update audit payload includes partName unlike codes", async () => {
    repositoryMock.PartsRepository.findById.mockResolvedValue({ id: BigInt(1), partName: "Old", description: "d" });
    repositoryMock.PartsRepository.update.mockResolvedValue({ id: BigInt(1), partName: "New", description: "d" });

    await MasterDataService.update(MASTER_DATA_CONFIGS.part, BigInt(1), { partName: "New" }, WHO);

    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({
      before: { partName: "Old", description: "d" },
      after: { partName: "New", description: "d" },
    }));
  });
});

describe("MasterDataService.softDelete", () => {
  it("throws NotFoundError when the record doesn't exist", async () => {
    repositoryMock.PartsRepository.findById.mockResolvedValue(null);
    await expect(MasterDataService.softDelete(MASTER_DATA_CONFIGS.part, BigInt(1), WHO)).rejects.toThrow(NotFoundError);
  });

  it("sets isActive false and audits with the entity-specific before payload", async () => {
    repositoryMock.PartsRepository.findById.mockResolvedValue({ id: BigInt(1), partName: "P" });
    await MasterDataService.softDelete(MASTER_DATA_CONFIGS.part, BigInt(1), WHO);
    expect(repositoryMock.PartsRepository.update).toHaveBeenCalledWith(BigInt(1), { isActive: false });
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ before: { isActive: true, partName: "P" } }));
  });

  it("codes' delete-before payload omits the code field (matches original asymmetry)", async () => {
    repositoryMock.CodesRepository.findById.mockResolvedValue({ id: BigInt(1), code: "AB" });
    await MasterDataService.softDelete(MASTER_DATA_CONFIGS.code, BigInt(1), WHO);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ before: { isActive: true } }));
  });

  it("designer initials' delete-before payload includes designerName", async () => {
    repositoryMock.DesignerInitialsRepository.findById.mockResolvedValue({ id: BigInt(1), initial: "KM", designerName: "Kim" });
    await MasterDataService.softDelete(MASTER_DATA_CONFIGS.designerInitial, BigInt(1), WHO);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ before: { isActive: true, designerName: "Kim" } }));
  });
});
