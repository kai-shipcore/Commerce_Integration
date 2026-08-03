"use client";

/**
 * Code Guide:
 * The failure card for planning pages.
 *
 * It replaces a card that said "Could not reach the forecast server" for every
 * failure, including a 500 from a server that was plainly reachable. That
 * heading sent readers to check whether the service was running when it was,
 * and the real detail, "Internal Server Error", told them nothing.
 *
 * Four failures with four different fixes:
 *   unreachable  nothing is listening
 *   no_data      up, but the gitignored data files are absent
 *   outdated     up with data, but predates these endpoints
 *   error        something else, shown verbatim rather than guessed at
 *
 * The proxy classifies, because only the server can see the upstream status and
 * ask /health. This renders.
 */

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Database, Loader2, PlugZap, RefreshCw, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

/** Builds the data files from the database, then reloads the page that asked.
 *
 *  Offered rather than done automatically. The work is minutes, so no request
 *  can wait for it, and on the server `data/processed/` is live data owned by
 *  the Monday cron: rebuilding it from a page load, triggered by anyone opening
 *  a tab, is the one thing that must not happen. A button makes it a deliberate
 *  act by someone who has read what is missing.
 *
 *  Polls the same job endpoint the Run Forecast panel uses, so this is a second
 *  caller of existing machinery rather than a second mechanism. */
