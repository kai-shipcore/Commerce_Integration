import { beforeEach, describe, expect, it, vi } from "vitest";

const listContainersMock = vi.fn();
const workbenchConfigMock = vi.fn();
const workbenchRequestMock = vi.fn();

vi.mock("@/lib/workbench-container-push/repository", () => ({
  WorkbenchContainerPushRepository: { listContainers: listContainersMock },
}));
vi.mock("@/lib/workbench/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workbench/client")>("@/lib/workbench/client");
  return { ...actual, workbenchConfig: workbenchConfigMock, workbenchRequest: workbenchRequestMock };
});

const { WorkbenchApiError } = await import("@/lib/workbench/client");
const {
  WorkbenchContainerPushService,
  chunkContainers,
  parseImportRejection,
  prepareContainer,
  warehouseNameKey,
} = await import("@/lib/workbench-container-push/service");

const config = { baseUrl: "https://staging.cowork.coverland.com", apiKey: "test-key" };
const FULLERTON_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TTM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const warehouses = [
  { id: FULLERTON_ID, name: "Fullerton", status: "ACTIVE" },
  { id: TTM_ID, name: "TTM", status: "ACTIVE" },
];

type Row = {
  id: string;
  container_number: string;
  status: string;
  dest_warehouse: string | null;
  dest_warehouse_name: string | null;
  dest_timezone: string | null;
  eta_date: string | null;
  eta_lax_lgb_date: string | null;
  items: { sku: string; qty: number }[];
};

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "1",
    container_number: "137-CA",
    status: "shipped",
    dest_warehouse: "FULLERTON",
    dest_warehouse_name: "Fullerton Primary",
    dest_timezone: "America/Los_Angeles",
    eta_date: "2026-12-01",
    eta_lax_lgb_date: null,
    items: [{ sku: "CA-SC-10-F-10-BK-1TO", qty: 12 }],
    ...overrides,
  };
}

/** Answers GET /warehouses, and each import with every container counted as created. */
function workbenchAnswers(importAnswer?: (containers: { containerNumber: string }[]) => unknown) {
  workbenchRequestMock.mockImplementation(async (_config, method: string, path: string, options?: { body?: { containers: { containerNumber: string }[] } }) => {
    if (method === "GET" && path === "/api/v1/warehouses") {
      return { data: warehouses, meta: { pagination: { page: 1, pageSize: 100, total: warehouses.length } } };
    }
    const containers = options?.body?.containers ?? [];
    if (importAnswer) {
      const answer = importAnswer(containers);
      if (answer instanceof Error) throw answer;
      if (answer) return answer;
    }
    return {
      data: {
        created: containers.length,
        updated: 0,
        unchanged: 0,
        containers: containers.map((c) => ({ containerNumber: c.containerNumber, inboundContainerId: "x", result: "CREATED" })),
      },
    };
  });
}

function importCalls() {
  return workbenchRequestMock.mock.calls.filter(([, method]) => method === "POST");
}

/** A 422 as the client raises it, with Workbench's own message kept whole. */
function rejection(apiMessage: string) {
  return new WorkbenchApiError(`Workbench POST /api/v1/inbound-containers/import → 422: ${apiMessage}`.slice(0, 1000), 422, 34005, apiMessage);
}

beforeEach(() => {
  vi.clearAllMocks();
  workbenchConfigMock.mockReturnValue(config);
});

