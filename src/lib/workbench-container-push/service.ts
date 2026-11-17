// Pushes DP's containers to Workbench's inbound-container import
// (POST /api/v1/inbound-containers/import) as part of the planning Sync job.
//
// Workbench treats each sent container as the sender's complete current state,
// matched by containerNumber: unknown numbers are created, known ones replaced
// (status, destination, both ETAs, item list). Repeating an unchanged state
// changes nothing, so sending everything on every Sync is safe. Containers not
// sent are left as Workbench stored them — a container deleted in DP stays in
// Workbench. Received quantities are Workbench's own and never sent.
//
// One request saves entirely or not at all (422 lists every problem), so a
// rejected batch is retried container by container to keep one bad container
// from blocking the rest.
//
// This never throws: a Workbench outage must not fail DP's own stats refresh.

import {
  WorkbenchApiError,
  workbenchConfig,
  workbenchRequest,
  workbenchTarget,
  type WorkbenchConfig,
} from "@/lib/workbench/client";
import {
  WorkbenchContainerPushRepository,
  type PushableContainerRow,
} from "@/lib/workbench-container-push/repository";

/**
 * DP status → Workbench status. A DP status missing here is not sent.
 * Decided 2026-11-16: draft is a plan, not a movement, so it stays in DP.
 * packing_received ("Final" / 최종) is an order whose list is final but which
 * may not be loaded yet; Workbench has no earlier state than CARGO_LOADED.
 */
export const WORKBENCH_STATUS_BY_DP_STATUS = {
  packing_received: "CARGO_LOADED",
  shipped: "IN_TRANSIT",
  complete: "DELIVERED",
} as const;

type WorkbenchStatus = (typeof WORKBENCH_STATUS_BY_DP_STATUS)[keyof typeof WORKBENCH_STATUS_BY_DP_STATUS];

/**
 * The port is always LA / Long Beach (`eta_lax_lgb_date`), which does not say
 * which of the two, so no UN/LOCODE is sent.
 */
const PORT_TIME_ZONE = "America/Los_Angeles";
const PORT_NAME = "Los Angeles / Long Beach";
/**
 * The warehouse arrival uses the destination's own fc_warehouses.timezone:
 * not every destination is in California (TTM is in Jackson, Mississippi,
 * America/Chicago). LA only when DP has no timezone for the code.
 */
const FALLBACK_WAREHOUSE_TIME_ZONE = "America/Los_Angeles";

// Workbench's own bounds are 50 containers and 500 items per container. The
// per-request item cap is ours: it keeps one request well inside Workbench's
// 20-second transaction and 4 MB body limit.
const MAX_CONTAINERS_PER_REQUEST = 50;
const MAX_ITEMS_PER_CONTAINER = 500;
const MAX_ITEMS_PER_REQUEST = 5_000;
const MAX_RECORDED_ERRORS = 20;
const MAX_ERROR_LENGTH = 500;
const WAREHOUSE_PAGE_SIZE = 100;
// Kept bounded so one job row stays small; the counts beside them stay exact.
const MAX_RECORDED_MISSING_SKUS = 3_000;
const MAX_RECORDED_FAILED_CONTAINERS = 500;
const MAX_PROBLEMS_PER_CONTAINER = 5;
// Reading Workbench's whole catalogue only happens when a rejection was cut short.
const CATALOGUE_PAGE_SIZE = 100;
const MAX_CATALOGUE_PAGES = 300;

export type WorkbenchImportContainer = {
  containerNumber: string;
  status: WorkbenchStatus;
  warehouseId: string;
  portArrival: {
    estimatedDate: string | null;
    timeZone: string;
    portLocationCode: string | null;
    portName: string | null;
  };
  warehouseArrival: { estimatedDate: string | null; timeZone: string };
  items: { sku: string; loadedQuantity: number }[];
};

