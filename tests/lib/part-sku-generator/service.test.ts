import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundError } from "@/lib/errors";

const repositoryMock = {
  list: vi.fn(),
  findBySku: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
};

const logAuditMock = vi.fn();

vi.mock("@/lib/part-sku-generator/repository", () => ({ PartSkusRepository: repositoryMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));

const { PartSkuGeneratorService } = await import("@/lib/part-sku-generator/service");

const WHO = { userId: "u1", userName: "Alice", userEmail: "a@x.com", ip: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PartSkuGeneratorService.create", () => {
  it("builds a Custom sku joining part-makeAbbr-modelAbbr-code-initial-side", async () => {
    repositoryMock.findBySku.mockResolvedValue(null);
    repositoryMock.create.mockResolvedValue({ id: BigInt(1), sku: "Headrest-TY-CAM-AB-KM-D" });

    await PartSkuGeneratorService.create(
      { skuType: "Custom", partName: "Headrest", make: "Toyota", makeAbbr: "TY", model: "Camry", modelAbbr: "CAM", code: "AB", initial: "KM", side: "D" },
      WHO,
    );

    expect(repositoryMock.findBySku).toHaveBeenCalledWith("Headrest-TY-CAM-AB-KM-D");
  });

  it("omits the side segment when side is Universal, even for a Custom sku", async () => {
    repositoryMock.findBySku.mockResolvedValue(null);
    repositoryMock.create.mockResolvedValue({ id: BigInt(1), sku: "Headrest-TY-CAM-AB-KM" });

    await PartSkuGeneratorService.create(
      { skuType: "Custom", partName: "Headrest", make: "Toyota", makeAbbr: "TY", model: "Camry", modelAbbr: "CAM", code: "AB", initial: "KM", side: "Universal" },
      WHO,
    );

    expect(repositoryMock.findBySku).toHaveBeenCalledWith("Headrest-TY-CAM-AB-KM");
  });

  it("uses just the trimmed part name as the sku for Universal skuType", async () => {
    repositoryMock.findBySku.mockResolvedValue(null);
    repositoryMock.create.mockResolvedValue({ id: BigInt(1), sku: "Console Trim" });

    await PartSkuGeneratorService.create({ skuType: "Universal", partName: " Console Trim " }, WHO);

    expect(repositoryMock.findBySku).toHaveBeenCalledWith("Console Trim");
  });

  it("throws ValidationError when the sku already exists", async () => {
    repositoryMock.findBySku.mockResolvedValue({ id: BigInt(2), sku: "Console Trim" });
    await expect(PartSkuGeneratorService.create({ skuType: "Universal", partName: "Console Trim" }, WHO)).rejects.toThrow(
      "Part SKU already exists: Console Trim",
    );
    expect(repositoryMock.create).not.toHaveBeenCalled();
  });

  it("falls back to userEmail for createdByName when userName is missing", async () => {
    repositoryMock.findBySku.mockResolvedValue(null);
    repositoryMock.create.mockResolvedValue({ id: BigInt(1), sku: "X" });
    await PartSkuGeneratorService.create({ skuType: "Universal", partName: "X" }, { ...WHO, userName: null });
    expect(repositoryMock.create).toHaveBeenCalledWith(expect.objectContaining({ createdByName: "a@x.com" }));
  });
});

describe("PartSkuGeneratorService.setActive", () => {
  it("throws NotFoundError when the sku doesn't exist", async () => {
    repositoryMock.findById.mockResolvedValue(null);
    await expect(PartSkuGeneratorService.setActive(BigInt(1), true, WHO)).rejects.toThrow(NotFoundError);
  });

  it("logs status_change when activating and delete when deactivating", async () => {
    repositoryMock.findById.mockResolvedValue({ id: BigInt(1), sku: "X", isActive: false });
    repositoryMock.update.mockResolvedValue({ id: BigInt(1), sku: "X", isActive: true });
    await PartSkuGeneratorService.setActive(BigInt(1), true, WHO);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "status_change" }));

    repositoryMock.findById.mockResolvedValue({ id: BigInt(1), sku: "X", isActive: true });
    repositoryMock.update.mockResolvedValue({ id: BigInt(1), sku: "X", isActive: false });
    await PartSkuGeneratorService.setActive(BigInt(1), false, WHO);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "delete" }));
  });
});

describe("PartSkuGeneratorService.softDelete", () => {
  it("throws NotFoundError when the sku doesn't exist", async () => {
    repositoryMock.findById.mockResolvedValue(null);
    await expect(PartSkuGeneratorService.softDelete(BigInt(1), WHO)).rejects.toThrow(NotFoundError);
  });

  it("deactivates and audits before:{isActive:true}", async () => {
    repositoryMock.findById.mockResolvedValue({ id: BigInt(1), sku: "X" });
    await PartSkuGeneratorService.softDelete(BigInt(1), WHO);
    expect(repositoryMock.update).toHaveBeenCalledWith(BigInt(1), { isActive: false });
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ before: { isActive: true } }));
  });
});