describe("prepareContainer", () => {
  const ids = new Map([[warehouseNameKey("Fullerton"), FULLERTON_ID]]);

  it("maps status, destination, both ETAs, and items into Workbench's import shape", () => {
    const prepared = prepareContainer(
      row({
        status: "packing_received",
        eta_lax_lgb_date: "2026-11-25",
        items: [
          { sku: "CA-SC-10-F-10-BK-1TO", qty: 5 },
          { sku: "ca-sc-10-f-10-bk-1to", qty: 3 },
          { sku: "FM-02", qty: 0 },
        ],
      }),
      ids,
    );

    expect(prepared).toEqual({
      kind: "ready",
      container: {
        containerNumber: "137-CA",
        status: "CARGO_LOADED",
        warehouseId: FULLERTON_ID,
        portArrival: {
          estimatedDate: "2026-11-25",
          timeZone: "America/Los_Angeles",
          portLocationCode: null,
          portName: "Los Angeles / Long Beach",
        },
        warehouseArrival: { estimatedDate: "2026-12-01", timeZone: "America/Los_Angeles" },
        items: [{ sku: "CA-SC-10-F-10-BK-1TO", loadedQuantity: 8 }],
      },
    });
  });

  it("uses the destination's own timezone for the warehouse arrival, and LA for the port", () => {
    const prepared = prepareContainer(
      row({ dest_timezone: "America/Chicago", eta_lax_lgb_date: "2026-11-25" }),
      ids,
    );
    expect(prepared.kind === "ready" && prepared.container.warehouseArrival.timeZone).toBe("America/Chicago");
    expect(prepared.kind === "ready" && prepared.container.portArrival.timeZone).toBe("America/Los_Angeles");
  });

  it("falls back to LA when DP has no timezone for the destination", () => {
    const prepared = prepareContainer(row({ dest_timezone: null }), ids);
    expect(prepared.kind === "ready" && prepared.container.warehouseArrival.timeZone).toBe("America/Los_Angeles");
  });

  it("finds a Workbench warehouse named after DP's display name instead of its code", () => {
    const byDisplayName = new Map([[warehouseNameKey("TTM Group (East)"), TTM_ID]]);
    const prepared = prepareContainer(row({ dest_warehouse: "TTM", dest_warehouse_name: "TTM Group (East)" }), byDisplayName);
    expect(prepared.kind === "ready" && prepared.container.warehouseId).toBe(TTM_ID);
  });

  it("sends no port name without a port date", () => {
    const prepared = prepareContainer(row(), ids);
    expect(prepared.kind === "ready" && prepared.container.portArrival).toEqual({
      estimatedDate: null,
      timeZone: "America/Los_Angeles",
      portLocationCode: null,
      portName: null,
    });
  });

  it.each([
    ["shipped", "IN_TRANSIT"],
    ["complete", "DELIVERED"],
  ])("maps %s to %s", (dpStatus, workbenchStatus) => {
    const prepared = prepareContainer(row({ status: dpStatus }), ids);
    expect(prepared.kind === "ready" && prepared.container.status).toBe(workbenchStatus);
  });

  it("does not send a draft", () => {
    expect(prepareContainer(row({ status: "draft" }), ids)).toEqual({ kind: "skip", reason: "status draft is not sent" });
  });

  it("skips a container without a destination or with one Workbench does not have", () => {
    expect(prepareContainer(row({ dest_warehouse: null }), ids)).toEqual({ kind: "skip", reason: "no destination warehouse" });
    expect(prepareContainer(row({ dest_warehouse: "LINK ONE", dest_warehouse_name: "Link One" }), ids)).toEqual({
      kind: "skip",
      reason: "warehouse LINK ONE not found in Workbench",
    });
  });

  it("skips a container over Workbench's 500-SKU limit", () => {
    const items = Array.from({ length: 501 }, (_, index) => ({ sku: `SKU-${index}`, qty: 1 }));
    expect(prepareContainer(row({ items }), ids)).toEqual({ kind: "skip", reason: "more than 500 SKUs in one container" });
  });
});

describe("parseImportRejection", () => {
  it("reads each listed problem, its container, and any unknown SKU", () => {
    const parsed = parseImportRejection(
      "Inbound container import rejected; nothing was saved (3 problems): container 185-CA-SEAT: unknown SKU CA-SC-10-B-10-BK-1TO; container 185-CA-SEAT: unknown SKU CA-SC-PART-BTM-D-BE; container 9-CA: PORT_ARRIVAL: timeZone must be a Workbench IANA identifier",
    );
    expect(parsed).toEqual({
      total: 3,
      truncated: false,
      problems: [
        { containerNumber: "185-CA-SEAT", text: "unknown SKU CA-SC-10-B-10-BK-1TO", unknownSku: "CA-SC-10-B-10-BK-1TO" },
        { containerNumber: "185-CA-SEAT", text: "unknown SKU CA-SC-PART-BTM-D-BE", unknownSku: "CA-SC-PART-BTM-D-BE" },
        { containerNumber: "9-CA", text: "PORT_ARRIVAL: timeZone must be a Workbench IANA identifier", unknownSku: null },
      ],
    });
  });

  it("notices when Workbench listed only some of the problems", () => {
    const parsed = parseImportRejection(
      "Inbound container import rejected; nothing was saved (57 problems): container 1-CA: unknown SKU A; and 56 more problems",
    );
    expect(parsed).toMatchObject({ total: 57, truncated: true, problems: [{ unknownSku: "A" }] });
  });

  it("is null for a message that is not an import rejection", () => {
    expect(parseImportRejection("Unauthorized")).toBeNull();
  });
});

