"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, Play, Square } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

const HORIZON_OPTIONS = [4, 8, 10, 13, 26, 52];

const STEPS_EN = [
  { label: "Ingest",   marker: "Step 0:" },
  { label: "Load",     marker: "Step 1:" },
  { label: "Profile",  marker: "Step 1b:" },
  { label: "Backtest", marker: "Step 2:" },
  { label: "Select",   marker: "Step 3:" },
  { label: "Forecast", marker: "Step 4:" },
  { label: "Write",    marker: "Step 5:" },
];
const STEPS_KO = [
  { label: "수집",   marker: "Step 0:" },
  { label: "로드",   marker: "Step 1:" },
  { label: "프로파일", marker: "Step 1b:" },
  { label: "백테스트", marker: "Step 2:" },
  { label: "모델선택", marker: "Step 3:" },
  { label: "예측",   marker: "Step 4:" },
  { label: "저장",   marker: "Step 5:" },
];

type StepState = "done" | "active" | "failed" | "cancelled" | "pending";

function detectCurrentStep(lines: string[]): number {
  let current = -1;
  for (const line of lines) {
    for (let i = 0; i < STEPS_EN.length; i++) {
      if (line.includes(STEPS_EN[i].marker) && i > current) current = i;
    }
  }
  return current;
}

function getStepState(i: number, current: number, status: JobStatus["status"]): StepState {
  if (status === "done") return "done";
  if (status === "cancelled") return i <= current ? "cancelled" : "pending";
  if (i < current) return "done";
  if (i === current) return status === "failed" ? "failed" : "active";
  return "pending";
}

