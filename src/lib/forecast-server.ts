import { spawn, execSync, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";

// Survive Next.js hot-reload by stashing the child on globalThis
const g = globalThis as typeof globalThis & {
  _forecastChild?: ChildProcess | null;
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

export async function startForecastServer(): Promise<"already_running" | "started"> {
  if (await isRunning()) return "already_running";

  if (!usesLocalForecastServer()) {
    throw new Error(`Forecast service is not reachable at ${forecastApiBase()}`);
  }

  const serverDir = process.env.FORECAST_SERVER_DIR;
  if (!serverDir) throw new Error("FORECAST_SERVER_DIR is not set in .env");

  const uvicorn = resolveUvicorn(serverDir);
  const appModule = resolveAppModule(serverDir);
  const child = spawn(uvicorn, [appModule, "--host", "0.0.0.0", "--port", "8000"], {
    cwd: serverDir,
    stdio: "ignore",
    detached: false,
  });
  setChild(child);
  child.on("exit", () => setChild(null));

  // Poll until ready (up to 10 seconds)
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isRunning()) return "started";
  }
  throw new Error("Forecast server failed to start within 10 seconds");
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
