import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkbenchApiError,
  workbenchConfig,
  workbenchRequest,
  workbenchTarget,
} from "@/lib/workbench/client";

const config = { baseUrl: "https://staging.cowork.coverland.com", apiKey: "test-key" };
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("workbenchConfig", () => {
  it("is null unless both the URL and the key are set", () => {
    vi.stubEnv("WORKBENCH_API_URL", "https://staging.cowork.coverland.com");
    vi.stubEnv("WORKBENCH_API_KEY", "");
    expect(workbenchConfig()).toBeNull();

    vi.stubEnv("WORKBENCH_API_KEY", "  test-key  ");
    vi.stubEnv("WORKBENCH_API_URL", "https://staging.cowork.coverland.com///");
    expect(workbenchConfig()).toEqual(config);
  });
});

describe("workbenchRequest", () => {
  it("authenticates with X-Api-Key, never Authorization, and unwraps the envelope", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: [{ id: "w1" }], meta: { pagination: { total: 1 } } }));

    const result = await workbenchRequest(config, "GET", "/api/v1/warehouses", {
      query: { page: 1, pageSize: 100, search: undefined },
      requestId: "22222222-2222-4222-8222-222222222222",
    });

    expect(result).toEqual({ data: [{ id: "w1" }], meta: { pagination: { total: 1 } } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://staging.cowork.coverland.com/api/v1/warehouses?page=1&pageSize=100");
    expect(init.headers["X-Api-Key"]).toBe("test-key");
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers["x-request-id"]).toBe("22222222-2222-4222-8222-222222222222");
    expect(init.headers["Content-Type"]).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("sends a JSON body on POST", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: { created: 1 } }));

    await workbenchRequest(config, "POST", "/api/v1/inbound-containers/import", { body: { containers: [] } });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ containers: [] }));
  });

  it("raises Workbench's error code and message", async () => {
    fetchMock.mockResolvedValue(jsonResponse(422, {
      success: false,
      error: { code: 34005, message: "Inbound container import rejected; nothing was saved (1 problems): container 1-CA: unknown SKU X" },
      meta: {},
    }));

    const error = await workbenchRequest(config, "POST", "/api/v1/inbound-containers/import", { body: {} })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(WorkbenchApiError);
    expect(error).toMatchObject({
      status: 422,
      code: 34005,
      apiMessage: "Inbound container import rejected; nothing was saved (1 problems): container 1-CA: unknown SKU X",
    });
    expect((error as Error).message).toContain("unknown SKU X");
  });

  it("raises on a non-JSON answer such as a CDN error page", async () => {
    fetchMock.mockResolvedValue(new Response("<html>502 Bad Gateway</html>", { status: 502 }));

    await expect(workbenchRequest(config, "GET", "/api/v1/warehouses")).rejects.toMatchObject({ status: 502, code: null });
  });

  it("reports status 0 when the request never got an answer", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    await expect(workbenchRequest(config, "GET", "/api/v1/warehouses")).rejects.toMatchObject({ status: 0 });
  });
});

describe("workbenchTarget", () => {
  it("names the host only", () => {
    expect(workbenchTarget(config)).toBe("staging.cowork.coverland.com");
  });
});
