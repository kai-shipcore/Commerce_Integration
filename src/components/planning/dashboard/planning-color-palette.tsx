"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pipette, RotateCcw, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const COLOR_ROWS = [
  ["#000000", "#434343", "#666666", "#999999", "#B7B7B7", "#CCCCCC", "#D9D9D9", "#EFEFEF", "#F3F3F3", "#FFFFFF"],
  ["#980000", "#FF0000", "#FF9900", "#FFFF00", "#00FF00", "#00FFFF", "#4A86E8", "#0000FF", "#9900FF", "#FF00FF"],
  ["#E6B8AF", "#F4CCCC", "#FCE5CD", "#FFF2CC", "#D9EAD3", "#D0E0E3", "#C9DAF8", "#CFE2F3", "#D9D2E9", "#EAD1DC"],
  ["#DD7E6B", "#EA9999", "#F9CB9C", "#FFE599", "#B6D7A8", "#A2C4C9", "#A4C2F4", "#9FC5E8", "#B4A7D6", "#D5A6BD"],
  ["#CC4125", "#E06666", "#F6B26B", "#FFD966", "#93C47D", "#76A5AF", "#6D9EEB", "#6FA8DC", "#8E7CC3", "#C27BA0"],
  ["#A61C00", "#CC0000", "#E69138", "#F1C232", "#6AA84F", "#45818E", "#3C78D8", "#3D85C6", "#674EA7", "#A64D79"],
  ["#85200C", "#990000", "#B45F06", "#BF9000", "#38761D", "#134F5C", "#1155CC", "#0B5394", "#351C75", "#741B47"],
  ["#5B0F00", "#660000", "#783F04", "#7F6000", "#274E13", "#0C343D", "#1C4587", "#073763", "#20124D", "#4C1130"],
] as const;

const STANDARD_COLORS = ["#000000", "#FFFFFF", "#EA4335", "#FB8C00", "#FABB05", "#34A853", "#24C1E0", "#4285F4", "#7E57C2", "#EC407A"] as const;
export const PLANNING_CUSTOM_COLORS_STORAGE_KEY = "planning-dashboard-custom-colors";
const CUSTOM_COLORS_CHANGED_EVENT = "planning-custom-colors-changed";
const HEX_COLOR = /^#[0-9A-F]{6}$/;

export function normalizeSavedCustomColors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .filter((color): color is string => typeof color === "string")
    .map((color) => color.trim().toUpperCase())
    .filter((color) => HEX_COLOR.test(color))))
    .slice(0, 20);
}

export function addSavedCustomColor(colors: string[], color: string): string[] {
  const normalized = color.trim().toUpperCase();
  if (!HEX_COLOR.test(normalized)) return normalizeSavedCustomColors(colors);
  return [normalized, ...normalizeSavedCustomColors(colors).filter((entry) => entry !== normalized)].slice(0, 20);
}

export function removeSavedCustomColor(colors: string[], color: string): string[] {
  const normalized = color.trim().toUpperCase();
  return normalizeSavedCustomColors(colors).filter((entry) => entry !== normalized);
}

function loadSavedCustomColors(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return normalizeSavedCustomColors(JSON.parse(window.localStorage.getItem(PLANNING_CUSTOM_COLORS_STORAGE_KEY) ?? "[]"));
  } catch {
    window.localStorage.removeItem(PLANNING_CUSTOM_COLORS_STORAGE_KEY);
    return [];
  }
}

function checkColor(color: string) {
  const hex = color.replace("#", "");
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 > 155 ? "#1A1917" : "#FFFFFF";
}