function PrepareDataButton({ onRetry }: { onRetry?: () => void }) {
  const { pick } = useI18n();
  const [state, setState] = useState<"idle" | "running" | "failed">("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clears on unmount, so navigating away mid-run does not leave an interval
  // polling a job nobody is watching.
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const start = async () => {
    setState("running");
    setDetail(null);
    try {
      const res = await fetch(apiPath("/api/planning/prepare-data"), { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || body?.error || `HTTP ${res.status}`);
      const jobId = body.job_id as string;

      timer.current = setInterval(async () => {
        try {
          // Path segment, not a query parameter: the route is
          // /api/forecast/status/[jobId].
          const s = await fetch(apiPath(`/api/forecast/status/${encodeURIComponent(jobId)}`));
          const j = await s.json();
          if (j.status === "done") {
            if (timer.current) clearInterval(timer.current);
            // Refetch in place when the caller gave us a way to, rather than
            // reloading: the page keeps whatever else the reader had open.
            if (onRetry) onRetry();
            else window.location.reload();
          } else if (j.status === "failed" || j.status === "cancelled") {
            if (timer.current) clearInterval(timer.current);
            setState("failed");
            // The job payload is {job_id, status, lines, exit_code}, with no
            // error field, so the last log line is the message. It is also the
            // better one: the script prints which of the three steps failed.
            const last = Array.isArray(j.lines) && j.lines.length
              ? String(j.lines[j.lines.length - 1])
              : null;
            setDetail(j.status === "cancelled"
              ? pick("취소되었습니다.", "Cancelled.")
              : (last ?? pick("실패했습니다.", "It failed.")));
          }
        } catch {
          // A dropped poll is not a failed job. The next tick retries; the run
          // continues on the server regardless of whether anyone is watching.
        }
      }, 3000);
    } catch (err) {
      setState("failed");
      setDetail(err instanceof Error ? err.message : String(err));
    }
  };

  if (state === "running") {
    return (
      <p className="mt-3 flex items-center gap-2 text-[12px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {pick(
          "데이터를 생성하는 중입니다. 몇 분 걸리며, 끝나면 페이지가 새로고침됩니다.",
          "Building the data. This takes a few minutes; the page reloads when it finishes.",
        )}
      </p>
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={start}
        className="rounded-md border bg-background px-3 py-1.5 text-[12px] font-medium hover:bg-muted"
      >
        {pick("데이터베이스에서 생성하기", "Build it from the database")}
      </button>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
        {pick(
          "DB 자격 증명이 있는 경우에만 동작합니다. 주문 내역 전체를 다시 읽으므로 몇 분 걸립니다.",
          "Only works if this machine has database credentials. It re-reads the full order history, so it takes a few minutes.",
        )}
      </p>
      {state === "failed" && detail && (
        <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">{detail}</p>
      )}
    </div>
  );
}

export type PlanningErrorKind = "unreachable" | "no_data" | "outdated" | "error";

export interface PlanningErrorBody {
  kind?: PlanningErrorKind;
  error?: string;
  detail?: string;
  missingRequired?: string[];
  files?: { name: string; path: string; produced_by: string }[];
  repoRoot?: string | null;
}

/** Pull the structured body off a failed response, falling back to a bare
 *  message so callers that only have a string still render something. */
export function planningErrorFrom(body: unknown, fallback: string): PlanningErrorBody {
  if (body && typeof body === "object") {
    const b = body as PlanningErrorBody;
    if (b.error || b.detail || b.kind) return b;
  }
  return { kind: "error", detail: fallback };
}

export function PlanningError({
  body,
  onRetry,
}: {
  body: PlanningErrorBody;
  onRetry?: () => void;
}) {
  const { pick } = useI18n();
  const kind: PlanningErrorKind = body.kind ?? "error";

  const Icon = { unreachable: PlugZap, no_data: Database, outdated: AlertTriangle, error: XCircle }[kind];

  const heading: Record<PlanningErrorKind, string> = {
    unreachable: pick("예측 서버가 실행되고 있지 않습니다.", "The forecast server is not running."),
    no_data: pick("예측 서버에 읽을 데이터가 없습니다.", "The forecast server has no data to read."),
    outdated: pick("예측 서버가 최신 버전이 아닙니다.", "The forecast server is out of date."),
    error: pick("예측 서버에서 오류가 발생했습니다.", "The forecast server returned an error."),
  };

  const guidance: Record<PlanningErrorKind, string> = {
    // Wording that suits both arrangements. It used to say only "opening this
    // page tries to start it", which is true of a localhost URL and misleading
    // when AI_SERVICE_URL points at the box that runs the service, where there
    // is nothing local to start and the detail below is the whole answer.
    unreachable: pick(
      "로컬 서버라면 페이지를 열 때 자동으로 시작을 시도합니다. 원격 서버라면 해당 호스트에서 실행 중인지 확인해야 합니다. 아래에 어느 경우인지 표시됩니다.",
      "If it is a local server, opening this page tries to start it. If AI_SERVICE_URL points at another host, that service has to be up there. The detail below says which case this is.",
    ),
    no_data: pick(
      "서버 자체는 정상입니다. data/processed 는 git에 포함되지 않으므로, 새로 클론한 저장소에는 코드만 있고 데이터 파일이 없습니다. 필요한 데이터는 이미 저장소 안에 있으니, Time_Series_Forecasting 에서 아래 명령 한 줄이면 됩니다.",
      "The service itself is fine. data/processed is gitignored, so a fresh checkout has the code and none of the data. The data it needs is already in the repository, so one command in the Time_Series_Forecasting checkout is enough.",
    ),
    outdated: pick(
      "Time_Series_Forecasting 저장소에서 최신 코드를 받은 뒤 서버를 다시 시작하세요.",
      "Pull the latest in the Time_Series_Forecasting checkout and restart the server.",
    ),
    error: pick(
      "아래는 서버가 반환한 내용 그대로입니다.",
      "Below is what the server returned, verbatim.",
    ),
  };

  const tone: Record<PlanningErrorKind, string> = {
    unreachable: "text-red-600 dark:text-red-400",
    no_data: "text-amber-600 dark:text-amber-400",
    outdated: "text-amber-600 dark:text-amber-400",
    error: "text-red-600 dark:text-red-400",
  };

  return (
    <Card>
      <CardContent className="p-6 text-sm">
        <div className={`flex items-center gap-2 font-medium ${tone[kind]}`}>
          <Icon className="h-4 w-4 shrink-0" />
          {heading[kind]}
        </div>

        <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{guidance[kind]}</p>

        {/* The command, before the file list rather than after it. The list
            names what is missing, which is diagnosis; this is the fix, and a
            reader who trusts the card does not need to read the diagnosis to
            act on it. It seeds from data already committed, so it needs no
            database, no .env and no pipeline run. */}
        {/* Both platforms, because this card is read on whichever machine is
            broken and the reader is in no position to translate a path. The
            Windows form calls the interpreter directly rather than activating
            the virtualenv, since the default execution policy blocks
            Activate.ps1. */}
        {/* Two routes out, in the order they should be tried. The seed is
            instant and needs no database, so it comes first; the button below
            is for wanting current data rather than the committed fixture, and
            costs minutes and credentials. */}
        {kind === "no_data" && (
          <>
            <p className="mt-3 text-[11.5px] font-medium">
              {pick("가장 빠른 방법 — 저장소에 포함된 고정 데이터", "Quickest — the fixture committed to the repo")}
            </p>
            <pre className="mt-1 overflow-x-auto rounded-md border bg-muted/50 px-3 py-2 font-mono text-[11px] leading-relaxed">
              <span className="select-none text-muted-foreground"># macOS / Linux{"\n"}</span>
              .venv/bin/python scripts/seed_dev_data.py{"\n"}
              <span className="select-none text-muted-foreground">{"\n"}# Windows PowerShell{"\n"}</span>
              {String.raw`.venv\Scripts\python.exe scripts\seed_dev_data.py`}
            </pre>
            <p className="mt-3 text-[11.5px] font-medium">
              {pick("또는 — 현재 데이터로 새로 생성", "Or — build current data instead")}
            </p>
            <PrepareDataButton onRetry={onRetry} />
          </>
        )}

        {kind === "no_data" && body.files && body.files.length > 0 && (
          <ul className="mt-3 space-y-1 text-[11.5px] text-muted-foreground">
            {body.files.map((f) => (
              <li key={f.name}>
                <code className="font-mono text-[11px] text-foreground">{f.path}</code>
                <span className="opacity-80"> — {pick("생성", "produced by")} {f.produced_by}</span>
              </li>
            ))}
          </ul>
        )}

        {kind === "no_data" && body.repoRoot && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {pick("서버가 읽는 위치", "Server is reading from")}:{" "}
            <code className="font-mono text-[10.5px]">{body.repoRoot}</code>
          </p>
        )}

        {body.detail && kind !== "no_data" && (
          <p className="mt-3 whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px] text-muted-foreground">
            {body.detail}
          </p>
        )}

        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted/60"
          >
            <RefreshCw className="h-3 w-3" />
            {pick("다시 시도", "Try again")}
          </button>
        )}
      </CardContent>
    </Card>
  );
}