type ImportResponse = {
  created: number;
  updated: number;
  unchanged: number;
  containers: { containerNumber: string; inboundContainerId: string; result: string }[];
};

type WorkbenchWarehouse = { id: string; name: string; status: "ACTIVE" | "INACTIVE" };

export type WorkbenchContainerPushResult =
  | { status: "skipped"; reason: string }
  | {
      /** succeeded: nothing failed. partial: some containers failed. failed: none were saved. */
      status: "succeeded" | "partial" | "failed";
      /** Workbench host the push went to. */
      target: string;
      /** DP containers in a sendable status. */
      considered: number;
      /** Containers Workbench accepted: created + updated + unchanged. */
      sent: number;
      created: number;
      updated: number;
      unchanged: number;
      /** Containers Workbench rejected or never received. */
      failed: number;
      /** Containers DP could not send, by reason. */
      skipped: number;
      skipReasons: Record<string, number>;
      /**
       * SKUs that some failed container carries and Workbench has no master
       * product for, sorted, at most 3,000; `missingSkuCount` is the full count.
       * Absent on jobs recorded before 2026-11-17.
       */
      missingSkus?: string[];
      missingSkuCount?: number;
      /** false when Workbench cut a list short and its catalogue could not be read to finish it. */
      missingSkusComplete?: boolean;
      /** Why each rejected container failed (at most 500). */
      failedContainers?: WorkbenchFailedContainer[];
      /** Failures not about one container: auth, a missing route, an outage. */
      errors: string[];
      durationMs: number;
    };

export type WorkbenchFailedContainer = {
  containerNumber: string;
  /** Its SKUs Workbench does not know. */
  missingSkuCount: number;
  /** Its other problems, as Workbench words them (at most 5). */
  problems: string[];
};

type ParsedProblem = { containerNumber: string | null; text: string; unknownSku: string | null };

/**
 * Reads the problems out of a 422 import rejection. Workbench words it as
 * "... (N problems): container X: unknown SKU Y; container X: ...; and M more
 * problems", listing at most 50; `truncated` says the list is not all of them.
 */
export function parseImportRejection(
  message: string,
): { total: number; problems: ParsedProblem[]; truncated: boolean } | null {
  const match = /\((\d+) problems?\): ([\s\S]*)$/.exec(message);
  if (!match) return null;
  const total = Number(match[1]);
  let body = match[2];
  const more = /;? and \d+ more problems?$/.exec(body);
  if (more) body = body.slice(0, more.index);
  const problems = body
    .split("; ")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const located = /^container (.+?): ([\s\S]+)$/.exec(entry);
      const text = located ? located[2] : entry;
      const unknownSku = /^unknown SKU (.+)$/.exec(text)?.[1]?.trim() ?? null;
      return { containerNumber: located ? located[1] : null, text, unknownSku };
    });
  return { total, problems, truncated: problems.length < total };
}

type PrepareOutcome =
  | { kind: "ready"; container: WorkbenchImportContainer }
  | { kind: "skip"; reason: string };

