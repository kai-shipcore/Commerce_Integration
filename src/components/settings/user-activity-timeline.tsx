"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock3,
  Database,
  Eye,
  Layers3,
  Link2,
  List,
  Loader2,
  LogIn,
  MousePointerClick,
} from "lucide-react";
import { apiPath } from "@/lib/api-path";
import { ACTIVITY_TIME_ZONE, getActivityDate } from "@/lib/activity-date";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { navigationItems } from "@/components/layout/navigation-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type TimelineSource = "activity" | "login" | "audit";
type TimelineFilter = "all" | "pages" | "actions" | "changes" | "logins" | "failures";
type TimelineView = "summary" | "raw";

type TimelineEvent = {
  id: string;
  source: TimelineSource;
  occurredAt: string;
  eventType: string;
  path: string | null;
  label: string | null;
  target: string | null;
  ip: string | null;
  entityType?: string;
  entityId?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  note?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
};

export interface TimelineActivityUser {
  id: string;
  name: string | null;
  email: string;
}

type ContextualEvent = {
  event: TimelineEvent;
  pageKey: string;
  pageLabel: string;
  pagePath: string | null;
};

type EventSummary = {
  key: string;
  representative: TimelineEvent;
  events: TimelineEvent[];
  firstAt: string;
  lastAt: string;
};

type ScreenGroup = {
  key: string;
  label: string;
  path: string | null;
  events: TimelineEvent[];
  summaries: EventSummary[];
};

type HourGroup = {
  key: string;
  firstAt: string;
  events: TimelineEvent[];
  screens: ScreenGroup[];
};

const RAW_PAGE_SIZE = 100;
const AUDIT_CONTEXT_WINDOW_MS = 30 * 60 * 1000;

