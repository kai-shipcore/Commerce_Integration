/**
 * Business logic + process orchestration for the Container Import feature:
 * spawns `scripts/import-containers-from-sheet.ts` (a standalone CLI tool —
 * intentionally left as-is, not folded into a repository, since it's a
 * separate process, not code this module calls into directly) and fans its
 * stdout/stderr out to SSE subscribers.
 *
 * No repository module exists for this domain: the only DB write from web
 * app code is the completion audit-log entry below; the actual
 * fc_containers/fc_container_items/fc_products upserts happen inside the
 * spawned script's own connection, outside this process's request lifecycle.
 *
 * The activeRun singleton (single-process deployments only) and its log
 * buffer/subscriber-fanout live here instead of in the route module, but the
 * behavior is unchanged from the original route-level implementation.
 */

import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import { logAudit } from "@/lib/audit";

export type LogEntry = { line: string; isError?: boolean };
export type RunPayload = LogEntry | { done: true; exitCode: number; cancelled?: boolean };

interface ActiveRun {
  startedAt: string;
  url: string;
  dryRun: boolean;
  log: RunPayload[];
  done: boolean;
  cancelled: boolean;
  exitCode: number | null;
  child: ChildProcess | null;
  subscribers: Set<(ev: RunPayload) => void>;
}

export interface RunStatusSnapshot {
  status: "idle" | "running" | "done" | "cancelled";
  startedAt?: string;
  url?: string;
  dryRun?: boolean;
  exitCode?: number | null;
  log?: RunPayload[];
}

export interface StartRunInput {
  url: string;
  tab?: string;
  dryRun: boolean;
  forceDownload: boolean;
}

export type StartRunResult =
  | { conflict: true; startedAt: string }
  | { conflict: false; stream: ReadableStream };

type Who = { userId: string | null; userName: string | null; userEmail: string | null };

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

let activeRun: ActiveRun | null = null;

function emit(run: ActiveRun, payload: RunPayload) {
  run.log.push(payload);
  for (const sub of run.subscribers) {
    try { sub(payload); } catch { /* subscriber already gone */ }
  }
  if ("done" in payload) {
    run.done = true;
    run.exitCode = payload.exitCode;
    run.subscribers.clear();
  }
}

function makeSseStream(run: ActiveRun): ReadableStream {
  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  return new ReadableStream({
    start(controller) {
      const send = (payload: RunPayload) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          if ("done" in payload) { cleanup?.(); controller.close(); }
        } catch { cleanup?.(); }
      };

      // Replay buffered log first
      for (const entry of run.log) {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`)); }
        catch { return; }
      }

      if (run.done) { controller.close(); return; }

      run.subscribers.add(send);
      cleanup = () => run.subscribers.delete(send);
    },
    cancel() { cleanup?.(); },
  });
}

function startImportJob(run: ActiveRun, tab: string | undefined, forceDownload: boolean, who: Who) {
  // Spawn the current Node binary with the local tsx CLI directly — spawning
  // "npx" fails with ENOENT on Windows (it's npx.cmd there) and on any machine
  // where the server process's PATH lacks npm's bin dir.
  const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const args = [tsxCli, "scripts/import-containers-from-sheet.ts", run.url];
  if (tab?.trim()) args.push("--tab", tab.trim());
  if (run.dryRun) args.push("--dry-run");
  if (forceDownload) args.push("--force-download");

  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env as NodeJS.ProcessEnv,
    shell: false,
  });
  run.child = child;

  function sendLine(text: string, isError = false) {
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      emit(run, { line: isError ? `[stderr] ${line}` : line, ...(isError ? { isError: true } : {}) });
    }
  }

  child.stdout.on("data", (chunk: Buffer) => sendLine(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => sendLine(chunk.toString(), true));

  child.on("error", (err) => {
    emit(run, { line: `[error] ${err.message}`, isError: true });
    emit(run, { done: true, exitCode: 1 });
    void logAudit({
      entityType: "container_import",
      entityId: run.startedAt,
      entityLabel: run.url,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "create",
      after: { tab, dryRun: run.dryRun, forceDownload, exitCode: 1, cancelled: false, error: err.message },
    });
  });

  child.on("close", (code) => {
    if (run.cancelled) return;
    emit(run, { done: true, exitCode: code ?? 1 });
    void logAudit({
      entityType: "container_import",
      entityId: run.startedAt,
      entityLabel: run.url,
      userId: who.userId,
      userName: who.userName,
      userEmail: who.userEmail,
      action: "create",
      after: { tab, dryRun: run.dryRun, forceDownload, exitCode: code ?? 1, cancelled: false },
    });
  });
}

export const ContainerImportService = {
  getStatus(): RunStatusSnapshot {
    if (!activeRun) return { status: "idle" };
    return {
      status: activeRun.done ? (activeRun.cancelled ? "cancelled" : "done") : "running",
      startedAt: activeRun.startedAt,
      url: activeRun.url,
      dryRun: activeRun.dryRun,
      exitCode: activeRun.exitCode,
      log: activeRun.log,
    };
  },

  subscribeStream(): ReadableStream {
    if (!activeRun) {
      const encoder = new TextEncoder();
      return new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, exitCode: 0 })}\n\n`));
          controller.close();
        },
      });
    }
    return makeSseStream(activeRun);
  },

  startRun(input: StartRunInput, who: Who): StartRunResult {
    if (activeRun && !activeRun.done) {
      return { conflict: true, startedAt: activeRun.startedAt };
    }

    const run: ActiveRun = {
      startedAt: new Date().toISOString(),
      url: input.url,
      dryRun: input.dryRun,
      log: [],
      done: false,
      cancelled: false,
      exitCode: null,
      child: null,
      subscribers: new Set(),
    };
    activeRun = run;

    startImportJob(run, input.tab, input.forceDownload, who);

    // Return SSE stream with sync start (no async — more reliable for Next.js streaming)
    const encoder = new TextEncoder();
    let cleanup: (() => void) | null = null;

    const stream = new ReadableStream({
      start(controller) {
        const send = (payload: RunPayload) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            if ("done" in payload) { cleanup?.(); controller.close(); }
          } catch { cleanup?.(); }
        };
        run.subscribers.add(send);
        cleanup = () => run.subscribers.delete(send);
      },
      cancel() { cleanup?.(); },
    });

    return { conflict: false, stream };
  },

  cancelRun(): { ok: true } | { notFound: true } {
    if (!activeRun || activeRun.done) {
      return { notFound: true };
    }

    activeRun.cancelled = true;
    activeRun.child?.kill("SIGTERM");
    emit(activeRun, { done: true, exitCode: 130, cancelled: true });

    return { ok: true };
  },
};

export { SSE_HEADERS };
