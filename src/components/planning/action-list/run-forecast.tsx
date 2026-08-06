"use client";

/**
 * Code Guide:
 * Run the forecast from the Action List, and watch it happen.
 *
 * Until now the only way to produce a forecast was the Monday 3am cron or an
 * SSH session. When that job failed, the screens carried on serving last week's
 * numbers with nothing on them offering a way to fix it, and the person most
 * likely to notice the "Trained through" date was stale was the one with no
 * means of acting on it.
 *
 * Collapsed by default, and sits under the provenance bar rather than beside
 * the filters. This is an operational control on a screen otherwise built for
 * purchasing decisions, so it stays out of the way until the date above it
 * looks wrong, which is the moment anyone wants it.
 *
 * Progress comes from the script's own stdout. ml_prepare_data.py prints a
 * fixed "Step N/4" line per stage and flushes; the API streams those lines into
 * the job record and this reads the highest one seen. Deriving progress from
 * the output the script already produces means there is no second description
 * of the pipeline here to fall out of step with it, but it does couple this
 * component to those prefixes, which is why they are called out in that script.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Loader2, Play, X } from "lucide-react";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

/** The pipeline, in the order ml_prepare_data.py prints it. Labels are this
 *  component's own: the script's lines are written for a terminal and name
 *  files, which is the right level there and too much detail in a panel.
 *
 *  The third entry is a note shown only while that step is the active one.
 *  Sync is the slow one and the one that looks broken: the app upserts the
 *  order-line table and holds the connection for minutes, so the step sits
 *  spinning with nothing to show. Saying how long it takes, at the moment it is
 *  taking that long, is the difference between waiting and assuming it hung. */
const STEPS: [string, string, [string, string]?][] = [
  ["동기화", "Sync", ["보통 몇 분 걸립니다", "usually a few minutes"]],
  ["수집", "Ingest"],
  ["분류", "Profile"],
  ["예측", "Forecast"],
];

/** Minimum 13, and not a free number. Each run replaces the stored forecast for
 *  its training week, so a shorter one shortens the forward curve, the order
 *  coverage window and every future accuracy score for that week. The server
 *  enforces the same floor; this stops the request being made at all. */
const HORIZONS = [13, 26, 52];

type Status = "idle" | "running" | "done" | "failed" | "cancelled";

/** Highest step the output has reached, 0 before the first line.
 *  Reads the last match rather than counting them, so a line that mentions an
 *  earlier step in passing cannot walk the progress backwards. */
function stepFrom(lines: string[]): number {
  let seen = 0;
  for (const line of lines) {
    const m = /Step (\d)\/4/.exec(line);
    if (m) seen = Math.max(seen, Number(m[1]));
  }
  return seen;
}

