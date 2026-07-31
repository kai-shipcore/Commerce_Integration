import { describe, it, expect, vi, beforeEach } from "vitest";
import { ValidationError, NotFoundError } from "@/lib/errors";

const repositoryMock = {
  listProducts: vi.fn(),
  findProductById: vi.fn(),
  findProductWithProjectPartStatuses: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
  createProject: vi.fn(),
  findProjectById: vi.fn(),
  findProjectBare: vi.fn(),
  findProjectWithProduct: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  listChecklistItems: vi.fn(),
  createChecklistItem: vi.fn(),
  findChecklistItem: vi.fn(),
  updateChecklistItem: vi.fn(),
  deleteChecklistItem: vi.fn(),
  createProjectPart: vi.fn(),
  findProjectPart: vi.fn(),
  updateProjectPart: vi.fn(),
  deleteProjectPart: vi.fn(),
  listAssignableUsers: vi.fn(),
};

const logAuditMock = vi.fn();

vi.mock("@/lib/product-list/repository", () => ({ ProductListRepository: repositoryMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));

const { ProductListService } = await import("@/lib/product-list/service");

const WHO = { userId: "u1", userName: "Alice", userEmail: "a@x.com", ip: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProductListService.updateProduct", () => {
  it("throws NotFoundError when the product doesn't exist", async () => {
    repositoryMock.findProductById.mockResolvedValue(null);
    await expect(ProductListService.updateProduct(BigInt(1), { make: "Toyota" })).rejects.toThrow(NotFoundError);
  });

  it("blocks setting fNumber unless every project has parts and all are Scanned", async () => {
    repositoryMock.findProductById.mockResolvedValue({ id: BigInt(1) });
    repositoryMock.findProductWithProjectPartStatuses.mockResolvedValue({
      projects: [{ parts: [{ status: "Scanned" }, { status: "Pending" }] }],
    });

    await expect(ProductListService.updateProduct(BigInt(1), { fNumber: "F1" })).rejects.toThrow(
      "Cannot set F Number until every row's parts are all Scanned.",
    );
    expect(repositoryMock.updateProduct).not.toHaveBeenCalled();
  });

  it("blocks setting fNumber when a project has zero parts", async () => {
    repositoryMock.findProductById.mockResolvedValue({ id: BigInt(1) });
    repositoryMock.findProductWithProjectPartStatuses.mockResolvedValue({
      projects: [{ parts: [] }],
    });
    await expect(ProductListService.updateProduct(BigInt(1), { fNumber: "F1" })).rejects.toThrow(ValidationError);
  });

  it("allows setting fNumber when every project's parts are all Scanned", async () => {
    repositoryMock.findProductById.mockResolvedValue({ id: BigInt(1) });
    repositoryMock.findProductWithProjectPartStatuses.mockResolvedValue({
      projects: [{ parts: [{ status: "Scanned" }] }, { parts: [{ status: "Scanned" }, { status: "Scanned" }] }],
    });
    repositoryMock.updateProduct.mockResolvedValue({ id: BigInt(1), fNumber: "F1" });

    await expect(ProductListService.updateProduct(BigInt(1), { fNumber: "F1" })).resolves.toEqual({ id: BigInt(1), fNumber: "F1" });
  });

  it("does not run the fNumber gate when fNumber isn't in the update", async () => {
    repositoryMock.findProductById.mockResolvedValue({ id: BigInt(1) });
    repositoryMock.updateProduct.mockResolvedValue({ id: BigInt(1), make: "Honda" });
    await ProductListService.updateProduct(BigInt(1), { make: "Honda" });
    expect(repositoryMock.findProductWithProjectPartStatuses).not.toHaveBeenCalled();
  });
});

describe("ProductListService.deleteProduct", () => {
  it("throws NotFoundError when missing", async () => {
    repositoryMock.findProductById.mockResolvedValue(null);
    await expect(ProductListService.deleteProduct(BigInt(1), WHO)).rejects.toThrow(NotFoundError);
  });

  it("deletes and audits with make/model/fNumber label", async () => {
    repositoryMock.findProductById.mockResolvedValue({ make: "Toyota", model: "Camry", fNumber: "F1" });
    await ProductListService.deleteProduct(BigInt(1), WHO);
    expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ entityLabel: "Toyota Camry — F1" }));
  });
});

