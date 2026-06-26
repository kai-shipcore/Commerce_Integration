"use client";

import { useEffect, useRef, useState } from "react";
import { Calendar, Clock, MessageSquare, Package, Pencil, Plus, PlusCircle, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/i18n-provider";
import { apiPath } from "@/lib/api-path";
import type { ContainerAuditAction } from "@/lib/container-audit";

interface AuditEntry {
  id: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  action: ContainerAuditAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  note: string | null;
  createdAt: string;
}

function dateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultHistoryStartDate(): string {
  const date = new Date();
  date.setMonth(date.getMonth() - 1);
  return dateInputValue(date);
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  "final-list-sent": "Final List Sent",
  "packing-list-received": "Shipped (Packing List Rcvd)",
  complete: "Complete",
};

const STATUS_PILL: Record<string, string> = {
  draft: "bg-red-50 text-red-700",
  "final-list-sent": "bg-amber-50 text-amber-700",
  "packing-list-received": "bg-blue-50 text-blue-700",
  complete: "bg-emerald-50 text-emerald-700",
};

function initials(name: string | null, email: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return (parts.length >= 2 ? parts[0]![0]! + parts[parts.length - 1]![0]! : name.slice(0, 2)).toUpperCase();
  }
  return (email ?? "?").slice(0, 2).toUpperCase();
}

