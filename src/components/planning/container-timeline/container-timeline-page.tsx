"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, X } from "lucide-react";
import { apiPath } from "@/lib/api-path";

// ── Types ─────────────────────────────────────────────────────────────────────

type ContainerStatus = "draft" | "final-list-sent" | "packing-list-received" | "complete";
type Period = "3M" | "6M" | "all";

interface ContainerItem {
  id: string;
  sku: string;
  qty: number;
  cbm: number;
}

interface Container {
  id: string;
  containerNumber: string;
  etaDate: string | null;
  actualArrivalDate: string | null;
  status: ContainerStatus;
  cbmCapacity: number;
  factoryName: string | null;
  origin: string | null;
  destWarehouse: string | null;
  note: string | null;
  itemCount: number;
  totalQty: number;
  totalCbm: number;
  items: ContainerItem[];
}

interface MonthSegment {
  label: string;
  widthPct: number;
  isCurrent: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_ORDER: ContainerStatus[] = [
  "packing-list-received",
  "final-list-sent",
  "draft",
  "complete",
];

const STATUS_LABEL: Record<ContainerStatus, string> = {
  "packing-list-received": "Packing",
  "final-list-sent": "Final",
  draft: "Draft",
  complete: "Complete",
};

const STATUS_LABEL_FULL: Record<ContainerStatus, string> = {
  "packing-list-received": "Packing List Rcvd",
  "final-list-sent": "Final List Sent",
  draft: "Draft",
  complete: "Complete",
};

const STATUS_COLOR: Record<ContainerStatus, string> = {
  "packing-list-received": "#378add",
  "final-list-sent": "#ef9f27",
  draft: "#d4537e",
  complete: "#22a666",
};

const STATUS_PILL: Record<ContainerStatus, string> = {
  "packing-list-received": "bg-[#ebf0fd] text-[#1a4db0]",
  "final-list-sent": "bg-[#fef3e2] text-[#8a5300]",
  draft: "bg-[#fce4ec] text-[#880e4f]",
  complete: "bg-[#e6f7ee] text-[#166534]",
};

const PERIOD_OPTIONS: { value: Period; label: string; days: number | null }[] = [
  { value: "3M", label: "3개월", days: 90 },
  { value: "6M", label: "6개월", days: 180 },
  { value: "all", label: "전체", days: null },
];

// ── Date helpers ──────────────────────────────────────────────────────────────

const MS = 86_400_000;
const toDate = (s: string) => new Date(s + "T00:00:00");
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * MS);
const diffDays = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / MS);
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const fmtMonthYear = (d: Date) => d.toLocaleDateString("en-US", { month: "long", year: "numeric" });

function normalizeStatus(raw: string): ContainerStatus {
  if (raw === "shipped") return "final-list-sent";
  if (raw === "packing_received") return "packing-list-received";
  if (raw === "complete") return "complete";
  return "draft";
}

function buildMonths(rangeStart: Date, totalDays: number): MonthSegment[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rangeEnd = addDays(rangeStart, totalDays - 1);
  const segments: MonthSegment[] = [];
  let ms = startOfMonth(rangeStart);

  while (ms <= rangeEnd) {
    const me = endOfMonth(ms);
    const visStart = ms < rangeStart ? rangeStart : ms;
    const visEnd = me > rangeEnd ? rangeEnd : me;
    const days = diffDays(visEnd, visStart) + 1;
    segments.push({
      label: fmtMonthYear(ms),
      widthPct: (days / totalDays) * 100,
      isCurrent: today >= ms && today <= me,
    });
    ms = addDays(me, 1);
  }

  return segments;
}

// ── Main component ────────────────────────────────────────────────────────────

