import { spawn, execSync, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";

// Survive Next.js hot-reload by stashing the child on globalThis
const g = globalThis as typeof globalThis & {
  _forecastChild?: ChildProcess | null;
  // One shared start attempt. A planning page fires several requests at once,
  // and without this each would spawn its own uvicorn to fight over port 8000.
  _forecastStarting?: Promise<EnsureResult> | null;
  // Remembers a failed attempt so every subsequent request does not pay the
  // ten-second startup timeout before failing the same way.
  _forecastStartFailedUntil?: number;
  _forecastStartFailure?: EnsureResult | null;
};

function getChild(): ChildProcess | null {
  return g._forecastChild ?? null;
}
function setChild(c: ChildProcess | null) {
  g._forecastChild = c;
}

export async function isRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${forecastApiBase()}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface HealthFile {
  name: string;
  path: string;
  exists: boolean;
  required: boolean;
  produced_by: string;
}

export interface ForecastHealth {
  running: boolean;
  /** True only when the server is up AND has the data it reads. Null when the
   *  server is up but predates the readiness fields in /health. */
  ready: boolean | null;
  missingRequired: string[];
  missingOptional: string[];
  files: HealthFile[];
  /** Where the server says it is reading from. Worth showing: the usual cause
   *  of missing data is a server running against the wrong checkout. */
  repoRoot: string | null;
  url: string;
  /** Whether this app could start the server itself if it is down. */
  local: boolean;
}

/**
 * One call describing everything the UI needs to say about the service.
 *
 * "Running" alone is not a useful signal here, because the failure that
 * actually happens is a server that is up and has no data to serve. That looks
 * healthy to a liveness check and returns 500 on every real request.
 */
export async function forecastHealth(): Promise<ForecastHealth> {
  const base = forecastApiBase();
  const shape = (over: Partial<ForecastHealth>): ForecastHealth => ({
    running: false,
    ready: null,
    missingRequired: [],
    missingOptional: [],
    files: [],
    repoRoot: null,
    url: base,
    local: usesLocalForecastServer(),
    ...over,
  });

  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return shape({ running: false });

    const body = await res.json().catch(() => null);
    if (!body || typeof body !== "object") return shape({ running: true });

    const b = body as Record<string, unknown>;
    return shape({
      running: true,
      // Absent on a server that predates this field, which is itself worth
      // distinguishing from "ready": it means the Python side is outdated.
      ready: typeof b.ready === "boolean" ? b.ready : null,
      missingRequired: Array.isArray(b.missing_required) ? (b.missing_required as string[]) : [],
      missingOptional: Array.isArray(b.missing_optional) ? (b.missing_optional as string[]) : [],
      files: Array.isArray(b.files) ? (b.files as HealthFile[]) : [],
      repoRoot: typeof b.repo_root === "string" ? b.repo_root : null,
    });
  } catch {
    return shape({ running: false });
  }
}

export async function startForecastServer(): Promise<"already_running" | "started"> {
  if (await isRunning()) return "already_running";

  if (!usesLocalForecastServer()) {
    throw new Error(`Forecast service is not reachable at ${forecastApiBase()}`);
  }

  const serverDir = process.env.FORECAST_SERVER_DIR;
  if (!serverDir) throw new Error("FORECAST_SERVER_DIR is not set in .env");
  // Checked before spawning because FORECAST_SERVER_DIR is an absolute path to
  // one developer's checkout. Copied between machines it points at nothing, and
  // spawn with a missing cwd fails asynchronously with stdio ignored, so the
  // symptom is a server that never appears and never says why.
  if (!fs.existsSync(serverDir)) {
    throw new Error(
      `FORECAST_SERVER_DIR points at ${serverDir}, which does not exist on this machine. ` +
        `Set it in .env to your own Time_Series_Forecasting checkout.`,
    );
  }

  const uvicorn = resolveUvicorn(serverDir);
  const appModule = resolveAppModule(serverDir);
  const child = spawn(uvicorn, [appModule, "--host", "0.0.0.0", "--port", "8000"], {
    cwd: serverDir,
    stdio: "ignore",
    detached: false,
  });
  setChild(child);
  child.on("exit", () => setChild(null));
  // Without a listener, a spawn failure raises an unhandled 'error' event on the
  // ChildProcess, which takes down the Next.js process rather than this request.
  child.on("error", () => setChild(null));

  // Poll until ready (up to 10 seconds)
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isRunning()) return "started";
  }
  throw new Error(
    `Forecast server did not come up within 10 seconds. Try starting it by hand in ${serverDir}: ` +
      `.venv/bin/uvicorn ${appModule} --host 0.0.0.0 --port 8000`,
  );
}

