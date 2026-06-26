"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { ChevronLeft, ChevronRight, Download, Loader2, ScrollText, Search } from "lucide-react";
import { AppLayout } from "@/components/layout/app-layout";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

type AuditEntry = {
  id: string;
  containerId: string;
  containerNumber: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  note: string | null;
  ip: string | null;
  createdAt: string;
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

const ACTION_OPTIONS = [
  { value: "all", ko: "모든 변경 유형", en: "All actions" },
  { value: "status_change", ko: "상태 변경", en: "Status Change" },
  { value: "eta_change", ko: "ETA 수정", en: "ETA Change" },
  { value: "details_update", ko: "정보 수정", en: "Details Update" },
  { value: "items_update", ko: "수량/SKU 변경", en: "Item Change" },
  { value: "note_added", ko: "메모", en: "Note" },
  { value: "create", ko: "생성", en: "Create" },
  { value: "delete", ko: "삭제", en: "Delete" },
];

const ACTION_CLASS: Record<string, string> = {
  status_change: "bg-emerald-100 text-emerald-700",
  eta_change: "bg-amber-100 text-amber-700",
  details_update: "bg-blue-100 text-blue-700",
  items_update: "bg-violet-100 text-violet-700",
  note_added: "bg-stone-100 text-stone-700",
  create: "bg-cyan-100 text-cyan-700",
  delete: "bg-red-100 text-red-700",
};

function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultStartDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 6);
  return formatDateInput(date);
}

