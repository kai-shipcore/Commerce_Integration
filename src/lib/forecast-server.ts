import { spawn, execSync, type ChildProcess } from "child_process";
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

async function isRunning(): Promise<boolean> {
  try {
    const res = await fetch("http://localhost:8000/health", {
      signal: AbortSignal.timeout(600),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function startForecastServer(): Promise<"already_running" | "started"> {
  if (await isRunning()) return "already_running";

  const serverDir = process.env.FORECAST_SERVER_DIR;
  if (!serverDir) throw new Error("FORECAST_SERVER_DIR is not set in .env");

  const uvicorn = path.join(serverDir, ".venv", "bin", "uvicorn");
  const child = spawn(uvicorn, ["api.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"], {
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

export function stopForecastServer(): void {
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
