"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Play, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

interface LogLine {
  text: string;
  isError: boolean;
}

type RunState = "idle" | "running" | "done" | "error" | "cancelled";

type RawPayload = { line: string; isError?: boolean } | { done: true; exitCode: number; cancelled?: boolean };

export function ContainerImport() {
  const { pick } = useI18n();
  const [url, setUrl] = useState("");
  const [tab, setTab] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [forceDownload, setForceDownload] = useState(false);
  const [runState, setRunState] = useState<RunState>("idle");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [isCancelling, setIsCancelling] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const mountAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  // ── SSE reader (shared by initial run and reconnect) ─────────────────────────

  async function readSseStream(res: Response) {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const rawLine of lines) {
        if (!rawLine.startsWith("data: ")) continue;
        let event: Record<string, unknown>;
        try { event = JSON.parse(rawLine.slice(6)); } catch { continue; }

        if ("line" in event) {
          const text = event.line as string;
          const isError = !!event.isError || text.startsWith("[stderr]") || text.startsWith("[error]");
          setLog(prev => [...prev, { text, isError }]);
        } else if (event.done) {
          const code = event.exitCode as number;
          setExitCode(code);
          setRunState(event.cancelled ? "cancelled" : (code === 0 ? "done" : "error"));
        }
      }
    }
  }

  // ── On mount: check if an import is already running ──────────────────────────

  useEffect(() => {
    const abort = new AbortController();
    mountAbortRef.current = abort;

    async function checkExistingRun() {
      try {
        const res = await fetch(apiPath("/api/admin/import-containers"), {
          signal: abort.signal,
        });
        if (!res.ok) return;

        const data = await res.json() as {
          status: string;
          url?: string;
          dryRun?: boolean;
          exitCode?: number | null;
          log?: RawPayload[];
        };

        if (data.status === "running") {
          setUrl(data.url ?? "");
          setDryRun(data.dryRun ?? false);
          setRunState("running");
          setLog([]);
          // Reconnect to the live SSE stream — it replays the buffered log then goes live
          const sseRes = await fetch(apiPath("/api/admin/import-containers?stream=1"), {
            signal: abort.signal,
          });
          if (sseRes.ok) await readSseStream(sseRes);
          // Safety: if stream closed without a done event, stop spinning
          setRunState(prev => prev === "running" ? "error" : prev);
        } else if (data.status === "done" || data.status === "cancelled") {
          // Show last run result without reconnecting
          const logLines = (data.log ?? []).flatMap(entry =>
            "line" in entry ? [{ text: entry.line, isError: !!entry.isError }] : []
          );
          setLog(logLines);
          setExitCode(data.exitCode ?? null);
          setRunState(data.status === "cancelled" ? "cancelled" : (data.exitCode === 0 ? "done" : "error"));
          if (data.url) setUrl(data.url);
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }

    checkExistingRun();
    return () => abort.abort();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Start a new import ───────────────────────────────────────────────────────

  async function runImport() {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || runState === "running") return;

    setRunState("running");
    setLog([]);
    setExitCode(null);

    try {
      const res = await fetch(apiPath("/api/admin/import-containers"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmedUrl, tab: tab.trim() || undefined, dryRun, forceDownload }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        if (res.status === 409) {
          // Another run started between mount check and this click — subscribe to it
          setLog([{ text: pick("이미 실행 중입니다 — 재연결 중...", "Import already running — reconnecting…"), isError: false }]);
          const sseRes = await fetch(apiPath("/api/admin/import-containers?stream=1"));
          if (sseRes.ok) await readSseStream(sseRes);
        } else {
          setLog([{ text: data.error ?? pick("요청 실패", "Request failed"), isError: true }]);
          setRunState("error");
        }
        return;
      }

      await readSseStream(res);
      setRunState(prev => prev === "running" ? "error" : prev);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setLog(prev => [...prev, { text: pick("연결이 끊어졌습니다", "Connection lost"), isError: true }]);
      setRunState(prev => prev === "running" ? "error" : prev);
    }
  }

  // ── Cancel ───────────────────────────────────────────────────────────────────

  async function cancelRun() {
    if (isCancelling) return;
    setIsCancelling(true);
    try {
      await fetch(apiPath("/api/admin/import-containers"), { method: "DELETE" });
      // The SSE stream will receive the cancelled done event and update runState
    } catch {}
    setIsCancelling(false);
  }

  // ── Reset UI ─────────────────────────────────────────────────────────────────

  function reset() {
    mountAbortRef.current?.abort();
    setRunState("idle");
    setLog([]);
    setExitCode(null);
  }

  const isRunning = runState === "running";

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{pick("컨테이너 데이터 가져오기", "Container Data Import")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {pick(
            "Google Sheets에서 컨테이너 및 SKU 데이터를 가져옵니다. 시트는",
            "Import container and SKU data from a Google Sheet. The sheet must be shared as"
          )}{" "}
          <span className="font-medium">{pick('"링크가 있는 모든 사용자 보기"', '"Anyone with the link can view"')}</span>
          {pick(" 로 공유되어야 합니다.", ".")}
        </p>
      </div>

      <div className="rounded-lg border bg-card p-5 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="sheet-url">{pick("Google Sheets URL", "Google Sheet URL")}</Label>
          <Input
            id="sheet-url"
            placeholder="https://docs.google.com/spreadsheets/d/…"
            value={url}
            onChange={e => setUrl(e.target.value)}
            disabled={isRunning}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tab-name">
            {pick("탭 이름", "Tab name")}{" "}
            <span className="text-xs text-muted-foreground font-normal">
              {pick('(선택 사항 — "L-"로 시작하는 첫 번째 탭 자동 감지)', '(optional — auto-detects first tab starting with "L-")')}
            </span>
          </Label>
          <Input
            id="tab-name"
            placeholder={pick("예: L- 7.2.2026", "e.g. L- 7.2.2026")}
            value={tab}
            onChange={e => setTab(e.target.value)}
            disabled={isRunning}
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={e => setDryRun(e.target.checked)}
            disabled={isRunning}
            className="h-4 w-4 rounded border"
          />
          <span className="text-sm">
            {pick("테스트 실행", "Dry run")}{" "}
            <span className="text-xs text-muted-foreground">
              {pick("(DB에 쓰지 않고 변경 사항 미리 보기)", "(preview changes without writing to the database)")}
            </span>
          </span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={forceDownload}
            onChange={e => setForceDownload(e.target.checked)}
            disabled={isRunning}
            className="h-4 w-4 rounded border"
          />
          <span className="text-sm">
            {pick("새로 다운로드", "Force fresh download")}{" "}
            <span className="text-xs text-muted-foreground">
              {pick(
                "(최근 다운로드한 사본을 재사용하지 않고 다시 받기 — 시트를 수정했다면 사용)",
                "(re-download instead of reusing a recent copy — use if you edited the sheet)"
              )}
            </span>
          </span>
        </label>

        <div className="flex gap-2">
          <Button onClick={runImport} disabled={isRunning || !url.trim()} className="gap-2">
            {isRunning
              ? <><Loader2 className="h-4 w-4 animate-spin" /> {pick("실행 중…", "Running…")}</>
              : <><Play className="h-4 w-4" /> {pick("가져오기 실행", "Run Import")}</>
            }
          </Button>

          {isRunning && (
            <Button variant="outline" onClick={cancelRun} disabled={isCancelling} className="gap-2">
              {isCancelling
                ? <><Loader2 className="h-4 w-4 animate-spin" /> {pick("취소 중…", "Cancelling…")}</>
                : <><X className="h-4 w-4" /> {pick("취소", "Cancel")}</>
              }
            </Button>
          )}

          {(runState === "done" || runState === "error" || runState === "cancelled") && (
            <Button variant="outline" onClick={reset} className="gap-2">
              <RotateCcw className="h-4 w-4" /> {pick("초기화", "Reset")}
            </Button>
          )}
        </div>
      </div>

      {/* Live log output */}
      {log.length > 0 && (
        <div className="rounded-lg border">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="text-xs font-medium text-muted-foreground">{pick("출력", "Output")}</span>
            {exitCode !== null && (
              <span className={`text-xs font-medium ${
                runState === "cancelled"
                  ? "text-muted-foreground"
                  : exitCode === 0
                    ? "text-green-600 dark:text-green-400"
                    : "text-destructive"
              }`}>
                {runState === "cancelled"
                  ? pick("취소됨", "Cancelled")
                  : exitCode === 0
                    ? pick("완료", "Completed successfully")
                    : `Exit code ${exitCode}`
                }
              </span>
            )}
            {isRunning && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> {pick("실행 중", "Running")}
              </span>
            )}
          </div>
          <pre className="max-h-[480px] overflow-y-auto p-4 text-xs font-mono leading-relaxed bg-muted/40 rounded-b-lg">
            {log.map((entry, i) => (
              <span key={i} className={entry.isError ? "text-destructive" : ""}>
                {entry.text}{"\n"}
              </span>
            ))}
            <div ref={logEndRef} />
          </pre>
        </div>
      )}
    </div>
  );
}
