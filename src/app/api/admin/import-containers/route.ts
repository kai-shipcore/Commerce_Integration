// Code Guide: POST /api/admin/import-containers — start an import run, returns SSE stream
//             GET  /api/admin/import-containers — status JSON or SSE subscription (?stream=1)
//             DELETE /api/admin/import-containers — cancel the active run
//
// Module-level activeRun tracks the child process and buffered log so reconnecting
// clients can replay what they missed. Single-process deployments only.

import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import { NextRequest, NextResponse } from "next/server";
import { guardPermission } from "@/lib/permissions";

// ── Run state ──────────────────────────────────────────────────────────────────

type LogEntry   = { line: string; isError?: boolean };
type RunPayload = LogEntry | { done: true; exitCode: number; cancelled?: boolean };

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

let activeRun: ActiveRun | null = null;

function emit(run: ActiveRun, payload: RunPayload) {
  run.log.push(payload);
  for (const sub of run.subscribers) {
    try { sub(payload); } catch {}
  }
  if ("done" in payload) {
    run.done     = true;
    run.exitCode = payload.exitCode;
    run.subscribers.clear();
  }
}

// ── SSE helpers ────────────────────────────────────────────────────────────────

const SSE_HEADERS = {
  "Content-Type":      "text/event-stream",
  "Cache-Control":     "no-cache",
  "Connection":        "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

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

// ── Import job (fire and forget) ───────────────────────────────────────────────

function startImportJob(
  run: ActiveRun,
  url: string,
  tab: string | undefined,
  dryRun: boolean,
  forceDownload: boolean
) {
  // Spawn the current Node binary with the local tsx CLI directly — spawning
  // "npx" fails with ENOENT on Windows (it's npx.cmd there) and on any machine
  // where the server process's PATH lacks npm's bin dir.
  const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const args = [tsxCli, "scripts/import-containers-from-sheet.ts", url];
  if (tab?.trim()) args.push("--tab", tab.trim());
  if (dryRun) args.push("--dry-run");
  if (forceDownload) args.push("--force-download");

  const child = spawn(process.execPath, args, {
    cwd:   process.cwd(),
    env:   process.env as NodeJS.ProcessEnv,
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
  });

  child.on("close", (code) => {
    if (!run.cancelled) emit(run, { done: true, exitCode: code ?? 1 });
  });
}

// ── GET — status JSON or SSE subscription ──────────────────────────────────────

export async function GET(request: NextRequest) {
  const denied = await guardPermission("container-import", "read");
  if (denied) return denied;

  if (request.nextUrl.searchParams.get("stream") === "1") {
    if (!activeRun) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, exitCode: 0 })}\n\n`));
          c.close();
        },
      });
      return new NextResponse(stream, { headers: SSE_HEADERS });
    }
    return new NextResponse(makeSseStream(activeRun), { headers: SSE_HEADERS });
  }

  if (!activeRun) return NextResponse.json({ status: "idle" });

  return NextResponse.json({
    status:    activeRun.done ? (activeRun.cancelled ? "cancelled" : "done") : "running",
    startedAt: activeRun.startedAt,
    url:       activeRun.url,
    dryRun:    activeRun.dryRun,
    exitCode:  activeRun.exitCode,
    log:       activeRun.log,
  });
}

// ── DELETE — cancel the active run ─────────────────────────────────────────────

export async function DELETE() {
  const denied = await guardPermission("container-import", "create");
  if (denied) return denied;

  if (!activeRun || activeRun.done) {
    return NextResponse.json({ error: "No active run" }, { status: 404 });
  }

  activeRun.cancelled = true;
  activeRun.child?.kill("SIGTERM");
  emit(activeRun, { done: true, exitCode: 130, cancelled: true });

  return NextResponse.json({ ok: true });
}

// ── POST — start a new import run ─────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const denied = await guardPermission("container-import", "create");
  if (denied) return denied;

  const body = await request.json();
  const { url, tab, dryRun, forceDownload } = body as {
    url: string; tab?: string; dryRun?: boolean; forceDownload?: boolean;
  };

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url is required" }, { status: 422 });
  }

  if (activeRun && !activeRun.done) {
    return NextResponse.json(
      { error: "Import already in progress", startedAt: activeRun.startedAt },
      { status: 409 }
    );
  }

  const run: ActiveRun = {
    startedAt:   new Date().toISOString(),
    url,
    dryRun:      !!dryRun,
    log:         [],
    done:        false,
    cancelled:   false,
    exitCode:    null,
    child:       null,
    subscribers: new Set(),
  };
  activeRun = run;

  // Start the import job in the background (fire and forget)
  startImportJob(run, url, tab, !!dryRun, !!forceDownload);

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

  return new NextResponse(stream, { headers: SSE_HEADERS });
}
