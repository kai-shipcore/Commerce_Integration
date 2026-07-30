import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundError, ValidationError } from "@/lib/errors";

const repositoryMock = {
  queryOrders: vi.fn(),
  getOrderDetail: vi.fn(),
};

const cacheManagerMock = {
  get: vi.fn(),
  set: vi.fn(),
};

vi.mock("@/lib/orders/repository", async () => {
  const actual = await vi.importActual<typeof import("@/lib/orders/repository")>("@/lib/orders/repository");
  return { ...actual, OrderRepository: repositoryMock };
});
vi.mock("@/lib/redis", () => ({ CacheManager: cacheManagerMock }));

const { OrderService } = await import("@/lib/orders/service");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OrderService.listOrders", () => {
  it("returns the cached result without querying the repository on a cache hit", async () => {
    const cached = { rows: [], totalRows: 0, platformSources: [], orderStatuses: [], summary: { totalOrders: 0, totalRevenue: 0, totalUnits: 0, totalPlatforms: 0 } };
    cacheManagerMock.get.mockResolvedValue(cached);

    const result = await OrderService.listOrders({});

    expect(result).toBe(cached);
    expect(repositoryMock.queryOrders).not.toHaveBeenCalled();
  });

  it("queries the repository and caches the result on a cache miss", async () => {
    cacheManagerMock.get.mockResolvedValue(null);
    const fresh = { rows: [], totalRows: 3, platformSources: ["shopify"], orderStatuses: ["open"], summary: { totalOrders: 3, totalRevenue: 10, totalUnits: 0, totalPlatforms: 1 } };
    repositoryMock.queryOrders.mockResolvedValue(fresh);

    const result = await OrderService.listOrders({});

    expect(result).toBe(fresh);
    expect(cacheManagerMock.set).toHaveBeenCalledWith(
      "orders:v4:1:20:orderDate:desc::all:all::",
      fresh,
      120
    );
  });

  it("bypasses the cache entirely when exportAll is set", async () => {
    repositoryMock.queryOrders.mockResolvedValue({
      rows: [], totalRows: 0, platformSources: [], orderStatuses: [],
      summary: { totalOrders: 0, totalRevenue: 0, totalUnits: 0, totalPlatforms: 0 },
    });

    await OrderService.listOrders({ exportAll: true });

    expect(cacheManagerMock.get).not.toHaveBeenCalled();
    expect(cacheManagerMock.set).not.toHaveBeenCalled();
  });
});

describe("OrderService.getOrderDetail", () => {
  it("throws ValidationError for a non-numeric id", async () => {
    await expect(OrderService.getOrderDetail("abc")).rejects.toThrow(ValidationError);
    expect(repositoryMock.getOrderDetail).not.toHaveBeenCalled();
  });

  it("throws ValidationError for a non-positive id", async () => {
    await expect(OrderService.getOrderDetail("0")).rejects.toThrow(ValidationError);
    await expect(OrderService.getOrderDetail("-5")).rejects.toThrow(ValidationError);
  });

  it("throws NotFoundError when the repository returns null", async () => {
    repositoryMock.getOrderDetail.mockResolvedValue(null);

    await expect(OrderService.getOrderDetail("42")).rejects.toThrow(NotFoundError);
    expect(repositoryMock.getOrderDetail).toHaveBeenCalledWith(42);
  });

  it("returns the order on success", async () => {
    const order = { id: 42 };
    repositoryMock.getOrderDetail.mockResolvedValue(order);

    const result = await OrderService.getOrderDetail("42");

    expect(result).toBe(order);
  });
});