export function RunForecast({ onComplete }: { onComplete?: () => void }) {
  const { pick } = useI18n();
  const [horizon, setHorizon] = useState(13);
  const [status, setStatus] = useState<Status>("idle");
  const [lines, setLines] = useState<string[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  const step = stepFrom(lines);

  // Polling. Held in an effect keyed on the job so a completed run stops
  // polling on its own rather than needing the interval cleared from the
  // handler that started it.
  useEffect(() => {
    if (!jobId || status !== "running") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(apiPath(`/api/forecast/status/${jobId}`));
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body?.detail ?? body?.error ?? `HTTP ${res.status}`);
        setLines(body.lines ?? []);
        if (body.status && body.status !== "running" && body.status !== "cancelling") {
          setStatus(body.status === "done" ? "done" : body.status === "cancelled" ? "cancelled" : "failed");
          // Only on success. A failed or cancelled run leaves the previous
          // forecast in place, and refetching the page to show unchanged
          // numbers reads as though the failure had been applied.
          if (body.status === "done") onComplete?.();
        }
      } catch (err) {
        if (cancelled) return;
        // Polling failures are not run failures. The job continues on the
        // server; losing the connection to it is a reason to say so and keep
        // trying, not to report the forecast as broken.
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [jobId, status, onComplete]);

  // Follow the tail as lines arrive.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines]);

  const start = useCallback(async () => {
    setError(null);
    setLines([]);
    setStatus("running");
    try {
      const res = await fetch(apiPath(`/api/planning/run-forecast?horizon=${horizon}`), {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail ?? body?.error ?? `HTTP ${res.status}`);
      setJobId(body.job_id);
    } catch (err) {
      setStatus("failed");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [horizon]);

  // No cancel handler. The API's /cancel-forecast endpoint still exists and is
  // still generic, but this panel deliberately does not call it; see the note
  // beside the running indicator for why stopping this pipeline partway is
  // worse than letting it finish.

  const running = status === "running";

  return (
    <details className="group rounded-md border">
      <summary className="flex cursor-pointer select-none flex-wrap items-center gap-2 px-3 py-2.5 text-[13px] hover:bg-muted/50">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <span className="font-medium">{pick("예측 다시 실행", "Run forecast")}</span>
        <span className="text-[12px] text-muted-foreground">
          {pick(
            "최신 주문 데이터를 가져와 예측을 새로 만듭니다",
            "Pull the latest orders and produce a new forecast",
          )}
        </span>
        {running && (
          <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {pick(`${step}/4단계`, `step ${step} of 4`)}
          </span>
        )}
        {status === "done" && (
          <span className="flex items-center gap-1 text-[12px] text-emerald-600 dark:text-emerald-400">
            <Check className="h-3 w-3" /> {pick("완료", "done")}
          </span>
        )}
      </summary>

      <div className="flex flex-col gap-3 border-t px-3 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-[12.5px]">
            <span className="text-muted-foreground">{pick("예측 기간", "Horizon")}</span>
            <select
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
              disabled={running}
              className="h-8 rounded-md border bg-background px-2 text-[12.5px] disabled:opacity-50"
            >
              {HORIZONS.map((h) => (
                <option key={h} value={h}>{h}w</option>
              ))}
            </select>
          </label>

          {running ? (
            /* Deliberately not a Stop button.
             *
             * ml_prepare_data.py writes three artifacts in sequence -- sales,
             * then profiles, then the forecast -- with no transaction and no
             * rollback. Cancelling between any two leaves them describing
             * different weeks: fresh sales against stale segmentation, or fresh
             * segmentation against a stale forecast, which is exactly the drift
             * `demoted_since_forecast` exists to detect. A cancel that worked
             * would leave the data worse than one that did not.
             *
             * The first version of this panel had a Stop, and the first time it
             * was pressed the run continued to completion anyway. That was the
             * safe outcome reached by accident; this makes it the intended one.
             *
             * See BACKLOG for the real fix: write to temp paths and move them
             * into place together, after which cancelling is safe and the
             * button can come back. */
            <span className="flex h-8 items-center gap-1.5 rounded-md border border-dashed px-3 text-[12.5px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {pick("실행 중 · 중단할 수 없습니다", "running · cannot be interrupted")}
            </span>
          ) : (
            <button
              type="button"
              onClick={start}
              className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12.5px] font-medium text-primary-foreground hover:opacity-90"
            >
              <Play className="h-3 w-3" /> {pick("실행", "Run")}
            </button>
          )}

          {/* Said before anyone runs it, not after. This pipeline skips the
              legacy statsforecast stages, so the forecast on SKU Planning does
              not move; someone who ran this to fix a stale number there would
              otherwise conclude the button does nothing. */}
          <span className="text-[11.5px] leading-snug text-muted-foreground">
            {pick(
              "이 화면과 예측 검증 화면만 갱신됩니다. SKU 플래닝은 주간 자동 실행 결과를 계속 사용합니다.",
              "Updates this screen and Forecast Validation. SKU Planning keeps the weekly cron's forecast.",
            )}
          </span>
        </div>

        {/* One row of four, so the pipeline is legible before it is run rather
            than only while it happens. */}
        <ol className="flex flex-wrap gap-1.5">
          {STEPS.map(([ko, en, note], i) => {
            const n = i + 1;
            const state =
              status === "idle" ? "pending"
                : n < step ? "done"
                  : n === step ? (running ? "active" : status === "done" ? "done" : "stopped")
                    : status === "done" ? "done" : "pending";
            return (
              <li
                key={en}
                className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[12px] ${
                  state === "done"
                    ? "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400"
                    : state === "active"
                      ? "border-sky-400 bg-sky-50 font-medium dark:border-sky-700 dark:bg-sky-950"
                      : state === "stopped"
                        ? "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400"
                        : "text-muted-foreground"
                }`}
              >
                {state === "done" && <Check className="h-3 w-3" />}
                {state === "active" && <Loader2 className="h-3 w-3 animate-spin" />}
                {state === "stopped" && <X className="h-3 w-3" />}
                {pick(ko, en)}
                {note && state === "active" && (
                  <span className="font-normal text-muted-foreground">
                    {pick(note[0], note[1])}
                  </span>
                )}
              </li>
            );
          })}
        </ol>

        {error && (
          <p className="rounded-md border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-[12.5px] text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300">
            {error}
          </p>
        )}

        {status === "failed" && (
          <p className="text-[12.5px] text-muted-foreground">
            {pick(
              "실행이 실패했습니다. 이전 예측은 그대로이며, 화면의 수치는 변경되지 않았습니다.",
              "The run failed. The previous forecast is untouched, so the figures on this page have not changed.",
            )}
          </p>
        )}
        {/* Still handled, because a job can be cancelled from outside this
            panel: the API's /cancel-forecast endpoint is generic and the legacy
            Run Forecast screen can reach the same job type. If that happens the
            artifacts are mid-sequence and a reader needs telling. */}
        {status === "cancelled" && (
          <p className="rounded-md border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-[12.5px] leading-relaxed text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300">
            {pick(
              "실행이 외부에서 중단되었습니다. 이 파이프라인은 판매 데이터, 분류, 예측을 순서대로 기록하므로 중간에 멈추면 세 파일이 서로 다른 주를 가리킬 수 있습니다. 다시 실행해 완료하는 것을 권장합니다.",
              "The run was cancelled from outside this panel. This pipeline writes sales, then segmentation, then the forecast in sequence, so stopping partway can leave the three describing different weeks. Re-run it to completion.",
            )}
          </p>
        )}

        {/* The script's own output, verbatim. The step row above is a summary of
            it and drops the counts, the SKU totals and any warning the run
            printed, which are the things worth reading when something looks
            wrong. Collapsed, because most runs are not looked at closely. */}
        {lines.length > 0 && (
          <details>
            <summary className="cursor-pointer select-none text-[12px] text-muted-foreground hover:text-foreground">
              {pick(`실행 로그 (${lines.length}줄)`, `Run log (${lines.length} lines)`)}
            </summary>
            <pre
              ref={logRef}
              className="mt-1 max-h-56 overflow-auto rounded border bg-muted/40 p-2 text-[11.5px] leading-relaxed"
            >
              {lines.join("\n")}
            </pre>
          </details>
        )}
      </div>
    </details>
  );
}
