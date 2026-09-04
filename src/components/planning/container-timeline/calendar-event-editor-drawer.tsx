"use client";

import { CalendarPlus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { ContainerColorPicker } from "@/components/planning/container-color-picker";
import { useI18n } from "@/lib/i18n/i18n-provider";

export interface TimelineCalendarEvent {
  id: string;
  title: string;
  eventDate: string;
  calendarColor: string;
}

export interface TimelineCalendarEventInput {
  title: string;
  eventDate: string;
  calendarColor: string;
}

const DEFAULT_EVENT_COLOR = "#4285F4";

export function CalendarEventEditorDrawer({ date, event, canEdit, onSave, onDelete, onClose }: {
  date: string;
  event?: TimelineCalendarEvent | null;
  canEdit: boolean;
  onSave: (input: TimelineCalendarEventInput, eventId?: string) => Promise<void>;
  onDelete: (eventId: string) => Promise<void>;
  onClose: () => void;
}) {
  const { pick } = useI18n();
  const [title, setTitle] = useState(event?.title ?? "");
  const [eventDate, setEventDate] = useState(event?.eventDate ?? date);
  const [calendarColor, setCalendarColor] = useState(event?.calendarColor ?? DEFAULT_EVENT_COLOR);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!title.trim() || !eventDate || saving) return;
    setSaving(true);
    try { await onSave({ title: title.trim(), eventDate, calendarColor }, event?.id); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (!event || saving || !window.confirm(pick(`'${event.title}' 이벤트를 삭제할까요?`, `Delete '${event.title}'?`))) return;
    setSaving(true);
    try { await onDelete(event.id); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/15 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="container-timeline-surface fixed right-0 z-40 flex w-[min(520px,calc(100vw-24px))] flex-col overflow-hidden border-l border-[#e2dfd8] bg-white shadow-2xl" style={{ top: "var(--app-header-height, 56px)", height: "calc(100% - var(--app-header-height, 56px))" }}>
        <div className="flex items-center justify-between border-b border-[#e2dfd8] px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-[#1a5cdb]"><CalendarPlus className="h-4 w-4" /></span>
            <div><h2 className="text-sm font-bold text-[#1a1917]">{event ? pick("Calendar Event 수정", "Edit Calendar Event") : pick("Calendar Event 생성", "Create Calendar Event")}</h2><p className="mt-0.5 text-[11px] text-muted-foreground">{pick("Container Timeline에서만 표시됩니다.", "Shown only in Container Timeline.")}</p></div>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full border border-[#d8d6ce] text-muted-foreground hover:bg-stone-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {pick("이벤트 이름", "Event name")}
            <input autoFocus value={title} disabled={!canEdit || saving} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void save(); }} placeholder={pick("이벤트 이름 입력", "Enter event name")} className="mt-1.5 h-11 w-full rounded-lg border border-[#d8d6ce] bg-white px-3 text-sm font-semibold outline-none placeholder:font-normal focus:border-[#1a5cdb] focus:ring-1 focus:ring-[#1a5cdb]/15 disabled:opacity-60" />
          </label>
          <label className="mt-5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {pick("날짜", "Date")}
            <input type="date" value={eventDate} disabled={!canEdit || saving} onChange={(e) => setEventDate(e.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-[#d8d6ce] bg-white px-3 font-mono text-sm font-semibold outline-none focus:border-[#1a5cdb] disabled:opacity-60" />
          </label>
          <div className="mt-5">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{pick("색상", "Color")}</div>
            <div className="flex items-center gap-3 rounded-lg border border-[#d8d6ce] bg-[#fafaf7] px-3 py-2.5">
              <ContainerColorPicker value={calendarColor} defaultColor={DEFAULT_EVENT_COLOR} disabled={!canEdit || saving} onChange={(color) => setCalendarColor(color ?? DEFAULT_EVENT_COLOR)} />
              <span className="text-xs font-medium text-stone-600">{pick("Calendar 표시 색상", "Calendar display color")}</span>
            </div>
          </div>
          <div className="mt-6 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2.5 text-[11px] leading-relaxed text-blue-700">
            <span className="h-3 w-3 shrink-0 rounded-full border border-black/10" style={{ backgroundColor: calendarColor }} />
            {pick("이 Event는 Container Planning 데이터와 연결되지 않습니다.", "This event is not linked to Container Planning data.")}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[#e2dfd8] px-6 py-4">
          <div>{event && canEdit && <button type="button" onClick={() => void remove()} disabled={saving} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />{pick("삭제", "Delete")}</button>}</div>
          <div className="flex gap-2"><button type="button" onClick={onClose} disabled={saving} className="h-9 rounded-lg border border-[#d8d6ce] bg-white px-4 text-xs font-semibold hover:bg-stone-50 disabled:opacity-50">{pick("취소", "Cancel")}</button><button type="button" onClick={() => void save()} disabled={!canEdit || !title.trim() || !eventDate || saving} className="h-9 rounded-lg bg-[#1a5cdb] px-5 text-xs font-semibold text-white hover:bg-[#1650c4] disabled:opacity-50">{saving ? pick("저장 중...", "Saving...") : pick("저장", "Save")}</button></div>
        </div>
      </aside>
    </>
  );
}