/** Case, spacing, and punctuation do not distinguish warehouse names ("LINK ONE" = "Link-One"). */
export function warehouseNameKey(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** One import item per SKU: Workbench matches SKUs without regard to case and rejects repeats. */
function importItems(items: PushableContainerRow["items"]): WorkbenchImportContainer["items"] {
  const bySku = new Map<string, { sku: string; loadedQuantity: number }>();
  for (const item of items) {
    const sku = item.sku?.trim();
    if (!sku || !Number.isInteger(item.qty) || item.qty <= 0) continue;
    const key = sku.toLowerCase();
    const existing = bySku.get(key);
    if (existing) existing.loadedQuantity += item.qty;
    else bySku.set(key, { sku, loadedQuantity: item.qty });
  }
  return [...bySku.values()];
}

export function prepareContainer(
  row: PushableContainerRow,
  warehouseIds: ReadonlyMap<string, string>,
): PrepareOutcome {
  const status = WORKBENCH_STATUS_BY_DP_STATUS[row.status as keyof typeof WORKBENCH_STATUS_BY_DP_STATUS];
  if (!status) return { kind: "skip", reason: `status ${row.status} is not sent` };

  const destination = row.dest_warehouse?.trim();
  if (!destination) return { kind: "skip", reason: "no destination warehouse" };
  // A Workbench warehouse may be named after DP's code (TTM) or DP's display
  // name for it (TTM Group (East)); either one identifies it.
  const warehouseId = [destination, row.dest_warehouse_name]
    .filter((name): name is string => Boolean(name?.trim()))
    .map((name) => warehouseIds.get(warehouseNameKey(name)))
    .find((id): id is string => Boolean(id));
  if (!warehouseId) return { kind: "skip", reason: `warehouse ${destination} not found in Workbench` };

  const items = importItems(row.items ?? []);
  if (items.length > MAX_ITEMS_PER_CONTAINER) {
    return { kind: "skip", reason: `more than ${MAX_ITEMS_PER_CONTAINER} SKUs in one container` };
  }

  return {
    kind: "ready",
    container: {
      containerNumber: row.container_number,
      status,
      warehouseId,
      portArrival: {
        estimatedDate: row.eta_lax_lgb_date,
        timeZone: PORT_TIME_ZONE,
        portLocationCode: null,
        portName: row.eta_lax_lgb_date ? PORT_NAME : null,
      },
      warehouseArrival: {
        estimatedDate: row.eta_date,
        timeZone: row.dest_timezone?.trim() || FALLBACK_WAREHOUSE_TIME_ZONE,
      },
      items,
    },
  };
}

/** Splits into requests of at most 50 containers and 5,000 items. */
export function chunkContainers(containers: WorkbenchImportContainer[]): WorkbenchImportContainer[][] {
  const chunks: WorkbenchImportContainer[][] = [];
  let current: WorkbenchImportContainer[] = [];
  let currentItems = 0;
  for (const container of containers) {
    const items = container.items.length;
    if (current.length > 0 && (current.length >= MAX_CONTAINERS_PER_REQUEST || currentItems + items > MAX_ITEMS_PER_REQUEST)) {
      chunks.push(current);
      current = [];
      currentItems = 0;
    }
    current.push(container);
    currentItems += items;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Workbench warehouse id by name key. A name shared by several warehouses
 * resolves to the single ACTIVE one, or to none when that is still ambiguous.
 */
async function loadWarehouseIds(config: WorkbenchConfig, requestId: string | null): Promise<Map<string, string>> {
  const byKey = new Map<string, WorkbenchWarehouse[]>();
  for (let page = 1; ; page += 1) {
    const { data, meta } = await workbenchRequest<WorkbenchWarehouse[]>(config, "GET", "/api/v1/warehouses", {
      query: { page, pageSize: WAREHOUSE_PAGE_SIZE },
      requestId,
    });
    for (const warehouse of data) {
      const key = warehouseNameKey(warehouse.name);
      byKey.set(key, [...(byKey.get(key) ?? []), warehouse]);
    }
    const total = (meta as { pagination?: { total?: number } } | undefined)?.pagination?.total ?? 0;
    if (data.length < WAREHOUSE_PAGE_SIZE || page * WAREHOUSE_PAGE_SIZE >= total) break;
  }

  const ids = new Map<string, string>();
  for (const [key, warehouses] of byKey) {
    const candidates = warehouses.length === 1 ? warehouses : warehouses.filter((w) => w.status === "ACTIVE");
    if (candidates.length === 1) ids.set(key, candidates[0].id);
  }
  return ids;
}

function importChunk(config: WorkbenchConfig, containers: WorkbenchImportContainer[], requestId: string | null) {
  return workbenchRequest<ImportResponse>(config, "POST", "/api/v1/inbound-containers/import", {
    body: { containers },
    requestId,
  });
}

/** One retry on 409: a concurrent import created the same number first, and resending is the documented fix. */
async function importWithRetry(config: WorkbenchConfig, containers: WorkbenchImportContainer[], requestId: string | null) {
  try {
    return await importChunk(config, containers, requestId);
  } catch (error) {
    if (error instanceof WorkbenchApiError && error.status === 409) {
      return importChunk(config, containers, requestId);
    }
    throw error;
  }
}

/** 422 is about the containers sent; anything else (auth, missing route, outage) would fail every request. */
function isRejectedBatch(error: unknown): boolean {
  return error instanceof WorkbenchApiError && error.status === 422;
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}…` : message;
}

/**
 * Every master product SKU Workbench has, lowercased; null when the catalogue
 * is larger than we are willing to page through.
 */
async function loadCatalogueSkus(config: WorkbenchConfig, requestId: string | null): Promise<Set<string> | null> {
  const skus = new Set<string>();
  for (let page = 1; page <= MAX_CATALOGUE_PAGES; page += 1) {
    const { data, meta } = await workbenchRequest<{ sku: string }[]>(config, "GET", "/api/v1/master-products", {
      query: { page, pageSize: CATALOGUE_PAGE_SIZE },
      requestId,
    });
    for (const product of data) skus.add(product.sku.toLowerCase());
    const total = (meta as { pagination?: { total?: number } } | undefined)?.pagination?.total ?? 0;
    if (data.length < CATALOGUE_PAGE_SIZE || page * CATALOGUE_PAGE_SIZE >= total) return skus;
  }
  return null;
}

/** Collects why containers failed: the SKUs Workbench lacks, and everything else it said. */
function createFailureLog() {
  const missing = new Map<string, string>();
  const failedContainers: WorkbenchFailedContainer[] = [];
  const cutShort: { container: WorkbenchImportContainer; entry: WorkbenchFailedContainer }[] = [];
  let complete = true;

  const addMissing = (sku: string) => {
    const key = sku.toLowerCase();
    if (!missing.has(key)) missing.set(key, sku);
  };

  return {
    /** One container's rejection. A 422 is read problem by problem; anything else is kept as its text. */
    reject(container: WorkbenchImportContainer, error: unknown): void {
      const parsed = error instanceof WorkbenchApiError && error.status === 422 && error.apiMessage
        ? parseImportRejection(error.apiMessage)
        : null;
      const entry: WorkbenchFailedContainer = { containerNumber: container.containerNumber, missingSkuCount: 0, problems: [] };
      if (!parsed) {
        entry.problems.push(errorText(error));
      } else {
        for (const problem of parsed.problems) {
          if (problem.unknownSku) {
            addMissing(problem.unknownSku);
            entry.missingSkuCount += 1;
          } else if (entry.problems.length < MAX_PROBLEMS_PER_CONTAINER) {
            entry.problems.push(problem.text);
          }
        }
        if (parsed.truncated) cutShort.push({ container, entry });
      }
      if (failedContainers.length < MAX_RECORDED_FAILED_CONTAINERS) failedContainers.push(entry);
    },

    /**
     * Workbench lists at most 50 problems per rejection, so a container
     * missing more SKUs than that is finished from Workbench's catalogue.
     */
    async completeFrom(read: () => Promise<Set<string> | null>): Promise<void> {
      if (cutShort.length === 0) return;
      try {
        const catalogue = await read();
        if (!catalogue) {
          complete = false;
          return;
        }
        for (const { container, entry } of cutShort) {
          const absent = container.items.filter((item) => !catalogue.has(item.sku.toLowerCase()));
          absent.forEach((item) => addMissing(item.sku));
          entry.missingSkuCount = absent.length;
        }
      } catch {
        complete = false;
      }
    },

    summary() {
      const sorted = [...missing.values()].sort((a, b) => a.localeCompare(b));
      return {
        missingSkus: sorted.slice(0, MAX_RECORDED_MISSING_SKUS),
        missingSkuCount: sorted.length,
        missingSkusComplete: complete,
        failedContainers,
      };
    },
  };
}

export const WorkbenchContainerPushService = {
  async push(options: { requestId?: string | null } = {}): Promise<WorkbenchContainerPushResult> {
    const config = workbenchConfig();
    if (!config) return { status: "skipped", reason: "WORKBENCH_API_URL or WORKBENCH_API_KEY is not set" };

    const startedAt = Date.now();
    const requestId = options.requestId ?? null;
    const outcome = {
      target: workbenchTarget(config),
      considered: 0,
      sent: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
      skipped: 0,
      skipReasons: {} as Record<string, number>,
      errors: [] as string[],
    };
    const recordError = (message: string) => {
      if (outcome.errors.length < MAX_RECORDED_ERRORS) outcome.errors.push(message);
    };
    const failures = createFailureLog();
    const finish = async (forced?: "failed"): Promise<WorkbenchContainerPushResult> => {
      await failures.completeFrom(() => loadCatalogueSkus(config, requestId));
      return {
        status: forced ?? (outcome.failed === 0 ? "succeeded" : outcome.sent > 0 ? "partial" : "failed"),
        ...outcome,
        ...failures.summary(),
        durationMs: Date.now() - startedAt,
      };
    };

    try {
      const rows = await WorkbenchContainerPushRepository.listContainers(Object.keys(WORKBENCH_STATUS_BY_DP_STATUS));
      outcome.considered = rows.length;
      if (rows.length === 0) return finish();

      const warehouseIds = await loadWarehouseIds(config, requestId);
      const ready: WorkbenchImportContainer[] = [];
      for (const row of rows) {
        const prepared = prepareContainer(row, warehouseIds);
        if (prepared.kind === "ready") {
          ready.push(prepared.container);
        } else {
          outcome.skipped += 1;
          outcome.skipReasons[prepared.reason] = (outcome.skipReasons[prepared.reason] ?? 0) + 1;
        }
      }

      const accept = ({ data }: { data: ImportResponse }) => {
        outcome.created += data.created;
        outcome.updated += data.updated;
        outcome.unchanged += data.unchanged;
        outcome.sent += data.created + data.updated + data.unchanged;
      };

      const chunks = chunkContainers(ready);
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        // Containers in this chunk from `from` on, plus every later chunk.
        const unsentFrom = (from: number) =>
          chunk.length - from + chunks.slice(index + 1).reduce((sum, rest) => sum + rest.length, 0);

        try {
          accept(await importWithRetry(config, chunk, requestId));
          continue;
        } catch (error) {
          if (!isRejectedBatch(error)) {
            // Not about these containers (auth, missing route, outage): stop
            // rather than repeat the same failure for every request.
            recordError(errorText(error));
            outcome.failed += unsentFrom(0);
            return finish();
          }
          if (chunk.length === 1) {
            failures.reject(chunk[0], error);
            outcome.failed += 1;
            continue;
          }
        }

        // The batch was rejected as a whole: resend one by one so the
        // containers at fault fail alone and the rest are saved.
        for (let position = 0; position < chunk.length; position += 1) {
          try {
            accept(await importWithRetry(config, [chunk[position]], requestId));
          } catch (error) {
            if (!isRejectedBatch(error)) {
              recordError(errorText(error));
              outcome.failed += unsentFrom(position);
              return finish();
            }
            failures.reject(chunk[position], error);
            outcome.failed += 1;
          }
        }
      }
      return finish();
    } catch (error) {
      // Reading DP's containers or Workbench's warehouses failed: nothing was sent.
      outcome.failed = Math.max(0, outcome.considered - outcome.skipped);
      recordError(errorText(error));
      return finish("failed");
    }
  },
};
