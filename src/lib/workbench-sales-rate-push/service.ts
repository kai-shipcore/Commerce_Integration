// Pushes each active master SKU's daily sales rate to Workbench's sales-rate
// import (POST /api/v1/master-product-sales-rates/import) at the end of the
// planning Sync job. Workbench stores one figure per master product for the
// pre-order team to read; it neither computes nor checks it.
//
// The figure is the dashboard's T.Avg current: the value the order calculation
// reads, with a manual override, the Min Sales floor and reference sales
// applied. It is read through the dashboard's own service so the two cannot
// drift apart.
//
// Workbench replaces the rate of every product sent and leaves the others as
// they were, so sending every SKU on every Sync is safe. One request saves
// entirely or not at all: a SKU Workbench does not have, or has only as a
// draft, rejects the whole request, so those SKUs are taken out and the rest
// is sent again.
//
// This never throws: a Workbench outage must not fail DP's own stats refresh.

import { DemandPlanningService } from "@/lib/demand-planning/service";
import {
  WorkbenchApiError,
  workbenchConfig,
  workbenchRequest,
  workbenchTarget,
  type WorkbenchConfig,
} from "@/lib/workbench/client";
import { loadCatalogueSkus } from "@/lib/workbench-container-push/service";

// Workbench's own bounds.
const MAX_PRODUCTS_PER_REQUEST = 1_000;
const MAX_DAILY_AVERAGE_QUANTITY = 99_999_999.9999;
// Workbench lists at most 50 problems per rejection, so a request of 1,000
// unknown SKUs needs 20 rounds to empty; one more round sends what is left.
const MAX_ATTEMPTS_PER_REQUEST = 21;
const MAX_RECORDED_ERRORS = 20;
const MAX_ERROR_LENGTH = 500;
// Kept bounded so one job row stays small; the counts beside them stay exact.
const MAX_RECORDED_SKUS = 500;

export type WorkbenchSalesRate = { sku: string; dailyAverageQuantity: number };

type ImportResponse = { received: number; changed: number };

export type WorkbenchSalesRatePushResult =
  | { status: "skipped"; reason: string }
  | {
      /** succeeded: every rate Workbench could take was saved. partial: some requests failed. failed: none were saved. */
      status: "succeeded" | "partial" | "failed";
      /** Workbench host the push went to. */
      target: string;
      /** Active SKUs with a rate to send. */
      considered: number;
      /** Rates Workbench accepted. */
      sent: number;
      /** Of those, the rates that were new or different in Workbench. */
      changed: number;
      /** SKUs Workbench has no master product for; not sent. */
      unknownSkuCount: number;
      /** SKUs whose Workbench master product is still a draft; not sent. */
      draftSkuCount: number;
      /** The first of both, sorted (at most 500). */
      notSentSkus: string[];
      /** Rates in requests that failed for another reason. */
      failed: number;
      /** Failures not about a SKU: auth, a missing route, an outage. */
      errors: string[];
      durationMs: number;
    };

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}

/**
 * One rate per SKU, as Workbench takes it: SKUs matched without regard to case
 * (a repeat rejects the request), the figure from 0 to Workbench's maximum,
 * rounded to the four places it stores.
 */
export function prepareSalesRates(
  rows: readonly { sku: string | null | undefined; total_avg_curr: number | null | undefined }[],
): WorkbenchSalesRate[] {
  const bySku = new Map<string, WorkbenchSalesRate>();
  for (const row of rows) {
    const sku = row.sku?.trim();
    const value = Number(row.total_avg_curr);
    if (!sku || row.total_avg_curr == null || !Number.isFinite(value) || value < 0) continue;
    const key = sku.toLowerCase();
    if (bySku.has(key)) continue;
    const rounded = Math.round(Math.min(value, MAX_DAILY_AVERAGE_QUANTITY) * 10_000) / 10_000;
    bySku.set(key, { sku, dailyAverageQuantity: rounded });
  }
  return [...bySku.values()];
}

/**
 * The SKUs a 422 names as ones Workbench cannot take. Workbench words it as
 * "... (N problems): unknown SKU X; SKU Y is a draft product; activate it
 * first; ...; and M more problems", listing at most 50; `truncated` says the
 * list is not all of them.
 */
export function parseSalesRateRejection(
  message: string,
): { unknown: string[]; draft: string[]; other: string[]; truncated: boolean } | null {
  const match = /\((\d+) problems?\): ([\s\S]*)$/.exec(message);
  if (!match) return null;
  const total = Number(match[1]);
  let body = match[2];
  const more = /;? and \d+ more problems?$/.exec(body);
  if (more) body = body.slice(0, more.index);
  // The draft problem carries a "; " of its own, which is not a separator.
  const entries = body
    .replaceAll(" is a draft product; activate it first", " is a draft product")
    .split("; ")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const unknown: string[] = [];
  const draft: string[] = [];
  const other: string[] = [];
  for (const entry of entries) {
    const unknownSku = /^unknown SKU (.+)$/.exec(entry)?.[1]?.trim();
    const draftSku = /^SKU (.+) is a draft product$/.exec(entry)?.[1]?.trim();
    if (unknownSku) unknown.push(unknownSku);
    else if (draftSku) draft.push(draftSku);
    else other.push(entry);
  }
  return { unknown, draft, other, truncated: entries.length < total };
}