function formatTs(raw: string): { date: string; time: string } {
  const d = new Date(raw);
  return {
    date: d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }),
  };
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${STATUS_PILL[status] ?? "bg-stone-100 text-stone-600"}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function EntryIcon({ action }: { action: ContainerAuditAction }) {
  type IconEntry = { Icon: React.ComponentType<{ className?: string }>; bg: string; color: string };
  const map: Record<ContainerAuditAction, IconEntry> = {
    status_change:  { Icon: Clock,          bg: "bg-blue-50",    color: "text-blue-500" },
    eta_change:     { Icon: Calendar,       bg: "bg-amber-50",   color: "text-amber-500" },
    details_update: { Icon: Pencil,         bg: "bg-stone-100",  color: "text-stone-500" },
    items_update:   { Icon: Package,        bg: "bg-purple-50",  color: "text-purple-500" },
    note_added:     { Icon: MessageSquare,  bg: "bg-green-50",   color: "text-green-600" },
    create:         { Icon: PlusCircle,     bg: "bg-emerald-50", color: "text-emerald-600" },
    delete:         { Icon: Trash2,         bg: "bg-red-50",     color: "text-red-500" },
  };
  const { Icon, bg, color } = map[action] ?? map.details_update;
  return (
    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${bg}`}>
      <Icon className={`h-4 w-4 ${color}`} />
    </div>
  );
}

function BeforeAfter({ action, before, after }: Pick<AuditEntry, "action" | "before" | "after">) {
  if (action === "status_change" && before && after) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <div className="text-right">
          <div className="mb-0.5 text-[9px] uppercase tracking-wide text-stone-400">Before</div>
          <StatusBadge status={String(before.status)} />
        </div>
        <span className="text-[10px] text-stone-300">→</span>
        <div>
          <div className="mb-0.5 text-[9px] uppercase tracking-wide text-stone-400">After</div>
          <StatusBadge status={String(after.status)} />
        </div>
      </div>
    );
  }
  if (action === "eta_change") {
    return (
      <div className="flex shrink-0 items-center gap-2 text-[12px]">
        <div className="text-right">
          <div className="mb-0.5 text-[9px] uppercase tracking-wide text-stone-400">Before</div>
          <span className="font-medium text-stone-500">{String(before?.eta ?? "—")}</span>
        </div>
        <span className="text-[10px] text-stone-300">→</span>
        <div>
          <div className="mb-0.5 text-[9px] uppercase tracking-wide text-stone-400">After</div>
          <span className="font-semibold text-amber-600">{String(after?.eta ?? "—")}</span>
        </div>
      </div>
    );
  }
  if (action === "items_update" && before && after) {
    return (
      <div className="flex shrink-0 items-center gap-2 text-[11px]">
        <div className="text-right leading-snug">
          <div className="mb-0.5 text-[9px] uppercase tracking-wide text-stone-400">Before</div>
          <span className="text-stone-500">{Number(before.skuCount)} SKUs</span><br />
          <span className="tabular-nums text-stone-500">{Number(before.totalQty).toLocaleString()} units</span>
        </div>
        <span className="text-[10px] text-stone-300">→</span>
        <div className="leading-snug">
          <div className="mb-0.5 text-[9px] uppercase tracking-wide text-stone-400">After</div>
          <span className="font-semibold text-[#1a5cdb]">{Number(after.skuCount)} SKUs</span><br />
          <span className="tabular-nums font-semibold text-[#1a5cdb]">{Number(after.totalQty).toLocaleString()} units</span>
        </div>
      </div>
    );
  }
  return null;
}

function HistoryEntry({ entry }: { entry: AuditEntry }) {
  const { pick } = useI18n();
  const { date, time } = formatTs(entry.createdAt);
  const userLabel = entry.userName ?? entry.userEmail ?? pick("알 수 없음", "Unknown");
  const userInitials = initials(entry.userName, entry.userEmail);

  const actionLabel = (() => {
    switch (entry.action) {
      case "status_change":  return pick("상태 변경", "Status changed");
      case "eta_change":     return pick("ETA 변경", "ETA changed");
      case "details_update": return pick("정보 수정", "Details updated");
      case "items_update": {
        const n = Number(entry.after?.skuCount ?? 0);
        return pick(`SKU ${n}개 수정됨`, `${n} SKU items updated`);
      }
      case "note_added":  return pick("메모", "Note");
      case "create":      return pick("컨테이너 생성", "Container created");
      case "delete":      return pick("컨테이너 삭제", "Container deleted");
      default:            return entry.action;
    }
  })();

  const subLabel = (() => {
    const fieldKo: Record<string, string> = { factory: "공장", destWarehouse: "창고", eta: "ETA", estLoading: "예상 선적일", etdNgb: "ETD NGB", etaLaxLgb: "ETA LAX/LGB", cbmCapacity: "CBM", note: "메모", status: "상태" };
    const fieldEn: Record<string, string> = { factory: "Factory", destWarehouse: "Warehouse", eta: "ETA", estLoading: "Est. Loading", etdNgb: "ETD NGB", etaLaxLgb: "ETA LAX/LGB", cbmCapacity: "CBM", note: "Note", status: "Status" };
    switch (entry.action) {
      case "status_change": {
        const b = STATUS_LABEL[String(entry.before?.status)] ?? String(entry.before?.status ?? "");
        const a = STATUS_LABEL[String(entry.after?.status)] ?? String(entry.after?.status ?? "");
        return `${b} → ${a}`;
      }
      case "eta_change":
        return `${String(entry.before?.eta ?? "—")} → ${String(entry.after?.eta ?? "—")}`;
      case "items_update":
        return pick("SKU 추가·삭제 또는 수량 변경", "Items added, removed, or quantity changed");
      case "details_update": {
        if (entry.before && entry.after) {
          const changed = Object.keys(fieldKo).filter((k) => String(entry.before![k] ?? "") !== String(entry.after![k] ?? ""));
          if (changed.length > 0) return changed.map((k) => pick(fieldKo[k]!, fieldEn[k]!)).join(", ");
        }
        return "";
      }
      case "create":   return pick("신규 컨테이너 (Draft)", "New container (Draft)");
      case "delete":   return pick("컨테이너가 삭제되었습니다.", "Container was deleted.");
      case "note_added": return entry.note ?? "";
      default:         return "";
    }
  })();

  const beAfter = <BeforeAfter action={entry.action} before={entry.before} after={entry.after} />;

  return (
    <div className="flex items-start gap-3 py-4 border-b border-[#f0ede7] last:border-b-0">
      <EntryIcon action={entry.action} />

      {/* User avatar */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e8e5df] text-[10px] font-bold text-[#6b6359]">
        {userInitials}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[12px] font-semibold text-[#1a1917]">{userLabel}</span>
          <span className="text-[10px] text-stone-400">{date} · {time}</span>
        </div>
        <div className="mt-0.5 text-[12px] font-semibold text-[#1a1917]">{actionLabel}</div>
        {subLabel && (
          <div className="mt-0.5 text-[11px] leading-relaxed text-stone-500">
            {entry.action === "note_added" ? (
              <span className="italic">"{subLabel}"</span>
            ) : (
              subLabel
            )}
          </div>
        )}
      </div>

      {/* Before / After */}
      {beAfter && <div className="shrink-0 pl-2">{beAfter}</div>}
    </div>
  );
}

export function ContainerHistoryTab({ containerId }: { containerId: string }) {
  const { pick } = useI18n();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNote, setShowNote] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [userFilter, setUserFilter] = useState("");
  const [startDate, setStartDate] = useState(defaultHistoryStartDate);
  const [endDate, setEndDate] = useState(() => dateInputValue(new Date()));
  const [actionFilter, setActionFilter] = useState("all");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function fetchEntries() {
    const params = new URLSearchParams();
    if (userFilter.trim()) params.set("user", userFilter.trim());
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (actionFilter !== "all") params.set("action", actionFilter);
    const query = params.toString();

    fetch(apiPath(`/api/containers/${containerId}/history${query ? `?${query}` : ""}`))
      .then((r) => r.json())
      .then((json: { success: boolean; data: AuditEntry[] }) => {
        if (json.success) setEntries(json.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    setLoading(true);
    setEntries([]);
    fetchEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerId, userFilter, startDate, endDate, actionFilter]);

  useEffect(() => {
    if (showNote) textareaRef.current?.focus();
  }, [showNote]);

  async function handleAddNote() {
    if (!noteText.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(apiPath(`/api/containers/${containerId}/history`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: noteText.trim() }),
      });
      if (res.ok) {
        setNoteText("");
        setShowNote(false);
        setLoading(true);
        fetchEntries();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* Sub-header with Add note button */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#e2dfd8] px-6 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {pick("변경 이력", "Change History")}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <input
            type="search"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            placeholder={pick("사용자 검색...", "Search user...")}
            className="h-8 min-w-[150px] rounded-md border border-[#d1c9be] bg-white px-2.5 text-[11px] outline-none focus:border-[#1a5cdb] focus:ring-1 focus:ring-[#1a5cdb]/20"
          />
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-label={pick("시작일", "Start date")}
            className="h-8 w-[130px] rounded-md border border-[#d1c9be] bg-white px-2 text-[11px] outline-none focus:border-[#1a5cdb] focus:ring-1 focus:ring-[#1a5cdb]/20"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            aria-label={pick("종료일", "End date")}
            className="h-8 w-[130px] rounded-md border border-[#d1c9be] bg-white px-2 text-[11px] outline-none focus:border-[#1a5cdb] focus:ring-1 focus:ring-[#1a5cdb]/20"
          />
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="h-8 min-w-[140px] rounded-md border border-[#d1c9be] bg-white px-2 text-[11px] outline-none focus:border-[#1a5cdb] focus:ring-1 focus:ring-[#1a5cdb]/20"
          >
            <option value="all">{pick("모든 변경 유형", "All actions")}</option>
            <option value="status_change">{pick("상태 변경", "Status Change")}</option>
            <option value="eta_change">{pick("ETA 수정", "ETA Change")}</option>
            <option value="details_update">{pick("정보 수정", "Details Update")}</option>
            <option value="items_update">{pick("수량/SKU 변경", "Item Change")}</option>
            <option value="note_added">{pick("메모", "Note")}</option>
            <option value="create">{pick("생성", "Create")}</option>
            <option value="delete">{pick("삭제", "Delete")}</option>
          </select>
        </div>
        <button
          type="button"
          onClick={() => setShowNote((v) => !v)}
          className="flex items-center gap-1 rounded-md border border-[#d1c9be] px-2.5 py-1 text-[11px] font-semibold text-[#4a3f33] transition-colors hover:bg-[#f5f4f0]"
        >
          <Plus className="h-3 w-3" />
          {pick("메모 추가", "Add note")}
        </button>
      </div>

      {/* Note textarea */}
      {showNote && (
        <div className="shrink-0 border-b border-[#e2dfd8] bg-[#fafaf7] px-6 py-3">
          <textarea
            ref={textareaRef}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handleAddNote(); }}
            placeholder={pick("메모를 입력하세요 (Ctrl+Enter로 저장)...", "Add a note (Ctrl+Enter to save)...")}
            rows={3}
            className="w-full resize-none rounded-md border border-[#d1c9be] bg-white px-3 py-2 text-[12px] leading-relaxed outline-none placeholder:text-stone-400 focus:border-[#1a5cdb] focus:ring-1 focus:ring-[#1a5cdb]/20"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => { setShowNote(false); setNoteText(""); }}
              className="px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {pick("취소", "Cancel")}
            </button>
            <button
              type="button"
              onClick={() => void handleAddNote()}
              disabled={!noteText.trim() || saving}
              className="rounded-md bg-[#1a5cdb] px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-[#1650c4] disabled:opacity-50"
            >
              {saving ? pick("저장 중...", "Saving...") : pick("저장", "Save")}
            </button>
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6">
        {loading ? (
          <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
            {pick("불러오는 중...", "Loading...")}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="rounded-lg border border-dashed border-[#d8d6ce] px-8 py-10 text-center">
              <p className="text-[12px] text-muted-foreground">{pick("변경 이력이 없습니다.", "No history yet.")}</p>
              <p className="mt-1 text-[11px] text-stone-400">{pick("상태 변경 또는 수정 시 자동 기록됩니다.", "Changes are recorded automatically.")}</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-[#f0ede7]">
            {entries.map((entry) => (
              <HistoryEntry key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