export function UserActivityTimelineDialog({
  user,
  onClose,
}: {
  user: TimelineActivityUser | null;
  onClose: () => void;
}) {
  const { pick } = useI18n();
  const [date, setDate] = useState(getActivityDate());
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [view, setView] = useState<TimelineView>("summary");
  const [expandedHours, setExpandedHours] = useState<Set<string>>(new Set());
  const [expandedScreens, setExpandedScreens] = useState<Set<string>>(new Set());
  const [rawLimit, setRawLimit] = useState(RAW_PAGE_SIZE);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function loadTimeline() {
      setLoading(true);
      try {
        const response = await fetch(
          apiPath(`/api/admin/users/${encodeURIComponent(user!.id)}/activity-timeline?date=${date}`),
          { cache: "no-store" },
        );
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || "Failed to load activity timeline");
        if (cancelled) return;

        const nextEvents = result.data.events as TimelineEvent[];
        const nextGroups = buildHourGroups(enrichPageContext(nextEvents));
        const importantHours = nextGroups
          .filter((group) => group.events.some(isImportantEvent))
          .map((group) => group.key);
        const latestHour = nextGroups.at(-1)?.key;
        const importantScreens = nextGroups.flatMap((group) =>
          group.screens
            .filter((screen) => screen.events.some(isImportantEvent))
            .map((screen) => screenStateKey(group.key, screen.key)),
        );
        const latestScreen = nextGroups.at(-1)?.screens.at(-1);

        setEvents(nextEvents);
        setExpandedHours(new Set([...importantHours, ...(latestHour ? [latestHour] : [])]));
        setExpandedScreens(new Set([
          ...importantScreens,
          ...(latestHour && latestScreen ? [screenStateKey(latestHour, latestScreen.key)] : []),
        ]));
        setRawLimit(RAW_PAGE_SIZE);
        setError(null);
      } catch (loadError) {
        if (!cancelled) {
          setEvents([]);
          setError(loadError instanceof Error ? loadError.message : "Failed to load activity timeline");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadTimeline();
    return () => { cancelled = true; };
  }, [date, user]);

  const counts = useMemo(() => ({
    pages: events.filter((event) => event.eventType === "page_view").length,
    actions: events.filter((event) => event.source === "activity" && event.eventType !== "page_view" && !isFailureEvent(event)).length,
    changes: events.filter((event) => event.source === "audit").length,
    logins: events.filter((event) => event.source === "login").length,
    failures: events.filter(isFailureEvent).length,
  }), [events]);

  const contextualEvents = useMemo(() => enrichPageContext(events), [events]);
  const filteredContextualEvents = useMemo(
    () => contextualEvents.filter(({ event }) => matchesFilter(event, filter)),
    [contextualEvents, filter],
  );
  const hourGroups = useMemo(
    () => buildHourGroups(filteredContextualEvents),
    [filteredContextualEvents],
  );

  function toggleHour(key: string) {
    setExpandedHours((current) => toggleSetValue(current, key));
  }

  function toggleScreen(key: string) {
    setExpandedScreens((current) => toggleSetValue(current, key));
  }

  return (
    <Dialog open={Boolean(user)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[94vh] overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="border-b px-6 py-5 pr-12">
          <DialogTitle>{pick("사용자 일일 활동 기록", "Daily User Activity")}</DialogTitle>
          <DialogDescription>{user ? `${user.name?.trim() || user.email} · ${user.email}` : ""}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 border-b bg-muted/30 px-6 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="mr-1 flex items-center gap-2 text-sm font-medium">
              <CalendarDays className="h-4 w-4" />
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="h-9 rounded-md border bg-background px-2"
              />
            </label>
            <MetricBadge label={pick("페이지", "Pages")} value={counts.pages} />
            <MetricBadge label={pick("화면 행동", "UI actions")} value={counts.actions} />
            <MetricBadge label={pick("데이터 변경", "Data changes")} value={counts.changes} tone="important" />
            <MetricBadge label={pick("로그인", "Logins")} value={counts.logins} />
            <MetricBadge label={pick("실패", "Failures")} value={counts.failures} tone={counts.failures > 0 ? "failure" : "default"} />
            <span className="ml-auto text-xs text-muted-foreground">{ACTIVITY_TIME_ZONE}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={filter} onValueChange={(value) => setFilter(value as TimelineFilter)} disabled={view === "raw"}>
              <SelectTrigger className="h-8 w-44 bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{pick("전체 활동", "All activity")} ({events.length})</SelectItem>
                <SelectItem value="pages">{pick("화면 방문", "Page views")} ({counts.pages})</SelectItem>
                <SelectItem value="actions">{pick("버튼·링크 활동", "UI actions")} ({counts.actions})</SelectItem>
                <SelectItem value="changes">{pick("데이터 변경", "Data changes")} ({counts.changes})</SelectItem>
                <SelectItem value="logins">{pick("로그인", "Logins")} ({counts.logins})</SelectItem>
                <SelectItem value="failures">{pick("실패한 작업", "Failed actions")} ({counts.failures})</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex rounded-md border bg-background p-0.5">
              <button
                type="button"
                onClick={() => setView("summary")}
                className={`flex h-7 items-center gap-1.5 rounded px-3 text-xs font-medium ${view === "summary" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Layers3 className="h-3.5 w-3.5" />{pick("요약 보기", "Grouped")}
              </button>
              <button
                type="button"
                onClick={() => { setView("raw"); setRawLimit(RAW_PAGE_SIZE); }}
                className={`flex h-7 items-center gap-1.5 rounded px-3 text-xs font-medium ${view === "raw" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <List className="h-3.5 w-3.5" />{pick("원본 전체 기록", "All raw events")}
              </button>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {view === "summary"
                ? pick("반복 행동은 횟수로 합쳐 표시합니다.", "Repeated actions are combined into counts.")
                : pick("필터 없이 저장된 이벤트를 그대로 표시합니다.", "Shows every stored event without filtering.")}
            </span>
          </div>
        </div>

        <div className="max-h-[68vh] overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
          ) : events.length === 0 ? (
            <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
              {pick("선택한 날짜의 활동 기록이 없습니다.", "No activity was recorded on this date.")}
            </div>
          ) : view === "raw" ? (
            <RawTimeline
              events={events}
              limit={rawLimit}
              onLoadMore={() => setRawLimit((current) => current + RAW_PAGE_SIZE)}
            />
          ) : hourGroups.length === 0 ? (
            <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
              {pick("선택한 유형의 활동이 없습니다.", "No activity matches this filter.")}
            </div>
          ) : (
            <div className="space-y-3">
              {hourGroups.map((hour) => {
                const hourOpen = expandedHours.has(hour.key);
                const importantCount = hour.events.filter(isImportantEvent).length;
                return (
                  <section key={hour.key} className="overflow-hidden rounded-xl border bg-background shadow-sm">
                    <button
                      type="button"
                      onClick={() => toggleHour(hour.key)}
                      className="flex w-full items-center gap-3 bg-slate-50 px-4 py-3 text-left hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800"
                    >
                      {hourOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <Clock3 className="h-4 w-4 text-muted-foreground" />
                      <span className="font-mono text-sm font-semibold">{formatHourRange(hour.firstAt)}</span>
                      <Badge variant="secondary">{hour.events.length}{pick("건", " events")}</Badge>
                      <span className="text-xs text-muted-foreground">{hour.screens.length}{pick("개 화면", " screens")}</span>
                      {importantCount > 0 ? <Badge className="ml-auto bg-amber-100 text-amber-800 hover:bg-amber-100">{pick("중요", "Important")} {importantCount}</Badge> : null}
                    </button>
                    {hourOpen ? (
                      <div className="space-y-2 border-t p-3">
                        {hour.screens.map((screen) => {
                          const stateKey = screenStateKey(hour.key, screen.key);
                          return (
                            <ScreenActivityGroup
                              key={screen.key}
                              screen={screen}
                              open={expandedScreens.has(stateKey)}
                              onToggle={() => toggleScreen(stateKey)}
                            />
                          );
                        })}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ScreenActivityGroup({ screen, open, onToggle }: { screen: ScreenGroup; open: boolean; onToggle: () => void }) {
  const { pick } = useI18n();
  const visits = screen.events.filter((event) => event.eventType === "page_view").length;
  const actions = screen.events.filter((event) => event.source === "activity" && event.eventType !== "page_view" && !isFailureEvent(event)).length;
  const changes = screen.events.filter((event) => event.source === "audit").length;
  const failures = screen.events.filter(isFailureEvent).length;

  return (
    <div className={`overflow-hidden rounded-lg border ${failures > 0 ? "border-red-200" : changes > 0 ? "border-amber-200" : ""}`}>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-muted/50">
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{screen.label}</span>
            {screen.path ? <code className="max-w-80 truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{screen.path}</code> : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {visits > 0 ? <span>{pick("방문", "Visits")} {visits}</span> : null}
            {actions > 0 ? <span>{pick("행동", "Actions")} {actions}</span> : null}
            {changes > 0 ? <span className="font-semibold text-amber-700">{pick("변경", "Changes")} {changes}</span> : null}
            {failures > 0 ? <span className="font-semibold text-red-700">{pick("실패", "Failures")} {failures}</span> : null}
          </div>
        </div>
        <Badge variant="outline">{screen.events.length}{pick("건", " events")}</Badge>
      </button>
      {open ? (
        <div className="space-y-2 border-t bg-muted/10 p-3">
          {screen.summaries.map((summary) => <TimelineSummaryRow key={summary.key} summary={summary} />)}
        </div>
      ) : null}
    </div>
  );
}

function TimelineSummaryRow({ summary }: { summary: EventSummary }) {
  const event = summary.representative;
  const count = summary.events.length;
  return (
    <TimelineEventRow
      event={event}
      count={count}
      timeLabel={count > 1 ? `${formatTime(summary.firstAt)}–${formatTime(summary.lastAt)}` : formatTime(event.occurredAt)}
    />
  );
}

function RawTimeline({ events, limit, onLoadMore }: { events: TimelineEvent[]; limit: number; onLoadMore: () => void }) {
  const { pick } = useI18n();
  const visible = events.slice(0, limit);
  return (
    <div className="space-y-2">
      <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
        {pick("감사용 원본 보기입니다. 저장된 이벤트를 합치거나 생략하지 않습니다.", "Audit-oriented raw view. Stored events are not combined or omitted.")}
      </div>
      {visible.map((event) => <TimelineEventRow key={event.id} event={event} timeLabel={formatTime(event.occurredAt)} showPath />)}
      {visible.length < events.length ? (
        <div className="flex justify-center pt-2">
          <Button type="button" variant="outline" size="sm" onClick={onLoadMore}>
            {pick("100건 더 보기", "Load 100 more")} ({visible.length}/{events.length})
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function TimelineEventRow({
  event,
  count = 1,
  timeLabel,
  showPath = false,
}: {
  event: TimelineEvent;
  count?: number;
  timeLabel: string;
  showPath?: boolean;
}) {
  const { pick } = useI18n();
  const failure = isFailureEvent(event);
  const config = failure
    ? { icon: AlertTriangle, label: pick("실패한 작업", "Failed action"), iconClass: "bg-red-100 text-red-700", rowClass: "border-red-200 bg-red-50/40" }
    : event.source === "audit"
      ? { icon: Database, label: pick("데이터 변경", "Data change"), iconClass: "bg-amber-100 text-amber-700", rowClass: "border-amber-200 bg-amber-50/30" }
      : event.source === "login"
        ? { icon: LogIn, label: pick("로그인", "Login"), iconClass: "bg-emerald-100 text-emerald-700", rowClass: "" }
        : event.eventType === "page_view"
          ? { icon: Eye, label: pick("페이지 방문", "Page view"), iconClass: "bg-blue-100 text-blue-700", rowClass: "" }
          : event.eventType === "link_click"
            ? { icon: Link2, label: pick("링크 이동", "Link click"), iconClass: "bg-violet-100 text-violet-700", rowClass: "" }
            : { icon: MousePointerClick, label: event.eventType === "form_submit" ? pick("폼 제출", "Form submit") : pick("버튼 클릭", "Button click"), iconClass: "bg-slate-100 text-slate-700", rowClass: "" };
  const Icon = config.icon;
  const summary = event.subjectType === "sku" && event.subjectId
    ? pick(`SKU 선택: ${event.subjectId}`, `Select SKU: ${event.subjectId}`)
    : event.source === "audit"
      ? `${event.entityType ?? "data"} · ${event.label ?? event.entityId ?? "-"} · ${event.target ?? "update"}`
      : event.label || event.target || "-";

  return (
    <div className={`grid grid-cols-[104px_32px_minmax(0,1fr)] gap-3 rounded-lg border bg-background px-3 py-3 ${config.rowClass}`}>
      <div className="flex items-start gap-1 pt-1 font-mono text-[11px] text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />{timeLabel}</div>
      <div className={`flex h-8 w-8 items-center justify-center rounded-full ${config.iconClass}`}><Icon className="h-4 w-4" /></div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold">{config.label}</span>
          {event.source === "audit" || failure ? <Badge className={failure ? "bg-red-600 hover:bg-red-600" : "bg-amber-600 hover:bg-amber-600"}>{pick("중요", "Important")}</Badge> : <Badge variant="outline" className="text-[9px]">{pick("일반", "Normal")}</Badge>}
          {count > 1 ? <Badge variant="secondary">{count}{pick("회", " times")}</Badge> : null}
          {showPath && event.path ? <code className="max-w-96 truncate rounded bg-muted px-1.5 py-0.5 text-[10px]">{event.path}</code> : null}
        </div>
        <div className="mt-1 break-words text-sm" title={summary}>{summary}</div>
        {event.source === "audit" ? (
          <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
            {event.before ? <div className="break-all">{pick("변경 전", "Before")}: {JSON.stringify(event.before)}</div> : null}
            {event.after ? <div className="break-all">{pick("변경 후", "After")}: {JSON.stringify(event.after)}</div> : null}
            {event.note ? <div className="break-words">{event.note}</div> : null}
          </div>
        ) : event.target && !["page", "button", "form"].includes(event.target) ? (
          <div className={`mt-1 break-words text-[11px] ${failure ? "text-red-700" : "text-muted-foreground"}`}>→ {event.target}</div>
        ) : null}
      </div>
    </div>
  );
}

function MetricBadge({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "important" | "failure" }) {
  const className = tone === "failure"
    ? "border-red-200 bg-red-100 text-red-800"
    : tone === "important"
      ? "border-amber-200 bg-amber-100 text-amber-800"
      : "";
  return <Badge variant="secondary" className={className}>{label} {value}</Badge>;
}

function enrichPageContext(events: TimelineEvent[]): ContextualEvent[] {
  let lastPage: { path: string; label: string; at: number } | null = null;
  return [...events]
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
    .map((event) => {
      const eventTime = new Date(event.occurredAt).getTime();
      if (event.path) {
        const pageLabel = getPageLabel(event.path, event.label);
        lastPage = { path: event.path, label: pageLabel, at: eventTime };
        return { event, pageKey: `path:${event.path}`, pageLabel, pagePath: event.path };
      }
      if (event.source === "audit" && lastPage && eventTime - lastPage.at <= AUDIT_CONTEXT_WINDOW_MS) {
        return { event, pageKey: `path:${lastPage.path}`, pageLabel: lastPage.label, pagePath: lastPage.path };
      }
      if (event.source === "login") {
        return { event, pageKey: "account:login", pageLabel: "Account / Login", pagePath: null };
      }
      if (event.source === "audit") {
        const entityLabel = event.entityType ? titleCase(event.entityType) : "Data";
        return { event, pageKey: `audit:${event.entityType ?? "data"}`, pageLabel: `${entityLabel} Changes`, pagePath: null };
      }
      return { event, pageKey: "other", pageLabel: "Other activity", pagePath: null };
    });
}

function buildHourGroups(contextualEvents: ContextualEvent[]): HourGroup[] {
  type MutableScreenGroup = { label: string; path: string | null; events: TimelineEvent[] };
  type MutableHourGroup = { firstAt: string; events: TimelineEvent[]; screens: Map<string, MutableScreenGroup> };
  const hours = new Map<string, MutableHourGroup>();
  for (const contextual of contextualEvents) {
    const hourKey = getHourKey(contextual.event.occurredAt);
    const hour: MutableHourGroup = hours.get(hourKey) ?? {
      firstAt: contextual.event.occurredAt,
      events: [],
      screens: new Map<string, MutableScreenGroup>(),
    };
    hour.events.push(contextual.event);
    const screen: MutableScreenGroup = hour.screens.get(contextual.pageKey) ?? {
      label: contextual.pageLabel,
      path: contextual.pagePath,
      events: [],
    };
    screen.events.push(contextual.event);
    hour.screens.set(contextual.pageKey, screen);
    hours.set(hourKey, hour);
  }

  return [...hours.entries()].map(([key, hour]) => ({
    key,
    firstAt: hour.firstAt,
    events: hour.events,
    screens: [...hour.screens.entries()].map(([screenKey, screen]) => ({
      key: screenKey,
      label: screen.label,
      path: screen.path,
      events: screen.events,
      summaries: summarizeEvents(screen.events),
    })),
  }));
}

function summarizeEvents(events: TimelineEvent[]): EventSummary[] {
  const summaries = new Map<string, EventSummary>();
  for (const event of events) {
    const mergeable = event.source === "activity" && !isFailureEvent(event);
    const key = mergeable
      ? `${event.eventType}|${event.path ?? ""}|${event.subjectType ?? ""}|${event.subjectId ?? event.label ?? ""}|${event.target ?? ""}`
      : event.id;
    const existing = summaries.get(key);
    if (existing) {
      existing.events.push(event);
      existing.lastAt = event.occurredAt;
    } else {
      summaries.set(key, { key, representative: event, events: [event], firstAt: event.occurredAt, lastAt: event.occurredAt });
    }
  }
  return [...summaries.values()].sort((left, right) => left.firstAt.localeCompare(right.firstAt));
}

function getPageLabel(path: string, fallback: string | null): string {
  const match = navigationItems
    .filter((item) => item.href === "/" ? path === "/" || path === "/dashboard" : path === item.href || path.startsWith(`${item.href}/`))
    .sort((left, right) => right.href.length - left.href.length)[0];
  return match?.name ?? fallback?.trim() ?? path;
}

function matchesFilter(event: TimelineEvent, filter: TimelineFilter): boolean {
  if (filter === "all") return true;
  if (filter === "failures") return isFailureEvent(event);
  if (filter === "changes") return event.source === "audit";
  if (filter === "logins") return event.source === "login";
  if (filter === "pages") return event.eventType === "page_view";
  return event.source === "activity" && event.eventType !== "page_view" && !isFailureEvent(event);
}

function isFailureEvent(event: TimelineEvent): boolean {
  const eventType = event.eventType.toLowerCase();
  return eventType === "action_failed" || eventType.includes("failure") || eventType.includes("error");
}

function isImportantEvent(event: TimelineEvent): boolean {
  return event.source === "audit" || isFailureEvent(event);
}

function getHourKey(value: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ACTIVITY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}`;
}

function formatHourRange(value: string): string {
  const hour = new Date(value).toLocaleTimeString("en-US", {
    timeZone: ACTIVITY_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  });
  return `${hour}:00–${hour}:59`;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("en-US", {
    timeZone: ACTIVITY_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

function screenStateKey(hourKey: string, screenKey: string): string {
  return `${hourKey}|${screenKey}`;
}

function toggleSetValue(current: Set<string>, key: string): Set<string> {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function titleCase(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
