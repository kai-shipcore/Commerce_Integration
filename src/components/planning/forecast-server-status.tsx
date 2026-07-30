"use client";

/**
 * Code Guide:
 * Status of the forecast service, shown in the header of every planning page.
 *
 * Three states rather than two. "Running" is not enough, because the failure
 * that actually happens on a fresh checkout is a server that is up and has no
 * data: data/processed and outputs/reports are gitignored, so the process
 * starts, passes a liveness check, and raises on every real request. That
 * reaches the browser as "Internal Server Error" and sends the reader hunting
 * for an application bug. This says "no data" and names the missing files.
 *
 * Re-checks on an interval and whenever the tab regains focus. A laptop that
 * slept through the server dying is the common case, and a status line that is
 * quietly hours stale is worse than none.
 *
 * `onRecovered` lets a page reload itself once the service comes back, so a
 * reader who starts the server does not also have to know to refresh.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

const POLL_MS = 60_000;

export interface ForecastHealth {
  running: boolean;
  ready: boolean | null;
  missingRequired: string[];
  missingOptional: string[];
  files: { name: string; path: string; exists: boolean; required: boolean; produced_by: string }[];
  repoRoot: string | null;
  url: string;
  local: boolean;
}

type State = "checking" | "ok" | "no-data" | "down";

function stateOf(h: ForecastHealth | null): State {
  if (!h) return "checking";
  if (!h.running) return "down";
  // `ready: null` means the server is up but predates the readiness fields.
  // Treated as fine rather than as a fault: it serves, it is just older.
  if (h.ready === false) return "no-data";
  return "ok";
}

export function ForecastServerStatus({ onRecovered }: { onRecovered?: () => void }) {
  const { pick } = useI18n();
  const [health, setHealth] = useState<ForecastHealth | null>(null);
  // Starts true because the component checks on mount. Setting it inside the
  // effect instead would be a synchronous setState in an effect body, the
  // cascading-render pattern; the flag is only ever cleared asynchronously here
  // and raised from event and timer callbacks, which are not effect bodies.
  const [checking, setChecking] = useState(true);
  const [expanded, setExpanded] = useState(false);

  // Held in a ref so the poll callback does not need to be rebuilt, and so the
  // recovery edge is detected without making `health` a dependency of the
  // effect that sets it.
  const wasServing = useRef<boolean | null>(null);
  // Kept in a ref so a caller passing an inline arrow does not restart the
  // polling effect on every render. Assigned in an effect rather than during
  // render, which is the rule: a render can be discarded, and a ref written
  // then would keep a callback from a render that never committed.
  const onRecoveredRef = useRef(onRecovered);
  useEffect(() => {
    onRecoveredRef.current = onRecovered;
  }, [onRecovered]);

  const check = useCallback(async () => {
    try {
      const res = await fetch(apiPath("/api/forecast-server/status"), { cache: "no-store" });
      const body = (await res.json()) as ForecastHealth;
      setHealth(body);

      const serving = body.running && body.ready !== false;
      if (wasServing.current === false && serving) onRecoveredRef.current?.();
      wasServing.current = serving;
    } catch {
      setHealth((prev) => (prev ? { ...prev, running: false } : null));
      wasServing.current = false;
    } finally {
      setChecking(false);
    }
  }, []);

  const recheck = useCallback(() => {
    setChecking(true);
    void check();
  }, [check]);

  useEffect(() => {
    // Scheduled rather than called. The first check is a subscription to an
    // external system starting up, but invoking it in the effect body is a
    // synchronous setState there, so it goes through the same timer path as
    // every later check instead of being a special case.
    const first = window.setTimeout(recheck, 0);
    const id = window.setInterval(recheck, POLL_MS);
    // Focus and visibility both, because a tab switched back to fires
    // visibilitychange while a window brought forward fires focus.
    const onWake = () => {
      if (document.visibilityState === "visible") recheck();
    };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [recheck]);

  const state = stateOf(health);

  const STYLE: Record<State, string> = {
    checking: "border-border text-muted-foreground",
    ok: "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400",
    "no-data": "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400",
    down: "border-red-300 text-red-700 dark:border-red-800 dark:text-red-400",
  };

  const LABEL: Record<State, string> = {
    checking: pick("확인 중", "Checking"),
    ok: pick("예측 서버 정상", "Forecast server up"),
    "no-data": pick("데이터 없음", "Server up, no data"),
    down: pick("예측 서버 중지됨", "Forecast server down"),
  };

  const Icon = { checking: Loader2, ok: CheckCircle2, "no-data": AlertTriangle, down: XCircle }[state];
  const detailed = state === "no-data" || state === "down";

  return (
    <div className="flex flex-col items-end gap-1">
      <div className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${STYLE[state]}`}>
        <Icon className={`h-3.5 w-3.5 ${state === "checking" ? "animate-spin" : ""}`} />
        <span className="font-medium">{LABEL[state]}</span>
        {detailed && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="ml-0.5 underline underline-offset-2 opacity-80 hover:opacity-100"
          >
            {expanded ? pick("숨기기", "hide") : pick("자세히", "details")}
          </button>
        )}
        <button
          type="button"
          onClick={recheck}
          disabled={checking}
          title={pick("다시 확인", "Check again")}
          className="ml-0.5 opacity-70 hover:opacity-100 disabled:opacity-40"
        >
          <RefreshCw className={`h-3 w-3 ${checking ? "animate-spin" : ""}`} />
        </button>
      </div>

      {expanded && health && (
        <div className="max-w-md rounded-md border bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
          {state === "down" && (
            <>
              <p className="font-medium text-foreground">
                {pick("서버가 응답하지 않습니다.", "Nothing is answering.")}
              </p>
              <p className="mt-1">
                {health.local
                  ? pick(
                      `${health.url} 에서 응답이 없습니다. 페이지를 열면 자동으로 시작을 시도하며, 수동으로 시작하려면 Time_Series_Forecasting 폴더에서 아래를 실행하세요.`,
                      `Nothing is listening at ${health.url}. Opening a planning page tries to start it; to start it by hand, run this in your Time_Series_Forecasting checkout:`,
                    )
                  : pick(
                      `${health.url} 는 이 앱이 관리하는 서버가 아닙니다. 해당 호스트에서 서비스를 확인해야 합니다.`,
                      `${health.url} is not a server this app can start. It has to be brought up on that host.`,
                    )}
              </p>
              {health.local && (
                <code className="mt-1.5 block rounded bg-background px-2 py-1 font-mono text-[10.5px] text-foreground">
                  .venv/bin/uvicorn api.main:app --host 0.0.0.0 --port 8000
                </code>
              )}
            </>
          )}

          {state === "no-data" && (
            <>
              <p className="font-medium text-foreground">
                {pick(
                  "서버는 실행 중이지만 읽을 데이터가 없습니다.",
                  "The server is running but has no data to read.",
                )}
              </p>
              <p className="mt-1">
                {pick(
                  "data/processed 와 outputs/reports 는 git에서 제외되어 있어, 새로 클론한 저장소에는 코드만 있고 파일은 없습니다. 이 상태에서는 모든 요청이 500으로 실패합니다.",
                  "data/processed and outputs/reports are gitignored, so a fresh clone has the code and none of the files. Every request fails with a 500 until they exist.",
                )}
              </p>
              <ul className="mt-2 space-y-0.5">
                {health.files
                  .filter((f) => !f.exists && f.required)
                  .map((f) => (
                    <li key={f.name}>
                      <code className="font-mono text-[10.5px] text-foreground">{f.path}</code>
                      <span className="opacity-80"> — {pick("생성", "produced by")} {f.produced_by}</span>
                    </li>
                  ))}
              </ul>
              {health.repoRoot && (
                <p className="mt-2 opacity-80">
                  {pick("서버가 읽는 위치", "Server is reading from")}:{" "}
                  <code className="font-mono text-[10.5px]">{health.repoRoot}</code>
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