export function ContainerTimelinePage() {
  const [containers, setContainers] = useState<Container[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Container | null>(null);

  // ── Filter state ──
  const [activeStatuses, setActiveStatuses] = useState<Set<ContainerStatus>>(
    () => new Set<ContainerStatus>(["packing-list-received", "final-list-sent", "draft"])
  );
  const [period, setPeriod] = useState<Period>("3M");

  useEffect(() => {
    fetch(apiPath("/api/containers?includeDetails=true"))
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error ?? "Failed to load");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setContainers(
          (json.data as any[]).map((row) => ({
            id: String(row.id ?? ""),
            containerNumber: String(row.containerNumber ?? ""),
            etaDate: row.etaDate ? String(row.etaDate) : null,
            actualArrivalDate: row.actualArrivalDate ? String(row.actualArrivalDate) : null,
            status: normalizeStatus(String(row.status ?? "")),
            cbmCapacity: Number(row.cbmCapacity ?? 0),
            factoryName: row.factoryName ? String(row.factoryName) : null,
            origin: row.origin ? String(row.origin) : null,
            destWarehouse: row.destWarehouse ? String(row.destWarehouse) : null,
            note: row.note ? String(row.note) : null,
            itemCount: Number(row.itemCount ?? 0),
            totalQty: Number(row.totalQty ?? 0),
            totalCbm: Number(row.totalCbm ?? 0),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            items: ((row.items ?? []) as any[]).map((item: any) => ({
              id: String(item.id ?? ""),
              sku: String(item.sku ?? ""),
              qty: Number(item.qty ?? 0),
              cbm: Number(item.cbm ?? 0),
            })),
          }))
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Unknown error"))
      .finally(() => setLoading(false));
  }, []);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // ── Timeline range (driven by period) ────────────────────────────────────
  const { rangeStart, rangeEnd, totalDays, months, todayPct } = useMemo(() => {
    let s: Date, e: Date;

    if (period === "3M") {
      s = startOfMonth(today);
      e = endOfMonth(addDays(today, 90));
    } else if (period === "6M") {
      s = startOfMonth(today);
      e = endOfMonth(addDays(today, 180));
    } else {
      // "all" — auto-fit to data
      const etaDates = containers.filter((c) => c.etaDate).map((c) => toDate(c.etaDate!));
      if (etaDates.length === 0) {
        s = startOfMonth(today);
        e = endOfMonth(addDays(today, 90));
      } else {
        const minEta = new Date(Math.min(...etaDates.map((d) => d.getTime())));
        const maxEta = new Date(Math.max(...etaDates.map((d) => d.getTime())));
        s = startOfMonth(addDays(minEta, -40));
        e = endOfMonth(addDays(maxEta, 30));
      }
    }

    const total = diffDays(e, s) + 1;
    return {
      rangeStart: s,
      rangeEnd: e,
      totalDays: total,
      months: buildMonths(s, total),
      todayPct: (diffDays(today, s) / total) * 100,
    };
  }, [containers, today, period]);

  // ── Filtered + grouped containers ────────────────────────────────────────
  const grouped = useMemo(() => {
    return STATUS_ORDER.map((status) => ({
      status,
      items: containers.filter((c) => {
        if (!activeStatuses.has(c.status) || c.status !== status) return false;
        // For fixed periods, hide containers whose ETA is outside the range
        // (but keep containers with no ETA — they appear as "날짜 미정")
        if (period !== "all" && c.etaDate) {
          const eta = toDate(c.etaDate);
          if (eta < rangeStart || eta > rangeEnd) return false;
        }
        return true;
      }),
    })).filter((g) => g.items.length > 0);
  }, [containers, activeStatuses, period, rangeStart, rangeEnd]);

  // ── Summary counts for filter pills ──────────────────────────────────────
  const countsByStatus = useMemo(() => {
    const counts: Partial<Record<ContainerStatus, number>> = {};
    for (const c of containers) {
      counts[c.status] = (counts[c.status] ?? 0) + 1;
    }
    return counts;
  }, [containers]);

  function toggleStatus(status: ContainerStatus) {
    setActiveStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        // Keep at least one active
        if (next.size > 1) next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  }

  function barProps(c: Container): { left: number; width: number } | null {
    const etaStr =
      c.status === "complete" && c.actualArrivalDate ? c.actualArrivalDate : c.etaDate;
    if (!etaStr) return null;
    const etaDay = diffDays(toDate(etaStr), rangeStart);
    const transitDays = 30;
    const startDay = Math.max(0, etaDay - transitDays);
    return {
      left: (startDay / totalDays) * 100,
      width: ((etaDay - startDay) / totalDays) * 100,
    };
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-48 text-red-500 text-sm">{error}</div>
    );
  }

  const todayVisible = todayPct >= 0 && todayPct <= 100;
  const totalVisible = grouped.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <>
      <div className="flex flex-col gap-4">
        {/* ── Page header ───────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-[#1a1917]">Container Timeline</h1>
            <p className="text-sm text-muted-foreground">입고 예정 컨테이너 · ETA 기준 Gantt 뷰</p>
          </div>
        </div>

        {/* ── Filter bar ───────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Status pills */}
          <span className="text-[11px] font-semibold text-muted-foreground">상태</span>
          {STATUS_ORDER.map((status) => {
            const active = activeStatuses.has(status);
            const count = countsByStatus[status] ?? 0;
            return (
              <button
                key={status}
                onClick={() => toggleStatus(status)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                  active
                    ? "border-transparent text-white shadow-sm"
                    : "bg-white border-[#d8d6ce] text-muted-foreground hover:border-stone-400"
                }`}
                style={active ? { background: STATUS_COLOR[status] } : undefined}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${active ? "bg-white/70" : ""}`}
                  style={!active ? { background: STATUS_COLOR[status] } : undefined}
                />
                {STATUS_LABEL[status]}
                <span
                  className={`text-[10px] font-bold rounded-full px-1 ${
                    active ? "bg-white/25 text-white" : "bg-stone-100 text-muted-foreground"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}

          {/* Separator */}
          <span className="w-px h-4 bg-[#d8d6ce]" />

          {/* Period toggle */}
          <span className="text-[11px] font-semibold text-muted-foreground">기간</span>
          <div className="flex bg-[#f0eee9] border border-[#d8d6ce] rounded-lg p-0.5 gap-0.5">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                  period === opt.value
                    ? "bg-white text-[#1a1917] shadow-sm ring-1 ring-inset ring-[#d8d6ce]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Result count */}
          <span className="ml-auto text-[11px] text-muted-foreground">
            {totalVisible}개 표시 중
          </span>
        </div>

        {/* ── Gantt table ──────────────────────────────────────────────── */}
        <div className="bg-white border border-[#e2dfd8] rounded-xl overflow-hidden shadow-sm">
          {/* Month header */}
          <div className="flex border-b border-[#e2dfd8] bg-[#f5f4f0]">
            <div className="w-[280px] shrink-0 border-r border-[#e2dfd8] px-4 py-2.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-wide">
                Container
              </span>
              <span className="text-[10px] text-stone-300">ETA 기준 ↑</span>
            </div>
            <div className="flex-1 relative overflow-hidden">
              <div className="flex">
                {months.map((m, i) => (
                  <div
                    key={i}
                    style={{ width: `${m.widthPct}%` }}
                    className={`shrink-0 py-2.5 text-center text-[11px] font-semibold border-r border-[#e8e6e1] last:border-r-0 ${
                      m.isCurrent ? "text-[#1a5cdb]" : "text-stone-500"
                    }`}
                  >
                    {m.label}
                  </div>
                ))}
              </div>
              {todayVisible && (
                <div
                  className="absolute top-0 bottom-0 pointer-events-none"
                  style={{ left: `${todayPct}%` }}
                >
                  <div className="w-px h-full bg-red-400 opacity-50" />
                </div>
              )}
            </div>
          </div>

          {/* Body */}
          {grouped.length === 0 ? (
            <div className="py-20 text-center text-muted-foreground text-sm">
              <div>표시할 컨테이너가 없습니다</div>
              <div className="text-[11px] mt-1 text-stone-300">
                필터를 변경하거나 기간을 늘려보세요
              </div>
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.status}>
                {/* Group label */}
                <div className="flex border-b border-[#f0ede8] bg-[#fafaf7]">
                  <div className="w-[280px] shrink-0 border-r border-[#e2dfd8] px-4 py-1.5 flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: STATUS_COLOR[group.status] }}
                    />
                    <span className="text-[11px] font-semibold text-stone-500">
                      {STATUS_LABEL_FULL[group.status]}
                    </span>
                    <span className="ml-auto text-[10px] font-bold text-stone-400 bg-stone-200 rounded-full px-2 py-px">
                      {group.items.length}
                    </span>
                  </div>
                  <div className="flex-1" />
                </div>

                {/* Container rows */}
                {group.items.map((c) => {
                  const bar = barProps(c);
                  const isSelected = selected?.id === c.id;
                  const isDraft = c.status === "draft";
                  const cbmPct =
                    c.cbmCapacity > 0
                      ? Math.round((c.totalCbm / c.cbmCapacity) * 100)
                      : 0;
                  const displayDate =
                    c.status === "complete" && c.actualArrivalDate
                      ? c.actualArrivalDate
                      : c.etaDate;

                  return (
                    <div
                      key={c.id}
                      className={`flex border-b border-[#f0ede8] last:border-b-0 cursor-pointer transition-colors hover:bg-[#f0eee9] ${
                        isSelected ? "border-l-4 border-l-[#1a5cdb] bg-[#ebf0fd]/40" : ""
                      }`}
                      onClick={() => setSelected(isSelected ? null : c)}
                    >
                      {/* Sidebar */}
                      <div
                        className={`border-r border-[#e2dfd8] px-4 py-2.5 flex flex-col gap-0.5 justify-center ${
                          isSelected ? "w-[276px] shrink-0" : "w-[280px] shrink-0"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/10"
                            style={{
                              backgroundColor: STATUS_COLOR[c.status],
                              boxShadow: `0 0 0 3px ${STATUS_COLOR[c.status]}30`,
                            }}
                          />
                          <span className="font-mono text-[12px] font-bold text-[#1a1917] truncate">
                            {c.containerNumber}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap pl-4">
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-px rounded-md ${STATUS_PILL[c.status]}`}
                          >
                            {STATUS_LABEL_FULL[c.status]}
                          </span>
                          {c.destWarehouse && (
                            <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                              {c.destWarehouse}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground pl-4">
                          ETA {displayDate ?? "—"} · {c.itemCount}종 · {c.totalQty.toLocaleString()}pcs
                        </div>
                      </div>

                      {/* Timeline */}
                      <div className="flex-1 relative py-3 min-h-[62px]">
                        {/* Month grid */}
                        <div className="absolute inset-0 flex pointer-events-none">
                          {months.map((m, i) => (
                            <div
                              key={i}
                              style={{ width: `${m.widthPct}%` }}
                              className={`shrink-0 border-r border-[#f0ede8] last:border-r-0 ${
                                m.isCurrent ? "bg-blue-50/20" : ""
                              }`}
                            />
                          ))}
                        </div>

                        {/* Today line */}
                        {todayVisible && (
                          <div
                            className="absolute top-0 bottom-0 pointer-events-none"
                            style={{ left: `${todayPct}%` }}
                          >
                            <div className="w-px h-full bg-red-400 opacity-30" />
                          </div>
                        )}

                        {/* Gantt bar */}
                        {bar ? (
                          <div
                            className="absolute top-3 bottom-3 rounded-md flex items-center overflow-hidden shadow-sm"
                            style={{
                              left: `${bar.left}%`,
                              width: `${bar.width}%`,
                              minWidth: 56,
                              background: STATUS_COLOR[c.status],
                              opacity: isDraft ? 0.8 : 1,
                              ...(isDraft
                                ? { border: "2px dashed rgba(255,255,255,0.45)" }
                                : {}),
                            }}
                          >
                            <div className="flex items-center gap-1.5 px-2.5 overflow-hidden w-full">
                              <span
                                className="text-[11px] font-bold text-white truncate flex-1"
                                style={{ textShadow: "0 1px 2px rgba(0,0,0,0.18)" }}
                              >
                                {c.containerNumber}
                              </span>
                              {displayDate && (
                                <span className="text-[10px] text-white/80 shrink-0">
                                  {fmtDate(toDate(displayDate))}
                                </span>
                              )}
                              {c.cbmCapacity > 0 && (
                                <span className="text-[10px] font-semibold text-white/90 shrink-0 bg-black/15 rounded px-1 py-px">
                                  {cbmPct}%
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="absolute inset-y-3 left-3 flex items-center">
                            <span className="text-[11px] text-stone-300 italic">날짜 미정</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
          {STATUS_ORDER.map((s) => (
            <div key={s} className="flex items-center gap-1.5">
              <div
                className="w-2.5 h-2.5 rounded-sm"
                style={{ background: STATUS_COLOR[s as ContainerStatus], opacity: s === "draft" ? 0.8 : 1 }}
              />
              {STATUS_LABEL_FULL[s as ContainerStatus]}
              {s === "draft" && " (점선)"}
            </div>
          ))}
          <span className="w-px h-3.5 bg-[#d8d6ce]" />
          <div className="flex items-center gap-1.5">
            <div className="w-px h-4 bg-red-400 opacity-60" />
            오늘
          </div>
          <span className="ml-auto text-[10px] text-stone-300">
            ※ 바 너비 = 30일 Transit 기간 (발주일 컬럼 추가 시 실제 기간으로 전환 가능)
          </span>
        </div>
      </div>

      {/* ── Right overlay drawer ──────────────────────────────────────────────── */}
      {selected && <ContainerDetailDrawer container={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

// ── Detail drawer ─────────────────────────────────────────────────────────────

function ContainerDetailDrawer({
  container: c,
  onClose,
}: {
  container: Container;
  onClose: () => void;
}) {
  const totalCbm = c.items.reduce((sum, item) => sum + item.qty * item.cbm, 0);
  const totalQty = c.items.reduce((sum, item) => sum + item.qty, 0);
  const cbmUsedPct = c.cbmCapacity > 0 ? Math.min(100, (totalCbm / c.cbmCapacity) * 100) : 0;

  const displayDate =
    c.status === "complete" && c.actualArrivalDate ? c.actualArrivalDate : c.etaDate;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-30 bg-black/15 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-[460px] z-40 bg-white border-l border-[#e2dfd8] shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-[#e2dfd8] bg-white shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-base font-bold text-[#1a1917]">
                {c.containerNumber}
              </span>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${STATUS_PILL[c.status]}`}
              >
                {STATUS_LABEL_FULL[c.status]}
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {c.status === "complete" && c.actualArrivalDate
                ? `실제 입고 ${c.actualArrivalDate}`
                : `ETA ${c.etaDate ?? "—"}`}
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-4 shrink-0 flex items-center justify-center w-7 h-7 rounded-full border border-[#cccac4] bg-white text-muted-foreground hover:bg-[#f0eee9] hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Meta info */}
          <div className="px-6 py-4 space-y-3 border-b border-[#e2dfd8]">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
              {displayDate && (
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">
                    {c.status === "complete" ? "실제 입고" : "ETA"}
                  </div>
                  <div className="font-semibold">{displayDate}</div>
                </div>
              )}
              {c.actualArrivalDate && c.status !== "complete" && (
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">실제 입고</div>
                  <div className="font-semibold text-[#22a666]">{c.actualArrivalDate}</div>
                </div>
              )}
              {c.factoryName && (
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">공장</div>
                  <div className="font-semibold truncate">{c.factoryName}</div>
                </div>
              )}
              {c.destWarehouse && (
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">창고</div>
                  <div className="font-semibold truncate">{c.destWarehouse}</div>
                </div>
              )}
              {c.origin && (
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Origin</div>
                  <div className="font-semibold truncate">{c.origin}</div>
                </div>
              )}
            </div>

            {/* CBM bar */}
            <div>
              <div className="flex items-center justify-between text-[11px] mb-1.5">
                <span className="text-muted-foreground">CBM 적재율</span>
                <span className="font-semibold">
                  {totalCbm.toFixed(1)} / {c.cbmCapacity} m³
                  <span className="ml-1.5 text-muted-foreground">({Math.round(cbmUsedPct)}%)</span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-[#f0eee9] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${cbmUsedPct}%`, background: STATUS_COLOR[c.status] }}
                />
              </div>
            </div>

            {c.note && (
              <div className="text-[11px] text-muted-foreground bg-[#f5f4f0] rounded-lg px-3 py-2.5 leading-relaxed border border-[#e2dfd8]">
                {c.note}
              </div>
            )}
          </div>

          {/* SKU table */}
          <div className="px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                SKU 목록
              </span>
              <span className="text-[11px] text-muted-foreground">
                {c.items.length}종 · {totalQty.toLocaleString()} pcs
              </span>
            </div>

            {c.items.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-muted-foreground border border-dashed border-[#d8d6ce] rounded-lg">
                등록된 SKU가 없습니다
              </div>
            ) : (
              <div className="rounded-lg border border-[#e2dfd8] overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-[#f5f4f0] border-b border-[#e2dfd8]">
                      <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Master SKU</th>
                      <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Qty</th>
                      <th className="text-right px-3 py-2 font-semibold text-muted-foreground">CBM/Unit</th>
                      <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Total CBM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.items.map((item, i) => (
                      <tr
                        key={item.id || i}
                        className="border-b border-[#f0ede8] last:border-b-0 hover:bg-[#fafaf7] transition-colors"
                      >
                        <td className="px-3 py-2 font-mono font-semibold text-[#1a1917]">{item.sku}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{item.qty.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{item.cbm.toFixed(4)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">{(item.qty * item.cbm).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[#e2dfd8] bg-[#f5f4f0]">
                      <td className="px-3 py-2 font-semibold text-muted-foreground">Total ({c.items.length}종)</td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold">{totalQty.toLocaleString()}</td>
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2 text-right tabular-nums font-bold">{totalCbm.toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#e2dfd8] bg-[#fafaf7] shrink-0">
          <Link
            href={`/planning/container-planning?containerId=${c.id}`}
            className="flex items-center justify-center gap-1.5 w-full text-[12px] font-semibold text-[#1a5cdb] hover:text-[#1650c4] py-2 border border-[#1a5cdb]/30 rounded-lg hover:bg-[#ebf0fd] transition-colors"
          >
            Container Planning에서 열기
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </>
  );
}