function formatTimestamp(raw: string): string {
  const date = new Date(raw);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

function getInitials(name: string | null, email: string | null): string {
  const source = name || email || "?";
  return source.slice(0, 2).toUpperCase();
}

function valueText(value: unknown): string {
  if (value == null || value === "") return "-";
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

function summarizeChange(entry: AuditEntry): { before: string; after: string } {
  if (entry.action === "status_change") {
    return {
      before: valueText(entry.before?.status),
      after: valueText(entry.after?.status),
    };
  }
  if (entry.action === "eta_change") {
    return {
      before: valueText(entry.before?.eta),
      after: valueText(entry.after?.eta),
    };
  }
  if (entry.action === "items_update") {
    return {
      before: `${valueText(entry.before?.skuCount)} SKUs / ${valueText(entry.before?.totalQty)} units`,
      after: `${valueText(entry.after?.skuCount)} SKUs / ${valueText(entry.after?.totalQty)} units`,
    };
  }
  if (entry.action === "details_update") {
    const keys = Object.keys(entry.after ?? {}).filter(
      (key) => valueText(entry.before?.[key]) !== valueText(entry.after?.[key]),
    );
    const first = keys[0];
    if (!first) return { before: "-", after: "-" };
    return {
      before: `${first}: ${valueText(entry.before?.[first])}`,
      after: `${first}: ${valueText(entry.after?.[first])}`,
    };
  }
  if (entry.action === "note_added") {
    return { before: "-", after: entry.note || "-" };
  }
  if (entry.action === "create") {
    return { before: "-", after: valueText(entry.after?.status ?? "Draft") };
  }
  if (entry.action === "delete") {
    return { before: valueText(entry.before?.status), after: "Deleted" };
  }
  return { before: "-", after: "-" };
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export default function AuditLogPage() {
  const { pick } = useI18n();
  const { data: session, status } = useSession();
  const [userSearch, setUserSearch] = useState("");
  const [containerSearch, setContainerSearch] = useState("");
  const [action, setAction] = useState("all");
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(() => formatDateInput(new Date()));
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryString = useCallback((page: number, exportAll = false, limitOverride?: number) => {
    const params = new URLSearchParams();
    if (userSearch.trim()) params.set("user", userSearch.trim());
    if (containerSearch.trim()) params.set("container", containerSearch.trim());
    if (action !== "all") params.set("action", action);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    params.set("page", String(page));
    params.set("limit", String(limitOverride ?? pagination.limit));
    if (exportAll) params.set("export", "1");
    return params.toString();
  }, [action, containerSearch, endDate, pagination.limit, startDate, userSearch]);

  const fetchLogs = useCallback(async (page = 1, limitOverride?: number) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(apiPath(`/api/admin/audit-log?${queryString(page, false, limitOverride)}`), { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to fetch audit logs");
      }
      setEntries(result.data ?? []);
      setPagination(result.pagination ?? { page, limit: 20, total: 0, totalPages: 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch audit logs");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    if (status === "authenticated") void fetchLogs(1);
  }, [fetchLogs, status]);

  const actionLabel = useMemo(() => {
    const map = new Map(ACTION_OPTIONS.map((item) => [item.value, pick(item.ko, item.en)]));
    return (value: string) => map.get(value) ?? value;
  }, [pick]);

  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    try {
      const response = await fetch(apiPath(`/api/admin/audit-log?${queryString(1, true)}`), { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "Export failed");
      const rows = (result.data ?? []) as AuditEntry[];
      const header = ["Time", "User", "Container", "Action", "Before", "After", "Note"];
      const lines = rows.map((entry) => {
        const change = summarizeChange(entry);
        return [
          formatTimestamp(entry.createdAt),
          entry.userName || entry.userEmail || "System",
          entry.containerNumber || entry.containerId,
          actionLabel(entry.action),
          change.before,
          change.after,
          entry.note || "",
        ].map(csvEscape).join(",");
      });
      const csvContent = `\uFEFF${[header.map(csvEscape).join(","), ...lines].join("\r\n")}`;
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `audit-log-${startDate || "all"}-${endDate || "all"}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppLayout>
      <section className="relative left-1/2 flex min-h-[calc(100vh-7rem)] w-[min(1600px,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0] text-foreground shadow-sm dark:border-slate-700 dark:bg-slate-950">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-start gap-2">
            <ScrollText className="mt-1 h-5 w-5" />
            <div>
              <h1 className="text-lg font-semibold">Audit Log</h1>
              <p className="mt-1 text-xs text-muted-foreground">{pick("컨테이너 상태 변경 추적", "Container status change tracking")}</p>
            </div>
          </div>
          <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
            {pagination.total.toLocaleString()} {pick("건", "logs")}
          </span>
        </header>

        {(
          <div className="flex min-h-0 flex-1 flex-col bg-white dark:bg-slate-950">
            <section className="border-b border-[#e2dfd8] px-5 py-4 dark:border-slate-700">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="h-10 min-w-[180px] flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-[#1a5cdb] dark:border-slate-700 dark:bg-slate-950"
                  placeholder={pick("사용자 검색...", "Search user...")}
                  value={userSearch}
                  onChange={(event) => setUserSearch(event.target.value)}
                />
                <input
                  className="h-10 min-w-[190px] flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-[#1a5cdb] dark:border-slate-700 dark:bg-slate-950"
                  placeholder={pick("컨테이너 ID...", "Container ID...")}
                  value={containerSearch}
                  onChange={(event) => setContainerSearch(event.target.value)}
                />
                <select
                  className="h-10 min-w-[170px] rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-[#1a5cdb] dark:border-slate-700 dark:bg-slate-950"
                  value={action}
                  onChange={(event) => setAction(event.target.value)}
                >
                  {ACTION_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{pick(item.ko, item.en)}</option>
                  ))}
                </select>
                <input
                  className="h-10 w-[145px] rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-[#1a5cdb] dark:border-slate-700 dark:bg-slate-950"
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
                <input
                  className="h-10 w-[145px] rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-[#1a5cdb] dark:border-slate-700 dark:bg-slate-950"
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => void fetchLogs(1)}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-[#cccac4] bg-white px-4 text-sm font-medium hover:bg-[#f8f7f4] dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-900"
                >
                  <Search className="h-4 w-4" />
                  {pick("검색", "Search")}
                </button>
                <button
                  type="button"
                  onClick={() => void exportCsv()}
                  disabled={exporting}
                  className="ml-auto inline-flex h-10 items-center gap-2 rounded-md border border-[#cccac4] bg-white px-4 text-sm font-medium hover:bg-[#f8f7f4] disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-900"
                >
                  {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {pick("CSV 내보내기", "Export CSV")}
                </button>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#e2dfd8] pt-4 text-sm text-muted-foreground dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <span>{pick("행", "Rows")}</span>
                  <select
                    value={pagination.limit}
                    onChange={(event) => {
                      const nextLimit = Number(event.target.value);
                      setPagination((current) => ({ ...current, page: 1, limit: nextLimit }));
                      void fetchLogs(1, nextLimit);
                    }}
                    className="h-8 rounded-md border bg-background px-2 text-foreground dark:border-slate-700 dark:bg-slate-950"
                  >
                    {[10, 20, 50].map((size) => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                </div>
                <span>
                  {pick("페이지", "Page")} {pagination.total === 0 ? 0 : pagination.page} {pick("/", "of")} {pagination.total === 0 ? 0 : pagination.totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={pagination.page <= 1 || loading}
                    onClick={() => void fetchLogs(pagination.page - 1)}
                    className="h-8 rounded-md border border-[#cccac4] bg-white px-3 text-sm text-foreground hover:bg-[#f8f7f4] disabled:opacity-40 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-900"
                  >
                    {pick("이전", "Previous")}
                  </button>
                  <button
                    type="button"
                    disabled={pagination.page >= pagination.totalPages || pagination.total === 0 || loading}
                    onClick={() => void fetchLogs(pagination.page + 1)}
                    className="h-8 rounded-md border border-[#cccac4] bg-white px-3 text-sm text-foreground hover:bg-[#f8f7f4] disabled:opacity-40 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-900"
                  >
                    {pick("다음", "Next")}
                  </button>
                </div>
              </div>
            </section>

            {error ? (
              <div className="mx-5 mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            ) : null}

            <section className="m-5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-[#e2dfd8] bg-white dark:border-slate-700 dark:bg-slate-950">
              <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full min-w-[980px] text-sm">
                  <thead className="sticky top-0 z-10 bg-[#f8f7f4] text-xs text-muted-foreground dark:bg-slate-900">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold">{pick("일시", "Time")}</th>
                      <th className="px-4 py-2 text-left font-semibold">{pick("사용자", "User")}</th>
                      <th className="px-4 py-2 text-left font-semibold">{pick("컨테이너", "Container")}</th>
                      <th className="px-4 py-2 text-left font-semibold">{pick("변경 유형", "Action")}</th>
                      <th className="px-4 py-2 text-left font-semibold">{pick("변경 전", "Before")}</th>
                      <th className="px-4 py-2 text-left font-semibold">{pick("변경 후", "After")}</th>
                      <th className="px-4 py-2 text-left font-semibold">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                          {pick("불러오는 중...", "Loading...")}
                        </td>
                      </tr>
                    ) : entries.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                          {pick("검색 조건에 해당하는 로그가 없습니다.", "No logs match the filters.")}
                        </td>
                      </tr>
                    ) : entries.map((entry) => {
                      const change = summarizeChange(entry);
                      return (
                        <tr key={entry.id} className="border-t border-[#f0ede7]">
                          <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-muted-foreground">{formatTimestamp(entry.createdAt)}</td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-700">
                                {getInitials(entry.userName, entry.userEmail)}
                              </span>
                              <span className="font-medium">{entry.userName || entry.userEmail || "System"}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2 font-mono text-xs font-semibold text-[#1a5cdb]">{entry.containerNumber || entry.containerId}</td>
                          <td className="px-4 py-2">
                            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${ACTION_CLASS[entry.action] ?? "bg-stone-100 text-stone-700"}`}>
                              {actionLabel(entry.action)}
                            </span>
                          </td>
                          <td className="max-w-[210px] truncate px-4 py-2 text-muted-foreground line-through decoration-[#8d867c]">{change.before}</td>
                          <td className="max-w-[210px] truncate px-4 py-2 font-semibold">{change.after}</td>
                          <td className="max-w-[260px] truncate px-4 py-2 text-muted-foreground">{entry.note || "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="hidden">
              <button
                type="button"
                disabled={pagination.page <= 1 || loading}
                onClick={() => void fetchLogs(pagination.page - 1)}
                className="flex h-9 w-12 items-center justify-center rounded-md border border-[#cccac4] bg-white disabled:opacity-40 dark:border-slate-700 dark:bg-slate-950"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm text-muted-foreground">
                {pagination.page} / {pagination.totalPages} {pick("페이지", "pages")} ({pick("총", "total")} {pagination.total.toLocaleString()}{pick("건", " logs")})
              </span>
              <button
                type="button"
                disabled={pagination.page >= pagination.totalPages || loading}
                onClick={() => void fetchLogs(pagination.page + 1)}
                className="flex h-9 w-12 items-center justify-center rounded-md border border-[#cccac4] bg-white disabled:opacity-40 dark:border-slate-700 dark:bg-slate-950"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </section>
    </AppLayout>
  );
}
