"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2, RefreshCw, Search, Users } from "lucide-react";
import { apiPath } from "@/lib/api-path";
import { ACTIVITY_TIME_ZONE } from "@/lib/activity-date";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type PeriodDays = 7 | 30 | 90;
type ActivityFilter = "all" | "today" | "period" | "none";

interface ActivityResponse {
  timeZone: string;
  summary: { today: number; last7Days: number; last30Days: number };
  trend: Array<{ date: string; activeUsers: number }>;
  users: Array<{
    id: string;
    name: string | null;
    email: string;
    role: string;
    lastSeenAt: string | null;
    activityDays: number;
    lastPath: string | null;
    activeToday: boolean;
  }>;
}

export function UserActivityTab() {
  const { pick } = useI18n();
  const [period, setPeriod] = useState<PeriodDays>(30);
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("all");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);

  useEffect(() => {
    let cancelled = false;

    async function loadActivity() {
      setLoading(true);
      try {
        const response = await fetch(apiPath(`/api/admin/user-activity?days=${period}`), { cache: "no-store" });
        const responseText = await response.text();
        const result = responseText ? JSON.parse(responseText) : null;
        if (!response.ok || !result?.success) throw new Error(result?.error || "Failed to load user activity");
        if (!cancelled) {
          setData(result.data as ActivityResponse);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load user activity");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadActivity();
    return () => { cancelled = true; };
  }, [period, refreshKey]);

  const roles = useMemo(
    () => [...new Set((data?.users ?? []).map((user) => user.role))].sort(),
    [data?.users],
  );

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.users ?? []).filter((user) => {
      const matchesSearch = !term || user.email.toLowerCase().includes(term) || (user.name ?? "").toLowerCase().includes(term);
      const matchesRole = role === "all" || user.role === role;
      const matchesActivity = activityFilter === "all"
        || (activityFilter === "today" && user.activeToday)
        || (activityFilter === "period" && user.activityDays > 0)
        || (activityFilter === "none" && user.activityDays === 0);
      return matchesSearch && matchesRole && matchesActivity;
    });
  }, [activityFilter, data?.users, role, search]);

  const maxActiveUsers = Math.max(1, ...(data?.trend ?? []).map((point) => point.activeUsers));
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedUsers = filteredUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  if (loading && !data) {
    return <div className="flex min-h-[420px] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{pick("사용 현황", "User Activity")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {pick("로그인 횟수가 아닌 실제 앱 사용을 5분 간격으로 집계합니다.", "Tracks actual app usage with a five-minute heartbeat, separately from logins.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{ACTIVITY_TIME_ZONE}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setRefreshKey((key) => key + 1)}>
            <RefreshCw className="h-3.5 w-3.5" />{pick("새로고침", "Refresh")}
          </Button>
        </div>
      </div>

      {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div> : null}

      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard icon={Activity} label={pick("오늘 활성 사용자", "Active Today")} value={data?.summary.today ?? 0} />
        <SummaryCard icon={CalendarDays} label={pick("최근 7일 사용자", "Last 7 Days")} value={data?.summary.last7Days ?? 0} />
        <SummaryCard icon={Users} label={pick("최근 30일 사용자", "Last 30 Days")} value={data?.summary.last30Days ?? 0} />
      </div>

      <div className="rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-950">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{pick("일별 활성 사용자", "Daily Active Users")}</h3>
            <p className="text-xs text-muted-foreground">{pick("하루에 한 번 이상 활동한 고유 사용자 수", "Unique users active at least once that day")}</p>
          </div>
          <div className="flex rounded-md border p-0.5 dark:border-slate-700">
            {([7, 30, 90] as PeriodDays[]).map((days) => (
              <button key={days} type="button" onClick={() => { setPeriod(days); setPage(1); }} className={`rounded px-3 py-1 text-xs font-medium ${period === days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {days}{pick("일", "d")}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto pb-6">
          <div className="flex h-36 min-w-full items-end gap-1" style={{ width: Math.max(640, (data?.trend.length ?? 0) * 18) }}>
            {(data?.trend ?? []).map((point, index) => {
              const showDate = index === 0 || index === (data?.trend.length ?? 1) - 1 || index % Math.max(1, Math.floor(period / 6)) === 0;
              return (
                <div key={point.date} className="group relative flex h-full min-w-3 flex-1 items-end" title={`${point.date}: ${point.activeUsers}`}>
                  <div className="w-full min-h-0.5 rounded-t bg-blue-500 group-hover:bg-blue-600" style={{ height: `${Math.max(2, (point.activeUsers / maxActiveUsers) * 100)}%` }} />
                  {showDate ? <span className="absolute -bottom-5 left-0 whitespace-nowrap text-[9px] text-muted-foreground">{point.date.slice(5)}</span> : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-950">
        <div className="flex flex-wrap items-center gap-2 border-b p-4 dark:border-slate-700">
          <div className="relative min-w-52 flex-1 md:max-w-sm">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              placeholder={pick("이름 또는 이메일 검색", "Search name or email")}
              className="pl-8"
            />
          </div>
          <Select value={role} onValueChange={(value) => { setRole(value); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">{pick("모든 역할", "All roles")}</SelectItem>{roles.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={activityFilter} onValueChange={(value) => { setActivityFilter(value as ActivityFilter); setPage(1); }}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{pick("모든 사용자", "All users")}</SelectItem>
              <SelectItem value="today">{pick("오늘 활동", "Active today")}</SelectItem>
              <SelectItem value="period">{pick(`최근 ${period}일 활동`, `Active in ${period} days`)}</SelectItem>
              <SelectItem value="none">{pick(`최근 ${period}일 미활동`, `Inactive for ${period} days`)}</SelectItem>
            </SelectContent>
          </Select>
          <Badge variant="secondary">{filteredUsers.length}{pick("명", " users")}</Badge>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{pick("행", "Rows")}</span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => { setPageSize(Number(value)); setPage(1); }}
            >
              <SelectTrigger className="h-8 w-[72px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[10, 30, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="min-w-[92px] text-center text-sm font-medium tabular-nums">
              {pick("페이지", "Page")} {currentPage} / {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <PaginationButton label={pick("첫 페이지", "First page")} disabled={currentPage === 1} onClick={() => setPage(1)}><ChevronsLeft /></PaginationButton>
              <PaginationButton label={pick("이전 페이지", "Previous page")} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft /></PaginationButton>
              <PaginationButton label={pick("다음 페이지", "Next page")} disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}><ChevronRight /></PaginationButton>
              <PaginationButton label={pick("마지막 페이지", "Last page")} disabled={currentPage === totalPages} onClick={() => setPage(totalPages)}><ChevronsRight /></PaginationButton>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>{pick("사용자", "User")}</TableHead><TableHead>{pick("역할", "Role")}</TableHead><TableHead>{pick("오늘", "Today")}</TableHead><TableHead>{pick("마지막 활동", "Last Active")}</TableHead><TableHead className="text-right">{pick(`활동 일수 (${period}일)`, `Active Days (${period}d)`)}</TableHead><TableHead>{pick("마지막 페이지", "Last Page")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filteredUsers.length === 0 ? <TableRow><TableCell colSpan={6} className="h-28 text-center text-muted-foreground">{pick("조건에 맞는 사용자가 없습니다.", "No users match these filters.")}</TableCell></TableRow> : pagedUsers.map((user) => (
                <TableRow key={user.id}>
                  <TableCell><div className="font-medium">{user.name?.trim() || "-"}</div><div className="text-xs text-muted-foreground">{user.email}</div></TableCell>
                  <TableCell><Badge variant="outline">{user.role}</Badge></TableCell>
                  <TableCell>{user.activeToday ? <Badge className="bg-emerald-600 hover:bg-emerald-600">{pick("활동", "Active")}</Badge> : <span className="text-xs text-muted-foreground">-</span>}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{formatDateTime(user.lastSeenAt, pick("ko-KR", "en-US"), ACTIVITY_TIME_ZONE)}</TableCell>
                  <TableCell className="text-right tabular-nums">{user.activityDays}</TableCell>
                  <TableCell className="max-w-64 truncate font-mono text-xs text-muted-foreground" title={user.lastPath ?? undefined}>{user.lastPath ?? "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: number }) {
  return <div className="rounded-xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-950"><div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Icon className="h-4 w-4" />{label}</div><div className="mt-2 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div></div>;
}

function PaginationButton({
  children,
  label,
  disabled,
  onClick,
}: {
  children: ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button type="button" variant="outline" size="icon-sm" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
}

function formatDateTime(value: string | null, locale: string, timeZone: string): string {
  if (!value) return "-";
  return new Date(value).toLocaleString(locale, {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
