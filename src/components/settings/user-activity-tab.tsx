"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Clock3, Database, Eye, Link2, Loader2, LogIn, MousePointerClick, RefreshCw, Search, Users } from "lucide-react";
import { apiPath } from "@/lib/api-path";
import { ACTIVITY_TIME_ZONE, getActivityDate } from "@/lib/activity-date";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

type ActivityUser = ActivityResponse["users"][number];
type TimelineEvent = {
  id: string; source: "activity" | "login" | "audit"; occurredAt: string; eventType: string;
  path: string | null; label: string | null; target: string | null; ip: string | null;
  entityType?: string; entityId?: string; before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null; note?: string | null;
};

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
  const [timelineUser, setTimelineUser] = useState<ActivityUser | null>(null);

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
              <TableHead>{pick("사용자", "User")}</TableHead><TableHead>{pick("역할", "Role")}</TableHead><TableHead>{pick("오늘", "Today")}</TableHead><TableHead>{pick("마지막 활동", "Last Active")}</TableHead><TableHead className="text-right">{pick(`활동 일수 (${period}일)`, `Active Days (${period}d)`)}</TableHead><TableHead>{pick("마지막 페이지", "Last Page")}</TableHead><TableHead className="text-right">{pick("상세", "Details")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filteredUsers.length === 0 ? <TableRow><TableCell colSpan={7} className="h-28 text-center text-muted-foreground">{pick("조건에 맞는 사용자가 없습니다.", "No users match these filters.")}</TableCell></TableRow> : pagedUsers.map((user) => (
                <TableRow key={user.id}>
                  <TableCell><div className="font-medium">{user.name?.trim() || "-"}</div><div className="text-xs text-muted-foreground">{user.email}</div></TableCell>
                  <TableCell><Badge variant="outline">{user.role}</Badge></TableCell>
                  <TableCell>{user.activeToday ? <Badge className="bg-emerald-600 hover:bg-emerald-600">{pick("활동", "Active")}</Badge> : <span className="text-xs text-muted-foreground">-</span>}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{formatDateTime(user.lastSeenAt, pick("ko-KR", "en-US"), ACTIVITY_TIME_ZONE)}</TableCell>
                  <TableCell className="text-right tabular-nums">{user.activityDays}</TableCell>
                  <TableCell className="max-w-64 truncate font-mono text-xs text-muted-foreground" title={user.lastPath ?? undefined}>{user.lastPath ?? "-"}</TableCell>
                  <TableCell className="text-right"><Button type="button" variant="outline" size="sm" onClick={() => setTimelineUser(user)}><Eye className="h-3.5 w-3.5" />{pick("일일 기록", "Daily log")}</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      <UserActivityTimelineDialog user={timelineUser} onClose={() => setTimelineUser(null)} />
    </div>
  );
}

function UserActivityTimelineDialog({ user, onClose }: { user: ActivityUser | null; onClose: () => void }) {
  const { pick } = useI18n();
  const [date, setDate] = useState(getActivityDate());
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function loadTimeline() {
      setLoading(true);
      try {
        const response = await fetch(apiPath(`/api/admin/users/${encodeURIComponent(user!.id)}/activity-timeline?date=${date}`), { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || "Failed to load activity timeline");
        if (!cancelled) { setEvents(result.data.events as TimelineEvent[]); setError(null); }
      } catch (loadError) {
        if (!cancelled) { setEvents([]); setError(loadError instanceof Error ? loadError.message : "Failed to load activity timeline"); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadTimeline();
    return () => { cancelled = true; };
  }, [date, user]);

  const pageViews = events.filter((event) => event.eventType === "page_view").length;
  const actions = events.filter((event) => event.source === "activity" && event.eventType !== "page_view").length;
  const dataChanges = events.filter((event) => event.source === "audit").length;

  return (
    <Dialog open={Boolean(user)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-6 py-5 pr-12">
          <DialogTitle>{pick("사용자 일일 활동 기록", "Daily User Activity")}</DialogTitle>
          <DialogDescription>{user ? `${user.name?.trim() || user.email} · ${user.email}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-3 border-b bg-muted/30 px-6 py-3">
          <label className="flex items-center gap-2 text-sm font-medium"><CalendarDays className="h-4 w-4" /><input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-9 rounded-md border bg-background px-2" /></label>
          <Badge variant="secondary">{pick("페이지", "Pages")} {pageViews}</Badge>
          <Badge variant="secondary">{pick("화면 행동", "UI actions")} {actions}</Badge>
          <Badge variant="secondary">{pick("데이터 변경", "Data changes")} {dataChanges}</Badge>
          <span className="ml-auto text-xs text-muted-foreground">{ACTIVITY_TIME_ZONE}</span>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-6 py-4">
          {loading ? <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
            : error ? <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
              : events.length === 0 ? <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">{pick("선택한 날짜의 활동 기록이 없습니다.", "No activity was recorded on this date.")}</div>
                : <div className="space-y-2">{events.map((event) => <TimelineEventRow key={event.id} event={event} />)}</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TimelineEventRow({ event }: { event: TimelineEvent }) {
  const { pick } = useI18n();
  const config = event.source === "audit"
    ? { icon: Database, label: pick("데이터 변경", "Data change"), className: "bg-amber-100 text-amber-700" }
    : event.source === "login"
      ? { icon: LogIn, label: pick("로그인", "Login"), className: "bg-emerald-100 text-emerald-700" }
      : event.eventType === "page_view"
        ? { icon: Eye, label: pick("페이지 방문", "Page view"), className: "bg-blue-100 text-blue-700" }
        : event.eventType === "link_click"
          ? { icon: Link2, label: pick("링크 이동", "Link click"), className: "bg-violet-100 text-violet-700" }
          : { icon: MousePointerClick, label: event.eventType === "form_submit" ? pick("폼 제출", "Form submit") : pick("버튼 클릭", "Button click"), className: "bg-slate-100 text-slate-700" };
  const Icon = config.icon;
  const summary = event.source === "audit" ? `${event.entityType ?? "data"} · ${event.label ?? event.entityId ?? "-"} · ${event.target ?? "update"}` : event.label || event.target || "-";
  return (
    <div className="grid grid-cols-[86px_32px_minmax(0,1fr)] gap-3 rounded-lg border bg-background px-3 py-3">
      <div className="flex items-start gap-1 pt-1 font-mono text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />{formatTime(event.occurredAt)}</div>
      <div className={`flex h-8 w-8 items-center justify-center rounded-full ${config.className}`}><Icon className="h-4 w-4" /></div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold">{config.label}</span>{event.path ? <code className="truncate rounded bg-muted px-1.5 py-0.5 text-[11px]">{event.path}</code> : null}</div>
        <div className="mt-1 truncate text-sm" title={summary}>{summary}</div>
        {event.source === "audit" ? <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
          {event.before ? <div className="truncate">{pick("변경 전", "Before")}: {JSON.stringify(event.before)}</div> : null}
          {event.after ? <div className="truncate">{pick("변경 후", "After")}: {JSON.stringify(event.after)}</div> : null}
          {event.note ? <div className="truncate">{event.note}</div> : null}
        </div> : event.target && !["page", "button", "form"].includes(event.target) ? <div className="mt-1 truncate text-[11px] text-muted-foreground">→ {event.target}</div> : null}
      </div>
    </div>
  );
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("en-US", { timeZone: ACTIVITY_TIME_ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
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