describe("chunkContainers", () => {
  const container = (items: number) => ({
    containerNumber: "c",
    status: "IN_TRANSIT" as const,
    warehouseId: FULLERTON_ID,
    portArrival: { estimatedDate: null, timeZone: "America/Los_Angeles", portLocationCode: null, portName: null },
    warehouseArrival: { estimatedDate: null, timeZone: "America/Los_Angeles" },
    items: Array.from({ length: items }, (_, index) => ({ sku: `S${index}`, loadedQuantity: 1 })),
  });

  it("keeps each request within 25 containers", () => {
    const chunks = chunkContainers(Array.from({ length: 51 }, () => container(1)));
    expect(chunks.map((chunk) => chunk.length)).toEqual([25, 25, 1]);
  });

  it("keeps each request within 5,000 items", () => {
    const chunks = chunkContainers(Array.from({ length: 12 }, () => container(450)));
    expect(chunks.map((chunk) => chunk.length)).toEqual([11, 1]);
  });
});

describe("WorkbenchContainerPushService.push", () => {
  it("is skipped, touching nothing, until the URL and key are configured", async () => {
    workbenchConfigMock.mockReturnValue(null);

    const result = await WorkbenchContainerPushService.push();

    expect(result).toEqual({ status: "skipped", reason: "WORKBENCH_API_URL or WORKBENCH_API_KEY is not set" });
    expect(listContainersMock).not.toHaveBeenCalled();
    expect(workbenchRequestMock).not.toHaveBeenCalled();
  });

  it("reads only the sendable statuses and imports them, forwarding the job's correlation id", async () => {
    listContainersMock.mockResolvedValue([
      row({ container_number: "1-CA" }),
      row({ container_number: "2-CA", dest_warehouse: "TTM", dest_warehouse_name: "TTM Group (East)", status: "complete" }),
    ]);
    workbenchAnswers();

    const result = await WorkbenchContainerPushService.push({ requestId: "req-1" });

    expect(listContainersMock).toHaveBeenCalledWith(["packing_received", "shipped", "complete"]);
    const [[, , path, options]] = importCalls();
    expect(path).toBe("/api/v1/inbound-containers/import");
    expect(options.requestId).toBe("req-1");
    expect(options.body.containers.map((c: { warehouseId: string }) => c.warehouseId)).toEqual([FULLERTON_ID, TTM_ID]);
    expect(result).toMatchObject({
      status: "succeeded",
      target: "staging.cowork.coverland.com",
      considered: 2,
      sent: 2,
      created: 2,
      failed: 0,
      skipped: 0,
      errors: [],
    });
  });

  it("counts containers it could not send, by reason, and still sends the rest", async () => {
    listContainersMock.mockResolvedValue([
      row({ container_number: "1-CA" }),
      row({ container_number: "2-CA", dest_warehouse: null }),
      row({ container_number: "3-CA", dest_warehouse: null }),
      row({ container_number: "4-CA", dest_warehouse: "LINK ONE", dest_warehouse_name: "Link One" }),
    ]);
    workbenchAnswers();

    const result = await WorkbenchContainerPushService.push();

    expect(result).toMatchObject({
      status: "succeeded",
      considered: 4,
      sent: 1,
      skipped: 3,
      skipReasons: { "no destination warehouse": 2, "warehouse LINK ONE not found in Workbench": 1 },
    });
  });

  it("resends a rejected batch one container at a time so only the bad one fails", async () => {
    listContainersMock.mockResolvedValue([
      row({ container_number: "1-CA" }),
      row({ container_number: "2-CA" }),
      row({ container_number: "3-CA" }),
    ]);
    workbenchAnswers((containers) =>
      containers.some((c) => c.containerNumber === "2-CA")
        ? rejection("Inbound container import rejected; nothing was saved (2 problems): container 2-CA: unknown SKU x-1; container 2-CA: unknown SKU X-2")
        : undefined,
    );

    const result = await WorkbenchContainerPushService.push();

    // One batch, then one request per container.
    expect(importCalls()).toHaveLength(4);
    expect(result).toMatchObject({
      status: "partial",
      sent: 2,
      created: 2,
      failed: 1,
      missingSkus: ["x-1", "X-2"],
      missingSkuCount: 2,
      missingSkusComplete: true,
      failedContainers: [{ containerNumber: "2-CA", missingSkuCount: 2, problems: [] }],
      // A container's own rejection is not a general error.
      errors: [],
    });
  });

  it("keeps problems other than unknown SKUs on the container that has them", async () => {
    listContainersMock.mockResolvedValue([row({ container_number: "1-CA" })]);
    workbenchAnswers(() => rejection(
      "Inbound container import rejected; nothing was saved (2 problems): container 1-CA: unknown SKU A; container 1-CA: SKU B has a reported received quantity and cannot be removed",
    ));

    const result = await WorkbenchContainerPushService.push();

    expect(result).toMatchObject({
      status: "failed",
      missingSkus: ["A"],
      failedContainers: [{
        containerNumber: "1-CA",
        missingSkuCount: 1,
        problems: ["SKU B has a reported received quantity and cannot be removed"],
      }],
    });
  });

  it("finishes a missing-SKU list Workbench cut short from its master product catalogue", async () => {
    const items = ["S1", "S2", "S3"].map((sku) => ({ sku, qty: 1 }));
    listContainersMock.mockResolvedValue([row({ container_number: "1-CA", items })]);
    workbenchRequestMock.mockImplementation(async (_c, method: string, path: string) => {
      if (path === "/api/v1/warehouses") {
        return { data: warehouses, meta: { pagination: { page: 1, pageSize: 100, total: warehouses.length } } };
      }
      if (path === "/api/v1/master-products") {
        return { data: [{ sku: "s2" }], meta: { pagination: { page: 1, pageSize: 100, total: 1 } } };
      }
      throw rejection("Inbound container import rejected; nothing was saved (2 problems): container 1-CA: unknown SKU S1; and 1 more problems");
    });

    const result = await WorkbenchContainerPushService.push();

    expect(result).toMatchObject({
      missingSkus: ["S1", "S3"],
      missingSkuCount: 2,
      missingSkusComplete: true,
      failedContainers: [{ containerNumber: "1-CA", missingSkuCount: 2 }],
    });
  });

  it("says the list is incomplete when the catalogue cannot be read", async () => {
    listContainersMock.mockResolvedValue([row({ container_number: "1-CA" })]);
    workbenchRequestMock.mockImplementation(async (_c, method: string, path: string) => {
      if (path === "/api/v1/warehouses") {
        return { data: warehouses, meta: { pagination: { page: 1, pageSize: 100, total: warehouses.length } } };
      }
      if (path === "/api/v1/master-products") throw new WorkbenchApiError("down", 503);
      throw rejection("Inbound container import rejected; nothing was saved (60 problems): container 1-CA: unknown SKU S1; and 59 more problems");
    });

    const result = await WorkbenchContainerPushService.push();

    expect(result).toMatchObject({ missingSkus: ["S1"], missingSkuCount: 1, missingSkusComplete: false });
  });

  it("stops at the first failure that is not about the containers, such as a rejected key", async () => {
    listContainersMock.mockResolvedValue(
      Array.from({ length: 60 }, (_, index) => row({ container_number: `${index}-CA` })),
    );
    workbenchAnswers(() => new WorkbenchApiError("Workbench POST → 401: Unauthorized", 401));

    const result = await WorkbenchContainerPushService.push();

    expect(importCalls()).toHaveLength(1);
    expect(result).toMatchObject({ status: "failed", sent: 0, failed: 60 });
  });

  it("resends once when a concurrent import created the same container first", async () => {
    listContainersMock.mockResolvedValue([row()]);
    let attempts = 0;
    workbenchAnswers(() => (attempts++ === 0 ? new WorkbenchApiError("conflict", 409) : undefined));

    const result = await WorkbenchContainerPushService.push();

    expect(importCalls()).toHaveLength(2);
    expect(result).toMatchObject({ status: "succeeded", sent: 1 });
  });

  it("fails without throwing when Workbench cannot list its warehouses", async () => {
    listContainersMock.mockResolvedValue([row(), row({ container_number: "2-CA" })]);
    workbenchRequestMock.mockRejectedValue(new WorkbenchApiError("Workbench GET → 404: Not Found", 404));

    const result = await WorkbenchContainerPushService.push();

    expect(result).toMatchObject({ status: "failed", sent: 0, failed: 2, errors: ["Workbench GET → 404: Not Found"] });
  });

  it("matches one warehouse among several of the same name by its ACTIVE status", async () => {
    listContainersMock.mockResolvedValue([row()]);
    workbenchRequestMock.mockImplementation(async (_c, method: string) => {
      if (method === "GET") {
        return {
          data: [
            { id: "old", name: "FULLERTON", status: "INACTIVE" },
            { id: FULLERTON_ID, name: "Fullerton", status: "ACTIVE" },
          ],
          meta: { pagination: { page: 1, pageSize: 100, total: 2 } },
        };
      }
      return { data: { created: 1, updated: 0, unchanged: 0, containers: [] } };
    });

    await WorkbenchContainerPushService.push();

    expect(importCalls()[0][3].body.containers[0].warehouseId).toBe(FULLERTON_ID);
  });
});
