"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, Loader2, ScrollText, Search, X } from "lucide-react";
import { AppLayout } from "@/components/layout/app-layout";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { isAdminLikeRole } from "@/components/layout/navigation-config";
import { usePermissions } from "@/lib/hooks/use-permissions";

type AuditEntry = {
  id: string;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
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
  { value: "create", ko: "생성", en: "Create" },
  { value: "update", ko: "정보 수정", en: "Update" },
  { value: "delete", ko: "삭제", en: "Delete" },
  { value: "status_change", ko: "상태 변경", en: "Status Change" },
  { value: "details_update", ko: "정보 수정", en: "Details Update" },
  { value: "eta_change", ko: "ETA 수정", en: "ETA Change" },
  { value: "items_update", ko: "수량/SKU 변경", en: "Item Change" },
  { value: "note_added", ko: "메모", en: "Note" },
  { value: "recompare", ko: "재검수", en: "Recompare" },
  { value: "credit_update", ko: "Credit 상태 변경", en: "Credit Status Change" },
  { value: "factory_confirm_update", ko: "공장 확인 상태 변경", en: "Factory Confirmation Change" },
  { value: "attachment_update", ko: "첨부파일 변경", en: "Attachment Update" },
  { value: "credit_note_create", ko: "Credit 생성", en: "Credit Note Created" },
  { value: "credit_note_status_change", ko: "Credit 상태 변경", en: "Credit Note Status Change" },
  { value: "permission_grant", ko: "권한 부여", en: "Permission Grant" },
  { value: "permission_revoke", ko: "권한 취소", en: "Permission Revoke" },
  { value: "role_change", ko: "역할 변경", en: "Role Change" },
  { value: "config_update", ko: "연동 설정 변경", en: "Config Update" },
];

const ENTITY_TYPE_OPTIONS = [
  { value: "all", ko: "모든 유형", en: "All types" },
  { value: "container", ko: "컨테이너", en: "Container" },
  { value: "invoice", ko: "Invoice", en: "Invoice" },
  { value: "factory", ko: "공장", en: "Factory" },
  { value: "warehouse", ko: "창고", en: "Warehouse" },
  { value: "sku", ko: "SKU 기준정보", en: "SKU Master" },
  { value: "user_permission", ko: "권한 설정", en: "User Permission" },
  { value: "user_role", ko: "역할 변경", en: "User Role" },
  { value: "integration", ko: "연동 설정", en: "Integration" },
];

const ACTION_CLASS: Record<string, string> = {
  status_change: "bg-emerald-100 text-emerald-700",
  eta_change: "bg-amber-100 text-amber-700",
  details_update: "bg-blue-100 text-blue-700",
  items_update: "bg-violet-100 text-violet-700",
  note_added: "bg-stone-100 text-stone-700",
  recompare: "bg-sky-100 text-sky-700",
  credit_update: "bg-fuchsia-100 text-fuchsia-700",
  factory_confirm_update: "bg-amber-100 text-amber-700",
  attachment_update: "bg-stone-100 text-stone-700",
  credit_note_create: "bg-fuchsia-100 text-fuchsia-700",
  credit_note_status_change: "bg-fuchsia-100 text-fuchsia-700",
  create: "bg-cyan-100 text-cyan-700",
  update: "bg-blue-100 text-blue-700",
  delete: "bg-red-100 text-red-700",
  permission_grant: "bg-teal-100 text-teal-700",
  permission_revoke: "bg-orange-100 text-orange-700",
  role_change: "bg-indigo-100 text-indigo-700",
  config_update: "bg-purple-100 text-purple-700",
};

const ENTITY_TYPE_CLASS: Record<string, string> = {
  container: "bg-slate-100 text-slate-600",
  invoice: "bg-amber-50 text-amber-700",
  factory: "bg-orange-50 text-orange-700",
  warehouse: "bg-teal-50 text-teal-700",
  sku: "bg-purple-50 text-purple-700",
  user_permission: "bg-blue-50 text-blue-700",
  user_role: "bg-indigo-50 text-indigo-700",
  integration: "bg-pink-50 text-pink-700",
};