export type EnsureResult =
  | { ok: true; state: "already_running" | "started" }
  | { ok: false; reason: "remote" | "not_configured" | "start_failed"; message: string };

const START_FAILURE_COOLDOWN_MS = 30_000;

/**
 * Bring the forecast server up if it is down, for a request that needs it.
 *
 * Unlike `startForecastServer` this never throws and never lets two callers
 * spawn at once, because it runs on the request path where a page issues
 * several fetches in parallel.
 *
 * It only starts a server that is meant to be local. When `AI_SERVICE_URL`
 * points somewhere else, that machine's server is not ours to manage and the
 * honest answer is that it is down.
 */
export async function ensureForecastServer(): Promise<EnsureResult> {
  if (!usesLocalForecastServer()) {
    return {
      ok: false,
      reason: "remote",
      message: `The forecast server at ${forecastApiBase()} is not responding, and it is not a local server this app can start.`,
    };
  }
  // Unset is also how the deployed box opts out. There the service is a systemd
  // unit with Restart=always, and a second supervisor racing it to spawn
  // uvicorn on the same port is worse than an honest outage. So this is not
  // necessarily a misconfiguration, and the message must not assume it is.
  if (!process.env.FORECAST_SERVER_DIR) {
    return {
      ok: false,
      reason: "not_configured",
      message:
        "The forecast server is not answering and this app is not configured to start it. " +
        "On a deployed server that is expected: systemd owns the service, so check " +
        "`systemctl status coverland-forecast-api`. On a development machine, set " +
        "FORECAST_SERVER_DIR in .env to your own Time_Series_Forecasting checkout.",
    };
  }

  const failedUntil = g._forecastStartFailedUntil ?? 0;
  if (Date.now() < failedUntil && g._forecastStartFailure) {
    return g._forecastStartFailure;
  }

  if (g._forecastStarting) return g._forecastStarting;

  g._forecastStarting = (async (): Promise<EnsureResult> => {
    try {
      const state = await startForecastServer();
      g._forecastStartFailedUntil = 0;
      g._forecastStartFailure = null;
      return { ok: true, state };
    } catch (err) {
      const failure: EnsureResult = {
        ok: false,
        reason: "start_failed",
        message: err instanceof Error ? err.message : String(err),
      };
      g._forecastStartFailedUntil = Date.now() + START_FAILURE_COOLDOWN_MS;
      g._forecastStartFailure = failure;
      return failure;
    } finally {
      g._forecastStarting = null;
    }
  })();

  return g._forecastStarting;
}

function forecastApiBase() {
  return (process.env.AI_SERVICE_URL ?? "http://localhost:8000").replace(/\/+$/, "");
}

function usesLocalForecastServer() {
  try {
    const hostname = new URL(forecastApiBase()).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function resolveUvicorn(serverDir: string): string {
  const candidates = [
    path.join(serverDir, ".venv", "bin", "uvicorn"),
    path.join(serverDir, ".venv", "Scripts", "uvicorn.exe"),
    path.join(serverDir, "venv", "bin", "uvicorn"),
    path.join(serverDir, "venv", "Scripts", "uvicorn.exe"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? "uvicorn";
}

function resolveAppModule(serverDir: string): string {
  if (process.env.FORECAST_SERVER_APP) return process.env.FORECAST_SERVER_APP;
  if (fs.existsSync(path.join(serverDir, "api", "main.py"))) return "api.main:app";
  return "main:app";
}

export function stopForecastServer(): void {
  if (!usesLocalForecastServer()) return;

  const child = getChild();
  if (child && !child.killed) {
    child.kill("SIGTERM");
    setChild(null);
    return;
  }
  // Fallback: kill any uvicorn process on port 8000 (handles manually-started server)
  try {
    execSync("lsof -ti:8000 | xargs kill -TERM 2>/dev/null || true", { stdio: "ignore" });
  } catch {
    // ignore
  }
}
