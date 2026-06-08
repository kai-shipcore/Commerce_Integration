import { CacheManager } from "@/lib/redis";
import type { DemandPlanningData } from "@/types/demand-planning";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";

type DashboardCachePayload = {
  success: true;
  data: DemandPlanningData;
};

type CompressedDashboardCachePayload = {
  encoding: "gzip-base64";
  body: string;
};

const DASHBOARD_CACHE_TTL_SECONDS = 5 * 60;
const DASHBOARD_CACHE_TIMEOUT_MS = 500;
const DASHBOARD_CACHE_DECOMPRESS_TIMEOUT_MS = 2_000;
const DASHBOARD_CACHE_PATTERN = "planning:dashboard:*";
const DASHBOARD_CACHE_MAX_COMPRESSED_BYTES = 20 * 1024 * 1024;
const hasRedisEnv = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export function planningDashboardCacheKey(mode: string, includeContainers = false, asOfDate?: string, includeDrafts = false) {
  const dateSuffix = asOfDate ? `:${asOfDate}` : "";
  const scopeSuffix = includeDrafts ? ":drafts" : "";
  return `planning:dashboard:v9:${mode}:${includeContainers ? "detail" : "summary"}${dateSuffix}${scopeSuffix}`;
}

async function withTimeout<T>(work: Promise<T>, fallback: T): Promise<T> {
  return withTimeoutMs(work, fallback, DASHBOARD_CACHE_TIMEOUT_MS);
}

async function withTimeoutMs<T>(work: Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function getPlanningDashboardCache(mode: string, includeContainers = false, asOfDate?: string, includeDrafts = false) {
  if (!hasRedisEnv) return null;
  const cached = await withTimeout(
    CacheManager.get<DashboardCachePayload | CompressedDashboardCachePayload | string>(
      planningDashboardCacheKey(mode, includeContainers, asOfDate, includeDrafts),
    ),
    null,
  );

  if (!cached) return null;
  const parsed = typeof cached === "string"
    ? (() => {
        try {
          return JSON.parse(cached) as DashboardCachePayload | CompressedDashboardCachePayload;
        } catch {
          return null;
        }
      })()
    : cached;

  if (!parsed) return null;
  if ("encoding" in parsed && parsed.encoding === "gzip-base64") {
    try {
      const buffer = Buffer.from(parsed.body, "base64");
      const json = await withTimeoutMs(gunzipAsync(buffer), null, DASHBOARD_CACHE_DECOMPRESS_TIMEOUT_MS);
      if (!json) return null;
      return JSON.parse(json.toString("utf8")) as DashboardCachePayload;
    } catch {
      return null;
    }
  }
  return parsed;
}

export function setPlanningDashboardCache(mode: string, payload: DashboardCachePayload, includeContainers = false, asOfDate?: string, includeDrafts = false) {
  if (!hasRedisEnv) return;
  setTimeout(() => void (async () => {
    try {
      const compressed = await gzipAsync(JSON.stringify(payload));
      if (compressed.byteLength > DASHBOARD_CACHE_MAX_COMPRESSED_BYTES) return;
      const cachePayload: CompressedDashboardCachePayload = {
        encoding: "gzip-base64",
        body: compressed.toString("base64"),
      };
      void withTimeout(
      CacheManager.set(planningDashboardCacheKey(mode, includeContainers, asOfDate, includeDrafts), cachePayload, DASHBOARD_CACHE_TTL_SECONDS),
      false,
    );
    } catch {
      // Cache failures should never affect the dashboard response.
    }
  })(), 0);
}

export async function invalidatePlanningDashboardCache() {
  if (!hasRedisEnv) return;
  await withTimeout(CacheManager.deletePattern(DASHBOARD_CACHE_PATTERN), 0);
}