const ENTITY_TYPE_LABEL_KO: Record<string, string> = {
  container: "컨테이너",
  invoice: "Invoice",
  factory: "공장",
  warehouse: "창고",
  sku: "SKU",
  user_permission: "권한",
  user_role: "역할",
  integration: "연동",
};

const ENTITY_TYPE_LABEL_EN: Record<string, string> = {
  container: "Container",
  invoice: "Invoice",
  factory: "Factory",
  warehouse: "Warehouse",
  sku: "SKU",
  user_permission: "Permission",
  user_role: "Role",
  integration: "Integration",
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
  // Container-specific actions
  if (entry.entityType === "container") {
    if (entry.action === "status_change") {
      return { before: valueText(entry.before?.status), after: valueText(entry.after?.status) };
    }
    if (entry.action === "eta_change") {
      return { before: valueText(entry.before?.eta), after: valueText(entry.after?.eta) };
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

  // Invoice-specific actions
  if (entry.entityType === "invoice") {
    if (entry.action === "status_change") {
      return { before: valueText(entry.before?.status), after: valueText(entry.after?.status) };
    }
    if (entry.action === "details_update" || entry.action === "items_update") {
      const keys = Object.keys(entry.after ?? {}).filter(
        (key) => key !== "itemId" && valueText(entry.before?.[key]) !== valueText(entry.after?.[key]),
      );
      const first = keys[0];
      if (!first) return { before: "-", after: "-" };
      return {
        before: `${first}: ${valueText(entry.before?.[first])}`,
        after: `${first}: ${valueText(entry.after?.[first])}`,
      };
    }
    if (entry.action === "recompare") {
      return { before: "-", after: "재검수 완료" };
    }
    if (entry.action === "credit_update") {
      return { before: "-", after: `Credit: ${valueText(entry.after?.creditStatus)}` };
    }
    if (entry.action === "factory_confirm_update") {
      return { before: "-", after: `공장 확인: ${valueText(entry.after?.action)}` };
    }
    if (entry.action === "attachment_update") {
      return { before: "-", after: entry.after?.signed ? "서명본 첨부" : "원본 첨부" };
    }
    if (entry.action === "credit_note_create") {
      return { before: "-", after: `${valueText(entry.after?.sku)} · ${valueText(entry.after?.creditAmount)}` };
    }
    if (entry.action === "credit_note_status_change") {
      if (entry.after?.deleted) return { before: valueText(entry.before?.status), after: "Credit 삭제됨" };
      return { before: valueText(entry.before?.status), after: valueText(entry.after?.status) };
    }
    if (entry.action === "create") {
      return { before: "-", after: entry.entityLabel || "생성됨" };
    }
    if (entry.action === "delete") {
      return { before: entry.entityLabel || "-", after: "Deleted" };
    }
    return { before: "-", after: "-" };
  }

  // General entity actions
  if (entry.action === "create") {
    const label = entry.entityLabel || entry.entityId;
    return { before: "-", after: label };
  }
  if (entry.action === "delete") {
    const label = entry.entityLabel || entry.entityId;
    return { before: label, after: "비활성화" };
  }
  if (entry.action === "status_change") {
    return {
      before: entry.before?.isActive === true ? "활성" : "비활성",
      after: entry.after?.isActive === true ? "활성" : "비활성",
    };
  }
  if (entry.action === "update" || entry.action === "config_update") {
    const afterKeys = Object.keys(entry.after ?? {});
    const changed = afterKeys.find(
      (k) => entry.before != null && valueText(entry.before[k]) !== valueText(entry.after?.[k]),
    ) ?? afterKeys[0];
    if (!changed) return { before: "-", after: "-" };
    return {
      before: `${changed}: ${valueText(entry.before?.[changed])}`,
      after: `${changed}: ${valueText(entry.after?.[changed])}`,
    };
  }
  if (entry.action === "role_change") {
    return {
      before: valueText(entry.before?.role),
      after: valueText(entry.after?.role),
    };
  }
  if (entry.action === "permission_grant") {
    const { section, action, allowed } = (entry.after ?? {}) as Record<string, unknown>;
    return { before: "-", after: `${section}.${action} = ${allowed}` };
  }
  if (entry.action === "permission_revoke") {
    const { section, action } = (entry.before ?? {}) as Record<string, unknown>;
    return { before: `${section}.${action}`, after: "취소됨" };
  }
  return { before: "-", after: "-" };
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export default function AuditLogPage() {
  const { pick } = useI18n();
  const { data: session, status } = useSession();
  const router = useRouter();
  const { can } = usePermissions();
  const [userSearch, setUserSearch] = useState("");
  const [entitySearch, setEntitySearch] = useState("");
  const [entityTypeFilter, setEntityTypeFilter] = useState("all");
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
    if (entitySearch.trim()) params.set("entity", entitySearch.trim());
    if (entityTypeFilter !== "all") params.set("entityType", entityTypeFilter);
    if (action !== "all") params.set("action", action);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    params.set("page", String(page));
    params.set("limit", String(limitOverride ?? pagination.limit));
    if (exportAll) params.set("export", "1");
    return params.toString();
  }, [action, entitySearch, entityTypeFilter, endDate, pagination.limit, startDate, userSearch]);

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
    if (status !== "authenticated") return;
    const timer = window.setTimeout(() => void fetchLogs(1), 0);
    return () => window.clearTimeout(timer);
  }, [fetchLogs, status]);

  const actionLabel = useMemo(() => {
    const map = new Map(ACTION_OPTIONS.map((item) => [item.value, pick(item.ko, item.en)]));
    return (value: string) => map.get(value) ?? value;
  }, [pick]);

  const entityTypeLabel = (type: string) =>
    pick(ENTITY_TYPE_LABEL_KO[type] ?? type, ENTITY_TYPE_LABEL_EN[type] ?? type);
  const canOpenUserManagement =
    isAdminLikeRole(session?.user?.role) || can("user-permissions", "read");

  function openUserDetail(userId: string | null) {
    if (!userId || !canOpenUserManagement) return;
    router.push(`/settings/users?userId=${encodeURIComponent(userId)}`);
  }

  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    try {
      const response = await fetch(apiPath(`/api/admin/audit-log?${queryString(1, true)}`), { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "Export failed");
      const rows = (result.data ?? []) as AuditEntry[];
      const header = ["Time", "User", "Type", "Entity", "Action", "Before", "After", "Note"];
      const lines = rows.map((entry) => {
        const change = summarizeChange(entry);
        return [
          formatTimestamp(entry.createdAt),
          entry.userName || entry.userEmail || "System",
          entityTypeLabel(entry.entityType),
          entry.entityLabel || entry.entityId,
          actionLabel(entry.action),
          change.before,
          change.after,
          entry.note || "",
        ].map(csvEscape).join(",");
      });
      const csvContent = `﻿${[header.map(csvEscape).join(","), ...lines].join("\r\n")}`;
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
              <p className="mt-1 text-xs text-muted-foreground">{pick("공장·창고·SKU·권한·연동 변경 이력", "Factory, warehouse, SKU, permission, and integration change history")}</p>
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
                <div className="relative min-w-[160px] flex-1">
                  <input
                    className="h-10 w-full rounded-md border border-input bg-background px-3 pr-9 text-sm outline-none focus:border-[#1a5cdb] dark:border-slate-700 dark:bg-slate-950"
                    placeholder={pick("사용자 검색...", "Search user...")}
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                  />
                  {userSearch ? (
                    <button
                      type="button"
                      aria-label={pick("사용자 검색어 초기화", "Clear user search")}
                      onClick={() => setUserSearch("")}
                      className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-slate-100 hover:text-foreground dark:hover:bg-slate-800"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
                <div className="relative min-w-[260px] flex-1">
                  <input
                    className="h-10 w-full rounded-md border border-input bg-background px-3 pr-9 text-sm outline-none focus:border-[#1a5cdb] dark:border-slate-700 dark:bg-slate-950"
                    placeholder={pick("대상 검색(이름, ID, 컨테이너 번호, 인보이스 번호)...", "Entity (name, ID, container number)...")}
                    value={entitySearch}
                    onChange={(event) => setEntitySearch(event.target.value)}
                  />
                  {entitySearch ? (
                    <button
                      type="button"
                      aria-label={pick("대상 검색어 초기화", "Clear target search")}
                      onClick={() => setEntitySearch("")}
                      className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-slate-100 hover:text-foreground dark:hover:bg-slate-800"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
                <select
                  className="h-10 min-w-[140px] rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-[#1a5cdb] dark:border-slate-700 dark:bg-slate-950"
                  value={entityTypeFilter}
                  onChange={(event) => setEntityTypeFilter(event.target.value)}
                >
                  {ENTITY_TYPE_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{pick(item.ko, item.en)}</option>
                  ))}
                </select>
                <select
                  className="h-10 min-w-[155px] rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-[#1a5cdb] dark:border-slate-700 dark:bg-slate-950"
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
                <table className="w-full min-w-[1020px] text-sm">
                  <thead className="sticky top-0 z-10 bg-[#f8f7f4] text-xs text-muted-foreground dark:bg-slate-900">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold">{pick("일시", "Time")}</th>
                      <th className="px-4 py-2 text-left font-semibold">{pick("사용자", "User")}</th>
                      <th className="px-4 py-2 text-left font-semibold">{pick("유형", "Type")}</th>
                      <th className="px-4 py-2 text-left font-semibold">{pick("대상", "Entity")}</th>
                      <th className="px-4 py-2 text-left font-semibold">{pick("변경 유형", "Action")}</th>
                      <th className="px-4 py-2 text-left font-semibold">{pick("변경 전", "Before")}</th>
                      <th className="px-4 py-2 text-left font-semibold">{pick("변경 후", "After")}</th>
                      <th className="px-4 py-2 text-left font-semibold">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                          {pick("불러오는 중...", "Loading...")}
                        </td>
                      </tr>
                    ) : entries.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                          {pick("검색 조건에 해당하는 로그가 없습니다.", "No logs match the filters.")}
                        </td>
                      </tr>
                    ) : entries.map((entry) => {
                      const change = summarizeChange(entry);
                      return (
                        <tr key={entry.id} className="border-t border-[#f0ede7]">
                          <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-muted-foreground">{formatTimestamp(entry.createdAt)}</td>
                          <td className="px-4 py-2">
                            <button
                              type="button"
                              disabled={!entry.userId || !canOpenUserManagement}
                              onClick={() => openUserDetail(entry.userId)}
                              className={`flex items-center gap-2 text-left ${
                                entry.userId && canOpenUserManagement
                                  ? "rounded-md hover:text-[#1a5cdb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a5cdb]"
                                  : "cursor-default"
                              }`}
                              title={
                                entry.userId && canOpenUserManagement
                                  ? pick("사용자 관리에서 보기", "View in user management")
                                  : undefined
                              }
                            >
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-700">
                                {getInitials(entry.userName, entry.userEmail)}
                              </span>
                              <span className="font-medium">{entry.userName || entry.userEmail || "System"}</span>
                            </button>
                          </td>
                          <td className="px-4 py-2">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ENTITY_TYPE_CLASS[entry.entityType] ?? "bg-stone-100 text-stone-600"}`}>
                              {entityTypeLabel(entry.entityType)}
                            </span>
                          </td>
                          <td className="max-w-[160px] truncate px-4 py-2 font-mono text-xs font-semibold text-[#1a5cdb]">
                            {entry.entityLabel || entry.entityId}
                          </td>
                          <td className="px-4 py-2">
                            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${ACTION_CLASS[entry.action] ?? "bg-stone-100 text-stone-700"}`}>
                              {actionLabel(entry.action)}
                            </span>
                          </td>
                          <td className="max-w-[200px] truncate px-4 py-2 text-muted-foreground line-through decoration-[#8d867c]">{change.before}</td>
                          <td className="max-w-[200px] truncate px-4 py-2 font-semibold">{change.after}</td>
                          <td className="max-w-[220px] truncate px-4 py-2 text-muted-foreground">{entry.note || "-"}</td>
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