export function chunkSalesRates(rates: readonly WorkbenchSalesRate[]): WorkbenchSalesRate[][] {
  const chunks: WorkbenchSalesRate[][] = [];
  for (let start = 0; start < rates.length; start += MAX_PRODUCTS_PER_REQUEST) {
    chunks.push(rates.slice(start, start + MAX_PRODUCTS_PER_REQUEST));
  }
  return chunks;
}

function importRates(config: WorkbenchConfig, products: WorkbenchSalesRate[], requestId: string | null) {
  return workbenchRequest<ImportResponse>(config, "POST", "/api/v1/master-product-sales-rates/import", {
    body: { products },
    requestId,
  });
}

/** One retry on 409: a concurrent import wrote the same products, and resending is the documented fix. */
async function importWithRetry(config: WorkbenchConfig, products: WorkbenchSalesRate[], requestId: string | null) {
  try {
    return await importRates(config, products, requestId);
  } catch (error) {
    if (error instanceof WorkbenchApiError && error.status === 409) {
      return importRates(config, products, requestId);
    }
    throw error;
  }
}

/**
 * The dashboard's T.Avg current for every active SKU, on Custom sales: the
 * source the dashboard opens on. It read Link until 2026-11-23, so a Seat Cover
 * was sent at a rate the page did not show (CA-SC-10-F-10-BK-1TO: 20.78 sent,
 * 20.50 on screen).
 */
async function readSalesRates(salesWindowWeights: unknown): Promise<WorkbenchSalesRate[]> {
  const { data } = await DemandPlanningService.getDashboardData({
    mode: "custom",
    includeContainers: false,
    rawContainers: false,
    includeDrafts: false,
    categoryCodes: null,
    asOf: null,
    salesWeightsParam: salesWindowWeights == null ? null : JSON.stringify(salesWindowWeights),
  });
  return prepareSalesRates(data.rows);
}

export const WorkbenchSalesRatePushService = {
  /**
   * @param salesWindowWeights The Sync's own weights, so the rates match the
   *   dashboard the person who clicked Sync is looking at.
   */
  async push(options: { requestId?: string | null; salesWindowWeights?: unknown } = {}): Promise<WorkbenchSalesRatePushResult> {
    const config = workbenchConfig();
    if (!config) return { status: "skipped", reason: "WORKBENCH_API_URL or WORKBENCH_API_KEY is not set" };

    const startedAt = Date.now();
    const requestId = options.requestId ?? null;
    const errors: string[] = [];
    const recordError = (text: string) => {
      if (errors.length < MAX_RECORDED_ERRORS) errors.push(text);
    };
    const unknown = new Set<string>();
    const draft = new Set<string>();
    let considered = 0;
    let sent = 0;
    let changed = 0;
    let failed = 0;

    const finish = (): WorkbenchSalesRatePushResult => ({
      status: failed === 0 && errors.length === 0 ? "succeeded" : sent > 0 ? "partial" : "failed",
      target: workbenchTarget(config),
      considered,
      sent,
      changed,
      unknownSkuCount: unknown.size,
      draftSkuCount: draft.size,
      notSentSkus: [...unknown, ...draft].sort().slice(0, MAX_RECORDED_SKUS),
      failed,
      errors,
      durationMs: Date.now() - startedAt,
    });

    let rates: WorkbenchSalesRate[];
    try {
      rates = await readSalesRates(options.salesWindowWeights);
    } catch (error) {
      recordError(`Could not read the sales rates: ${errorText(error)}`);
      return finish();
    }
    considered = rates.length;

    // Read only when a rejection was cut short: then Workbench lacks more SKUs
    // than it lists, and asking it 50 at a time would take a request per 50.
    let catalogue: Set<string> | null = null;
    let catalogueRead = false;
    const withoutUnknown = (products: WorkbenchSalesRate[]): WorkbenchSalesRate[] => {
      if (!catalogue) return products;
      const known = catalogue;
      return products.filter((product) => {
        if (known.has(product.sku.toLowerCase())) return true;
        unknown.add(product.sku);
        return false;
      });
    };

    const chunks = chunkSalesRates(rates);
    for (const [index, chunk] of chunks.entries()) {
      let products = withoutUnknown(chunk);
      let saved = false;
      for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_REQUEST && products.length > 0 && !saved; attempt += 1) {
        try {
          const { data } = await importWithRetry(config, products, requestId);
          sent += data.received;
          changed += data.changed;
          saved = true;
        } catch (error) {
          const rejection = error instanceof WorkbenchApiError && error.status === 422 && error.apiMessage
            ? parseSalesRateRejection(error.apiMessage)
            : null;
          if (!(error instanceof WorkbenchApiError) || error.status !== 422) {
            // Auth, a missing route or an outage would fail every request.
            recordError(errorText(error));
            failed += products.length + chunks.slice(index + 1).reduce((sum, rest) => sum + rest.length, 0);
            return finish();
          }
          const rejected = new Set([...(rejection?.unknown ?? []), ...(rejection?.draft ?? [])].map((sku) => sku.toLowerCase()));
          if (!rejection || rejected.size === 0) {
            // Nothing this push can take out and send again.
            recordError(errorText(error));
            break;
          }
          for (const sku of rejection.unknown) unknown.add(sku);
          for (const sku of rejection.draft) draft.add(sku);
          products = products.filter((product) => !rejected.has(product.sku.toLowerCase()));
          if (rejection.truncated && !catalogueRead) {
            catalogueRead = true;
            catalogue = await loadCatalogueSkus(config, requestId).catch(() => null);
            products = withoutUnknown(products);
          }
        }
      }
      if (!saved) failed += products.length;
    }

    return finish();
  },
};