function DeferredCustomColor({ value, label, onCommit }: { value: string; label: string; onCommit: (color: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef(value.toUpperCase());
  const committedRef = useRef(value.toUpperCase());
  const timerRef = useRef<number | null>(null);
  const onCommitRef = useRef(onCommit);
  useEffect(() => { onCommitRef.current = onCommit; }, [onCommit]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const commit = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      if (pendingRef.current === committedRef.current) return;
      committedRef.current = pendingRef.current;
      onCommitRef.current(pendingRef.current);
    };
    const handleInput = () => { pendingRef.current = input.value.toUpperCase(); };
    const handleChange = () => {
      handleInput();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(commit, 120);
    };
    input.addEventListener("input", handleInput);
    input.addEventListener("change", handleChange);
    input.addEventListener("blur", commit);
    return () => {
      input.removeEventListener("input", handleInput);
      input.removeEventListener("change", handleChange);
      input.removeEventListener("blur", commit);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  return <input ref={inputRef} type="color" defaultValue={value} aria-label={label} style={{ height: 1, opacity: 0, position: "absolute", width: 1 }} />;
}

export function PlanningColorPalettePopover({
  trigger,
  currentColor,
  targetLabel,
  ariaKind,
  onApply,
  onReset,
}: {
  trigger: ReactNode;
  currentColor: string;
  targetLabel: string;
  ariaKind: "fill" | "font";
  onApply: (color: string) => void;
  onReset: () => boolean | void;
}) {
  const [open, setOpen] = useState(false);
  const [savedCustomColors, setSavedCustomColors] = useState<string[]>([]);
  useEffect(() => {
    const refresh = () => setSavedCustomColors(loadSavedCustomColors());
    refresh();
    window.addEventListener(CUSTOM_COLORS_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CUSTOM_COLORS_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  const persistCustomColors = (colors: string[]) => {
    setSavedCustomColors(colors);
    window.localStorage.setItem(PLANNING_CUSTOM_COLORS_STORAGE_KEY, JSON.stringify(colors));
    window.dispatchEvent(new Event(CUSTOM_COLORS_CHANGED_EVENT));
  };
  const applyAndClose = (color: string) => {
    onApply(color.toUpperCase());
    setOpen(false);
  };
  const saveApplyAndClose = (color: string) => {
    persistCustomColors(addSavedCustomColor(savedCustomColors, color));
    applyAndClose(color);
  };
  const resetAndClose = () => {
    if (onReset() !== false) setOpen(false);
  };
  const selected = currentColor.toUpperCase();
  const colorButton = (color: string, label: string) => (
    <button key={label} type="button" aria-label={label} title={color} onClick={() => applyAndClose(color)} style={{ alignItems: "center", background: color, border: color === "#FFFFFF" ? "1px solid #CBD5E1" : "1px solid transparent", borderRadius: "50%", color: checkColor(color), cursor: "pointer", display: "inline-flex", fontSize: 13, fontWeight: 800, height: 19, justifyContent: "center", lineHeight: 1, padding: 0, width: 19 }}>
      {selected === color ? "✓" : null}
    </button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} style={{ background: "#FFFFFF", boxShadow: "0 10px 28px rgba(15,23,42,.2)", opacity: 1, width: 244, padding: 10, zIndex: 160 }}>
        <div style={{ color: "#64748B", fontSize: 10, fontWeight: 700, marginBottom: 7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={targetLabel}>{targetLabel}</div>
        <button type="button" onClick={resetAndClose} style={{ alignItems: "center", background: "transparent", border: "none", color: "#334155", cursor: "pointer", display: "flex", fontSize: 12, gap: 7, marginBottom: 8, padding: "2px 0" }}>
          <RotateCcw size={14} aria-hidden="true" /> Reset
        </button>
        <div style={{ display: "grid", gap: 3, gridTemplateColumns: "repeat(10, 19px)" }}>
          {COLOR_ROWS.flat().map((color, index) => colorButton(color, `Set ${ariaKind} color ${color}-${index}`))}
        </div>
        <div style={{ borderTop: "1px solid #CBD5E1", color: "#475569", fontSize: 9, fontWeight: 700, letterSpacing: ".04em", marginTop: 9, paddingTop: 7 }}>STANDARD</div>
        <div style={{ display: "flex", gap: 3, marginTop: 5 }}>
          {STANDARD_COLORS.map((color) => colorButton(color, `Set standard ${ariaKind} color ${color}`))}
        </div>
        <div style={{ borderTop: "1px solid #CBD5E1", color: "#475569", fontSize: 9, fontWeight: 700, letterSpacing: ".04em", marginTop: 9, paddingTop: 7 }}>CUSTOM</div>
        {savedCustomColors.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
            {savedCustomColors.map((color) => (
              <span key={color} style={{ display: "inline-flex", position: "relative" }}>
                {colorButton(color, `Set saved ${ariaKind} color ${color}`)}
                <button
                  type="button"
                  aria-label={`Delete saved color ${color}`}
                  title={`Delete ${color}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    persistCustomColors(removeSavedCustomColor(savedCustomColors, color));
                  }}
                  style={{ alignItems: "center", background: "#FFFFFF", border: "1px solid #CBD5E1", borderRadius: "50%", color: "#475569", cursor: "pointer", display: "inline-flex", height: 12, justifyContent: "center", padding: 0, position: "absolute", right: -4, top: -4, width: 12 }}
                >
                  <X size={8} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <label title={`Choose custom ${ariaKind} color`} style={{ alignItems: "center", cursor: "pointer", display: "inline-flex", gap: 6, marginTop: 6, position: "relative" }}>
          <span aria-hidden="true" style={{ background: selected, border: "1px solid #CBD5E1", borderRadius: "50%", height: 19, width: 19 }} />
          <Pipette size={15} aria-hidden="true" />
          <span style={{ color: "#475569", fontSize: 11 }}>Add custom color</span>
          <DeferredCustomColor key={selected} value={selected} label={`Custom ${ariaKind} color`} onCommit={saveApplyAndClose} />
        </label>
      </PopoverContent>
    </Popover>
  );
}