function StepProgress({ lines, status }: { lines: string[]; status: JobStatus["status"] }) {
  const { locale } = useI18n();
  const STEPS = locale === "ko" ? STEPS_KO : STEPS_EN;
  const current = detectCurrentStep(lines);
  return (
    <div className="flex items-start">
      {STEPS.map((step, i) => {
        const state = getStepState(i, current, status);
        const connectorDone = i > 0 && getStepState(i - 1, current, status) === "done";
        return (
          <div key={step.label} className="flex flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              {i > 0 && (
                <div className={`h-px flex-1 transition-colors ${connectorDone ? "bg-green-400" : "bg-border"}`} />
              )}
              <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                state === "done"      ? "border-green-500 bg-green-500 text-white" :
                state === "active"    ? "border-blue-500 bg-blue-50 text-blue-600 dark:bg-blue-950" :
                state === "failed"    ? "border-red-500 bg-red-50 text-red-600 dark:bg-red-950" :
                state === "cancelled" ? "border-yellow-500 bg-yellow-50 text-yellow-600 dark:bg-yellow-950" :
                                        "border-border bg-background text-muted-foreground"
              }`}>
                {state === "done"      && <Check className="h-2.5 w-2.5" />}
                {state === "active"    && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                {state === "failed"    && <span className="text-[9px] font-bold">✕</span>}
                {state === "cancelled" && <span className="text-[9px] font-bold">–</span>}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`h-px flex-1 transition-colors ${state === "done" ? "bg-green-400" : "bg-border"}`} />
              )}
            </div>
            <span className={`mt-1 text-center text-[10px] leading-tight transition-colors ${
              state === "done"      ? "text-green-600 dark:text-green-400" :
              state === "active"    ? "font-medium text-blue-600 dark:text-blue-400" :
              state === "failed"    ? "text-red-600 dark:text-red-400" :
              state === "cancelled" ? "text-yellow-600 dark:text-yellow-400" :
                                      "text-muted-foreground"
            }`}>
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
const POLL_INTERVAL_MS = 2_000;

interface LastRun {
  run_date: string | null;
  horizon_weeks: number | null;
}

interface JobStatus {
  status: "running" | "done" | "failed" | "cancelled";
  lines: string[];
  exit_code: number | null;
}

const SESSION_KEY = "forecastJobId";

export function RunForecast({ initialLastRun, onDone }: { initialLastRun: LastRun | null; onDone?: () => void }) {
  const { pick, locale } = useI18n();
  const [horizon, setHorizon] = useState(13);
  const [customInput, setCustomInput] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [lastRun, setLastRun] = useState<LastRun | null>(initialLastRun);
  const [logOpen, setLogOpen] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  // Re-attach to a running job after navigation
  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (!saved) return;
    fetch(apiPath(`/api/forecast/status/${saved}`))
      .then((r) => r.ok ? r.json() : null)
      .then((data: JobStatus | null) => {
        if (data && data.status === "running") {
          setJobId(saved);
          setJob(data);
        } else {
          sessionStorage.removeItem(SESSION_KEY);
        }
      })
      .catch(() => sessionStorage.removeItem(SESSION_KEY));
  }, []);

  // Poll while running
  useEffect(() => {
    if (!jobId || job?.status !== "running") return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(apiPath(`/api/forecast/status/${jobId}`));
        const data = (await res.json()) as JobStatus;
        setJob(data);
        if (data.status !== "running") {
          clearInterval(id);
          sessionStorage.removeItem(SESSION_KEY);
          if (data.status === "done") {
            fetch(apiPath("/api/forecast/last-run"))
              .then((r) => r.json())
              .then((d: LastRun) => setLastRun(d))
              .catch(() => {});
            onDone?.();
          }
        }
      } catch {
        // ignore transient errors
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [jobId, job?.status]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [job?.lines]);

  async function handleRun() {
    setJob({ status: "running", lines: [], exit_code: null });
    setJobId(null);
    try {
      const res = await fetch(apiPath(`/api/forecast/run?horizon=${horizon}`), { method: "POST" });
      const data = (await res.json()) as { job_id?: string; error?: string };
      if (!res.ok || data.error) {
        setJob({ status: "failed", lines: [data.error ?? "Failed to start job"], exit_code: -1 });
        return;
      }
      const id = data.job_id ?? null;
      setJobId(id);
      if (id) sessionStorage.setItem(SESSION_KEY, id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setJob({ status: "failed", lines: [msg], exit_code: -1 });
    }
  }

  async function handleCancel() {
    if (!jobId) return;
    try {
      await fetch(apiPath(`/api/forecast/cancel/${jobId}`), { method: "POST" });
    } catch {
      // ignore — status polling will catch the cancelled state
    }
  }

  const isRunning = job?.status === "running";

  const formattedLastRun = lastRun?.run_date
    ? new Date(lastRun.run_date).toLocaleString(locale === "ko" ? "ko-KR" : "en-US", {
        month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit", hour12: locale !== "ko",
        timeZone: "America/Los_Angeles",
        timeZoneName: "short",
      })
    : null;

  return (
    <Card>
      <CardHeader className="pb-3 pt-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{pick("예측 실행", "Run Forecast")}</CardTitle>
          <span className="text-xs text-muted-foreground">
            {pick("마지막 실행:", "Last run:")}{" "}
            {formattedLastRun
              ? `${formattedLastRun}${lastRun?.horizon_weeks ? ` · ${lastRun.horizon_weeks}${pick("주", "W")} ${pick("기간", "horizon")}` : ""}`
              : "—"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Horizon selector */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{pick("예측 기간:", "Horizon:")}</span>
          <div className="flex gap-1">
            {HORIZON_OPTIONS.map((w) => (
              <button
                key={w}
                onClick={() => { setHorizon(w); setCustomInput(""); }}
                disabled={isRunning}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${
                  horizon === w && customInput === ""
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {w}W
              </button>
            ))}
          </div>
          <input
            type="number"
            min={1}
            max={104}
            placeholder={pick("직접 입력", "custom")}
            value={customInput}
            disabled={isRunning}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = parseInt(customInput);
                if (!isNaN(v) && v >= 1 && v <= 104) setHorizon(v);
              }
            }}
            onBlur={() => {
              const v = parseInt(customInput);
              if (!isNaN(v) && v >= 1 && v <= 104) setHorizon(v);
              else setCustomInput("");
            }}
            className="w-20 rounded border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-40"
          />
          <Button size="sm" onClick={handleRun} disabled={isRunning} className="ml-2 gap-1.5">
            {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {isRunning ? pick("실행 중…", "Running…") : pick("실행", "Run")}
          </Button>
          {isRunning && (
            <Button size="sm" variant="outline" onClick={handleCancel} className="gap-1.5 text-destructive hover:text-destructive">
              <Square className="h-3 w-3 fill-current" />
              {pick("취소", "Cancel")}
            </Button>
          )}
        </div>

        {/* Step progress */}
        {job && <StepProgress lines={job.lines} status={job.status} />}

        {/* Log output */}
        {job && (
          <div className="space-y-1.5">
            <button
              onClick={() => setLogOpen((o) => !o)}
              className="flex w-full items-center gap-2 text-left"
            >
              {logOpen
                ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              <span className="text-xs font-medium text-muted-foreground">{pick("출력", "Output")}</span>
              {job.status === "done" && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  {pick("완료", "Done")}
                </span>
              )}
              {job.status === "failed" && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                  {pick("실패", "Failed")}
                </span>
              )}
              {job.status === "running" && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                  {pick("실행 중", "Running")}
                </span>
              )}
              {job.status === "cancelled" && (
                <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                  {pick("취소됨", "Cancelled")}
                </span>
              )}
            </button>
            {logOpen && (
              <>
                <div
                  ref={logRef}
                  className="h-52 overflow-y-auto rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-foreground"
                >
                  {job.lines.length === 0 && job.status === "running" && (
                    <span className="text-muted-foreground">{pick("시작 중…", "Starting…")}</span>
                  )}
                  {job.lines.map((line, i) => (
                    <div key={i} className={line.startsWith("Error") ? "text-red-500" : ""}>
                      {line || " "}
                    </div>
                  ))}
                </div>
                {job.status === "done" && (
                  <p className="rounded-md bg-green-50 px-3 py-2 text-xs font-medium text-green-700 dark:bg-green-900/20 dark:text-green-400">
                    {pick("예측이 성공적으로 완료되었습니다. 세그멘테이션 데이터가 새로고침됩니다.", "Forecast completed successfully. Segmentation data will refresh on next page load.")}
                  </p>
                )}
                {job.status === "failed" && (
                  <p className="rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-900/20 dark:text-red-400">
                    {pick("예측에 실패했습니다. 위의 출력에서 세부 정보를 확인하세요.", "Forecast failed. Check the output above for details.")}
                  </p>
                )}
                {job.status === "cancelled" && (
                  <p className="rounded-md bg-yellow-50 px-3 py-2 text-xs font-medium text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400">
                    {pick("예측이 취소되었습니다. 데이터베이스에 데이터가 저장되지 않았습니다.", "Forecast cancelled. No data was written to the database.")}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
