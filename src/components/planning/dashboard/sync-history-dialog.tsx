"use client";

import { useCallback, useState } from "react";
import { History, RefreshCw } from "lucide-react";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SyncResultDetails } from "./sync-result-details";

type RefreshStatus = "queued" | "running" | "succeeded" | "failed";

type RefreshJob = {
  id: string;
  status: RefreshStatus;
  result: Record<string, unknown> | null;
  error: string | null;
  requested_by_email: string | null;
  source: string;
  correlation_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

type HistoryResponse = {
  success: boolean;
  data?: RefreshJob[];
  error?: string;
  pagination?: { page: number; limit: number; total: number; totalPages: number };
};

const STATUS_STYLE: Record<RefreshStatus, string> = {
  queued: "border-amber-200 bg-amber-50 text-amber-800",
  running: "border-blue-200 bg-blue-50 text-blue-800",
  succeeded: "border-emerald-200 bg-emerald-50 text-emerald-800",
  failed: "border-red-200 bg-red-50 text-red-800",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function duration(job: RefreshJob): string {
  if (!job.started_at) return "—";
  const end = job.finished_at ? new Date(job.finished_at).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - new Date(job.started_at).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function resultSummary(result: Record<string, unknown> | null): string {
  if (!result) return "—";
  const values = [
    ["Inventory", result.inventoryUpserted],
    ["Link", result.linkSalesUpserted],
    ["Custom", result.customSalesUpserted],
    ["SKU", result.productsBackfilled],
  ].filter((entry): entry is [string, number] => typeof entry[1] === "number");
  const parts = values.map(([label, value]) => `${label} ${value.toLocaleString()}`);
  const workbench = workbenchSummary(result.workbench);
  if (workbench) parts.push(workbench);
  return parts.length ? parts.join(" · ") : "—";
}

/** The container push to Workbench that runs with each Sync; absent on older jobs. */
function workbenchSummary(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const push = value as Record<string, unknown>;
  const count = (key: string) => (typeof push[key] === "number" ? (push[key] as number) : 0);
  // Containers DP could not send (no or unknown destination warehouse); without
  // this, a push that sent nothing reads as "0 new, 0 updated".
  const skipped = count("skipped") > 0 ? `, ${count("skipped")} skipped` : "";
  const missing = count("missingSkuCount") > 0 ? ` (${count("missingSkuCount").toLocaleString()} SKUs missing)` : "";
  switch (push.status) {
    case "skipped":
      return "Workbench off";
    case "succeeded":
      return `Workbench ${count("created")} new, ${count("updated")} updated${skipped}`;
    case "partial":
      return `Workbench ${count("sent")} sent, ${count("failed")} failed${skipped}${missing}`;
    case "failed":
      return "Workbench failed";
    default:
      return null;
  }
}

export function SyncHistoryDialog() {
  const { pick } = useI18n();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<RefreshStatus | "">("");
  const [jobs, setJobs] = useState<RefreshJob[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextPage = page, nextStatus: RefreshStatus | "" = status) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(nextPage), limit: "20" });
      if (nextStatus) params.set("status", nextStatus);
      const response = await fetch(apiPath(`/api/planning/stats/refresh?${params}`), { cache: "no-store" });
      const body = await response.json() as HistoryResponse;
      if (!response.ok || !body.success || !body.data || !body.pagination) {
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      setJobs(body.data);
      setPagination(body.pagination);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load Sync history");
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  const selectedJob = expandedId ? jobs.find((job) => job.id === expandedId) ?? null : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) void load();
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex min-h-8 items-center gap-1.5 rounded border border-[#c2bfb5] bg-white px-3 text-xs font-semibold text-[#1a1917] transition-colors hover:bg-[#f5f4ef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          <History className="h-3.5 w-3.5" aria-hidden="true" />
          {pick("동기화 이력", "Sync History")}
        </button>
      </DialogTrigger>
      <DialogContent className="flex h-[min(1060px,88vh)] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(2200px,calc(100vw-4rem))]">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <DialogTitle>{pick("Demand Planning 동기화 이력", "Demand Planning Sync History")}</DialogTitle>
              <DialogDescription className="mt-1">
                {pick("최근 실행 결과, 실행자와 오류를 확인합니다.", "Review recent runs, requesters, results, and errors.")}
              </DialogDescription>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
              {pick("새로고침", "Refresh")}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2" aria-label={pick("상태 필터", "Status filter")}>
            {(["", "succeeded", "failed", "running", "queued"] as const).map((value) => (
              <button
                key={value || "all"}
                type="button"
                aria-pressed={status === value}
                onClick={() => {
                  setStatus(value);
                  setPage(1);
                  setExpandedId(null);
                  void load(1, value);
                }}
                className={`min-h-8 rounded-full border px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${status === value ? "border-[#1a1917] bg-[#1a1917] text-white" : "border-[#d8d5ce] bg-white text-[#57534e] hover:bg-[#f5f4ef]"}`}
              >
                {value ? value[0].toUpperCase() + value.slice(1) : pick("전체", "All")}
              </button>
            ))}
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,7fr)_minmax(300px,3fr)]" aria-busy={loading}>
          <div className="min-h-0 overflow-auto lg:overflow-x-hidden lg:border-r">
            {error ? (
              <div className="m-5 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
                <div className="font-semibold">{pick("이력을 불러오지 못했습니다.", "Could not load Sync history.")}</div>
                <div className="mt-1 break-words">{error}</div>
                <button type="button" onClick={() => void load()} className="mt-3 rounded border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
                  {pick("다시 시도", "Try again")}
                </button>
              </div>
            ) : jobs.length === 0 && !loading ? (
              <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center text-sm text-muted-foreground">
                <History className="mb-3 h-8 w-8 opacity-40" aria-hidden="true" />
                {pick("표시할 동기화 이력이 없습니다.", "No Sync history to display.")}
              </div>
            ) : (
              <div className="overflow-x-auto lg:overflow-x-hidden">
              <table className="w-full min-w-[820px] border-collapse text-left text-xs lg:min-w-0">
                <thead className="sticky top-0 z-10 bg-[#f8f7f3] text-[#57534e]">
                  <tr className="border-b">
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold">Started (LA)</th>
                    <th className="px-3 py-2.5 font-semibold">Duration</th>
                    <th className="px-3 py-2.5 font-semibold">Requested by</th>
                    <th className="px-3 py-2.5 font-semibold">Source</th>
                    <th className="px-3 py-2.5 font-semibold">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => {
                    const expanded = expandedId === job.id;
                    return (
                      <tr
                        key={job.id}
                        tabIndex={0}
                        aria-selected={expanded}
                        onClick={() => setExpandedId(job.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setExpandedId(job.id);
                          }
                        }}
                        className={`cursor-pointer border-b align-top outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${expanded ? "bg-blue-50/70" : "hover:bg-[#faf9f6]"}`}
                      >
                        <td className="px-3 py-3">
                          <span className={`inline-flex rounded-full border px-2 py-1 font-semibold ${STATUS_STYLE[job.status]}`}>{job.status}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 font-mono tabular-nums">{formatDate(job.started_at ?? job.created_at)}</td>
                        <td className="whitespace-nowrap px-3 py-3 font-mono tabular-nums">{duration(job)}</td>
                        <td className="max-w-48 px-3 py-3"><span className="break-all">{job.requested_by_email ?? "—"}</span></td>
                        <td className="max-w-56 px-3 py-3"><span className="break-all">{job.source || "—"}</span></td>
                        <td className="max-w-72 px-3 py-3 text-[#57534e]">{job.error ? <span className="text-red-700">{job.error}</span> : resultSummary(job.result)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </div>

          <aside className="min-h-[220px] overflow-auto border-t bg-[#faf9f6] p-5 text-xs lg:border-t-0" aria-label={pick("선택한 동기화 상세", "Selected Sync details")}>
            {selectedJob ? (
              <div>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-[#1a1917]">{pick("동기화 상세", "Sync Details")}</h3>
                  <span className={`inline-flex rounded-full border px-2 py-1 font-semibold ${STATUS_STYLE[selectedJob.status]}`}>{selectedJob.status}</span>
                </div>
                <dl className="grid gap-y-4">
                  <div><dt className="font-semibold text-muted-foreground">Requested by</dt><dd className="mt-1 break-all">{selectedJob.requested_by_email ?? "—"}</dd></div>
                  <div><dt className="font-semibold text-muted-foreground">Source</dt><dd className="mt-1 break-all">{selectedJob.source || "—"}</dd></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><dt className="font-semibold text-muted-foreground">Started (LA)</dt><dd className="mt-1 font-mono tabular-nums">{formatDate(selectedJob.started_at ?? selectedJob.created_at)}</dd></div>
                    <div><dt className="font-semibold text-muted-foreground">Finished (LA)</dt><dd className="mt-1 font-mono tabular-nums">{formatDate(selectedJob.finished_at)}</dd></div>
                  </div>
                  <div><dt className="font-semibold text-muted-foreground">Job ID</dt><dd className="mt-1 break-all font-mono">{selectedJob.id}</dd></div>
                  <div><dt className="font-semibold text-muted-foreground">Correlation ID</dt><dd className="mt-1 break-all font-mono">{selectedJob.correlation_id ?? "—"}</dd></div>
                  {selectedJob.error ? <div><dt className="font-semibold text-red-700">Error</dt><dd className="mt-1 rounded-md border border-red-200 bg-red-50 p-3 break-words text-red-800">{selectedJob.error}</dd></div> : null}
                  <div>
                    <dt className="font-semibold text-muted-foreground">Result</dt>
                    <dd className="mt-1">{selectedJob.result ? <SyncResultDetails result={selectedJob.result} pick={pick} /> : "—"}</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <div className="flex h-full min-h-48 flex-col items-center justify-center text-center text-muted-foreground">
                <History className="mb-3 h-8 w-8 opacity-35" aria-hidden="true" />
                <div className="font-medium text-[#57534e]">{pick("이력을 선택하세요", "Select a Sync run")}</div>
                <div className="mt-1 max-w-60 leading-5">{pick("왼쪽 목록에서 행을 클릭하면 상세 정보가 여기에 표시됩니다.", "Select a row in the list to show its details here.")}</div>
              </div>
            )}
          </aside>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-[#f8f7f3] px-5 py-3 text-xs">
          <span className="text-muted-foreground">{pagination.total.toLocaleString()} {pick("건", "runs")}</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={page <= 1 || loading} onClick={() => { const next = Math.max(1, page - 1); setPage(next); setExpandedId(null); void load(next, status); }} className="min-h-8 rounded border bg-white px-3 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40">{pick("이전", "Previous")}</button>
            <span className="min-w-16 text-center font-mono tabular-nums">{pagination.page} / {pagination.totalPages}</span>
            <button type="button" disabled={page >= pagination.totalPages || loading} onClick={() => { const next = Math.min(pagination.totalPages, page + 1); setPage(next); setExpandedId(null); void load(next, status); }} className="min-h-8 rounded border bg-white px-3 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40">{pick("다음", "Next")}</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
