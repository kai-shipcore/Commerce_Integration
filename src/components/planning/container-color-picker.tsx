"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/lib/i18n/i18n-provider";

export const CONTAINER_CALENDAR_COLORS = [
  "#AD1457", "#D81B60", "#E67C73", "#F4511E", "#E53935", "#D50000",
  "#EF6C00", "#F09300", "#F6BF26", "#E4C441", "#C0CA33", "#7CB342",
  "#33B679", "#0B8043", "#039BE5", "#4285F4", "#3F51B5", "#7986CB",
  "#B39DDB", "#8E24AA", "#616161", "#A79B8E", "#009688", "#00ACC1",
] as const;

export function ContainerColorPicker({
  value,
  defaultColor,
  onChange,
  disabled = false,
  compact = false,
}: {
  value?: string | null;
  defaultColor: string;
  onChange: (color: string | null) => void | Promise<void>;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { pick } = useI18n();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const displayedColor = value || defaultColor;

  async function selectColor(color: string | null) {
    if (disabled || saving) return;
    setSaving(true);
    try {
      await onChange(color);
      setOpen(false);
    } catch {
      // The owning screen reports the save error and rolls back its optimistic color.
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled || saving}
          aria-label={pick("컨테이너 색상 변경", "Change container color")}
          title={disabled ? pick("색상 변경 권한이 없습니다", "You do not have permission to change the color") : pick("컨테이너 색상", "Container color")}
          className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-[#d8d6ce] bg-[#f3f6fb] text-muted-foreground transition-colors hover:bg-[#e9eef7] disabled:cursor-not-allowed disabled:opacity-60 ${compact ? "h-7 px-2" : "h-9 px-3"}`}
        >
          <span
            className={`${compact ? "h-4 w-4" : "h-5 w-5"} rounded-full border border-black/10`}
            style={{ backgroundColor: displayedColor }}
          />
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[332px] border-[#cfd5df] bg-[#f4f7fb] p-2 shadow-xl">
        <div className="grid grid-cols-12 gap-1.5 px-1 py-1">
          {CONTAINER_CALENDAR_COLORS.map((color) => {
            const selected = value?.toUpperCase() === color;
            return (
              <button
                key={color}
                type="button"
                disabled={saving}
                aria-label={color}
                aria-pressed={selected}
                onClick={() => void selectColor(color)}
                className="relative flex h-5 w-5 items-center justify-center rounded-full border border-black/5 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1a5cdb]"
                style={{ backgroundColor: color }}
              >
                {selected ? <Check className="h-3.5 w-3.5 text-white drop-shadow" strokeWidth={3} /> : null}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => void selectColor(null)}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-md bg-[#dfe5ee] px-3 py-1.5 text-sm font-medium text-[#4b5563] hover:bg-[#d4dce7] disabled:opacity-60"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ backgroundColor: defaultColor }}>
            {!value ? <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} /> : null}
          </span>
          {pick("기본값", "Default")}
        </button>
      </PopoverContent>
    </Popover>
  );
}