describe("ProductListService.createProject", () => {
  it("throws NotFoundError when the product doesn't exist", async () => {
    repositoryMock.findProductById.mockResolvedValue(null);
    await expect(
      ProductListService.createProject(BigInt(1), { seatRow: "Front", parts: [], checklistItems: [] }, WHO),
    ).rejects.toThrow(NotFoundError);
  });

  it("splits parts/checklistItems from the header and passes them separately", async () => {
    repositoryMock.findProductById.mockResolvedValue({ make: "Toyota", model: "Camry" });
    repositoryMock.createProject.mockResolvedValue({ id: BigInt(1), seatRow: "Front", submodel: null });

    await ProductListService.createProject(
      BigInt(1),
      { seatRow: "Front", parts: [{ status: "Pending", photoCount: 0 }], checklistItems: [{ description: "x", status: "Pending" }] },
      WHO,
    );

    expect(repositoryMock.createProject).toHaveBeenCalledWith(
      BigInt(1),
      { seatRow: "Front" },
      [{ status: "Pending", photoCount: 0 }],
      [{ description: "x", status: "Pending" }],
    );
  });
});

describe("ProductListService checklist items", () => {
  it("createChecklistItem throws NotFoundError when the project doesn't exist", async () => {
    repositoryMock.findProjectBare.mockResolvedValue(null);
    await expect(ProductListService.createChecklistItem(BigInt(1), { description: "x", status: "Pending" })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("updateChecklistItem throws NotFoundError when the item belongs to a different project", async () => {
    repositoryMock.findChecklistItem.mockResolvedValue({ id: BigInt(1), projectId: BigInt(2) });
    await expect(ProductListService.updateChecklistItem(BigInt(1), BigInt(1), { status: "Done" })).rejects.toThrow(
      "Checklist item not found",
    );
  });

  it("deleteChecklistItem succeeds when the item belongs to the given project", async () => {
    repositoryMock.findChecklistItem.mockResolvedValue({ id: BigInt(1), projectId: BigInt(1) });
    await ProductListService.deleteChecklistItem(BigInt(1), BigInt(1));
    expect(repositoryMock.deleteChecklistItem).toHaveBeenCalledWith(BigInt(1));
  });

  it("never calls logAudit for checklist item mutations", async () => {
    repositoryMock.findProjectBare.mockResolvedValue({ id: BigInt(1) });
    repositoryMock.createChecklistItem.mockResolvedValue({ id: BigInt(1) });
    await ProductListService.createChecklistItem(BigInt(1), { description: "x", status: "Pending" });
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe("ProductListService project parts", () => {
  it("createProjectPart throws NotFoundError when the project doesn't exist", async () => {
    repositoryMock.findProjectBare.mockResolvedValue(null);
    await expect(
      ProductListService.createProjectPart(BigInt(1), { status: "Pending", photoCount: 0 }),
    ).rejects.toThrow(NotFoundError);
  });

  it("converts an empty docUrl string to undefined", async () => {
    repositoryMock.findProjectBare.mockResolvedValue({ id: BigInt(1) });
    repositoryMock.createProjectPart.mockResolvedValue({ id: BigInt(1) });

    await ProductListService.createProjectPart(BigInt(1), { status: "Pending", photoCount: 0, docUrl: "" });

    expect(repositoryMock.createProjectPart).toHaveBeenCalledWith(BigInt(1), { status: "Pending", photoCount: 0, docUrl: undefined });
  });

  it("updateProjectPart throws NotFoundError when the part belongs to a different project", async () => {
    repositoryMock.findProjectPart.mockResolvedValue({ id: BigInt(5), projectId: BigInt(2) });
    await expect(ProductListService.updateProjectPart(BigInt(1), BigInt(5), { status: "Scanned" })).rejects.toThrow(
      "Configuration not found",
    );
  });

  it("never calls logAudit for project part mutations", async () => {
    repositoryMock.findProjectPart.mockResolvedValue({ id: BigInt(5), projectId: BigInt(1) });
    await ProductListService.deleteProjectPart(BigInt(1), BigInt(5));
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});
