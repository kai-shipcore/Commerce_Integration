"use client";

/**
 * The demand grid toolbar's checkbox dropdown, shared by the category, type
 * and status filters.
 *
 * An empty selection means "no constraint", not "match nothing" — the button
 * then reads as its all-label. That is the rule the row predicates in
 * columns.ts follow, and the one the SKU Master toolbar already uses.
 *
 * Two commit modes. "immediate" is for the filters that only re-run a
 * predicate over rows already in the browser, where a tick can take effect at
 * once. "apply" stages the ticks and reports them on a button, for the
 * category filter: that one refetches, and a tick-by-tick commit would send a
 * request for every box on the way to the set the reader actually wanted.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/i18n-provider";

export interface ToolbarMultiSelectOption<T extends string> {
  value: T;
  label: string;
  /** Applied to the button when this is the only thing picked, so a single
   *  choice still reads at a glance the way the old select did. */
  tone?: { border: string; background: string; color: string };
}

export interface ToolbarMultiSelectPreset<T extends string> {
  label: string;
  values: T[];
}

const NEUTRAL_TONE = { border: "#C2BFB5", background: "#fff", color: "#1A1917" };
const ACTIVE_TONE = { border: "#A9C0EE", background: "#E5EEFF", color: "#1A4FC0" };

/** "All" with nothing picked, the labels themselves for one or two, and a
 *  count past that — the form already used for the SKU part filters and the
 *  SKU Master category picker. */
export function summarizeSelection(labels: string[], allLabel: string): string {
  if (labels.length === 0) return allLabel;
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
}

export function ToolbarMultiSelect<T extends string>({
  ariaLabel,
  allLabel,
  options,
  value,
  onChange,
  presets,
  commit = "immediate",
  width = 150,
}: {
  ariaLabel: string;
  allLabel: string;
  options: ToolbarMultiSelectOption<T>[];
  value: T[];
  onChange: (next: T[]) => void;
  presets?: ToolbarMultiSelectPreset<T>[];
  commit?: "immediate" | "apply";
  width?: number;
}) {
  const { pick } = useI18n();
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  // What the boxes show. In "apply" mode this runs ahead of the committed
  // value until the reader presses the button; closing any other way drops it.
  const [staged, setStaged] = useState<T[]>(value);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Memoised because the outside-click listener below closes over it: a stale
  // copy would reseed the boxes from a value that has since moved on.
  const closeAndDiscard = useCallback(() => {
    setStaged(value);
    setOpen(false);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeAndDiscard();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAndDiscard();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeAndDiscard, open]);

  // The button always reports what is committed, never what is staged: it has
  // to keep saying what the grid is actually showing.
  const committed = new Set(value);
  const pickedLabels = options.filter((option) => committed.has(option.value)).map((option) => option.label);
  const onlyPicked = value.length === 1 ? options.find((option) => option.value === value[0]) : undefined;
  const tone = value.length === 0 ? NEUTRAL_TONE : onlyPicked?.tone ?? ACTIVE_TONE;

  const selected = new Set(staged);
  const dirty = commit === "apply"
    && (staged.length !== value.length || staged.some((entry) => !committed.has(entry)));

  /** In immediate mode the staged set is the committed one, so every change
   *  goes out as it is made. */
  function setSelection(next: T[]) {
    setStaged(next);
    if (commit === "immediate") onChange(next);
  }

  function toggle(option: T) {
    setSelection(selected.has(option) ? staged.filter((entry) => entry !== option) : [...staged, option]);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => {
            const next = !current;
            // Fixed, not absolute: the toolbar scrolls horizontally, which
            // makes overflow-y compute as auto and clips an absolutely
            // positioned menu. Same fix as the SKU Master toolbar.
            if (next) {
              setStaged(value);
              const rect = buttonRef.current?.getBoundingClientRect();
              if (rect) setMenuPos({ top: rect.bottom + 4, left: rect.left });
            }
            return next;
          });
        }}
        style={{
          height: 26,
          width,
          padding: "2px 7px",
          borderRadius: 4,
          border: `1px solid ${tone.border}`,
          background: tone.background,
          color: tone.color,
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 4,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {summarizeSelection(pickedLabels, allLabel)}
        </span>
        <span aria-hidden="true" style={{ flexShrink: 0, fontSize: 9, opacity: 0.7 }}>&#9662;</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="group"
          aria-label={ariaLabel}
          style={{
            position: "fixed",
            top: menuPos?.top ?? 0,
            left: menuPos?.left ?? 0,
            zIndex: 60,
            minWidth: Math.max(width, 168),
            padding: 6,
            borderRadius: 6,
            border: "1px solid #CBD5E1",
            background: "#fff",
            boxShadow: "0 8px 24px rgba(15,23,42,.16)",
          }}
        >
          {presets?.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, paddingBottom: 6, marginBottom: 4, borderBottom: "1px solid #F1F5F9" }}>
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setSelection(preset.values)}
                  style={{
                    padding: "2px 6px",
                    borderRadius: 4,
                    border: "1px solid #E2E8F0",
                    background: "#F8FAFC",
                    color: "#475569",
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          ) : null}

          {options.map((option) => {
            const checked = selected.has(option.value);
            return (
              <label
                key={option.value}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "3px 4px",
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: checked ? 700 : 500,
                  color: checked ? "#1A4FC0" : "#1A1917",
                  background: checked ? "#EFF4FF" : undefined,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(option.value)}
                  style={{ width: 13, height: 13, cursor: "pointer", accentColor: "#2563EB" }}
                />
                <span>{option.label}</span>
              </label>
            );
          })}

          <div style={{ display: "flex", justifyContent: "space-between", gap: 6, paddingTop: 6, marginTop: 4, borderTop: "1px solid #F1F5F9", fontSize: 11 }}>
            <button
              type="button"
              onClick={() => setSelection(options.map((option) => option.value))}
              style={{ background: "none", border: "none", padding: 0, color: "#64748B", cursor: "pointer" }}
            >
              {pick("모두 선택", "Select all")}
            </button>
            <button
              type="button"
              onClick={() => setSelection([])}
              style={{ background: "none", border: "none", padding: 0, color: "#64748B", cursor: "pointer" }}
            >
              {pick("모두 지우기", "Clear")}
            </button>
          </div>

          {commit === "apply" && (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, paddingTop: 6, marginTop: 4, borderTop: "1px solid #F1F5F9" }}>
              <button
                type="button"
                onClick={closeAndDiscard}
                style={{
                  padding: "4px 10px",
                  borderRadius: 4,
                  border: "1px solid #CBD5E1",
                  background: "#fff",
                  color: "#475569",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {pick("취소", "Cancel")}
              </button>
              <button
                type="button"
                disabled={!dirty}
                onClick={() => {
                  onChange(staged);
                  setOpen(false);
                }}
                style={{
                  padding: "4px 12px",
                  borderRadius: 4,
                  border: "1px solid",
                  borderColor: dirty ? "#1D4ED8" : "#CBD5E1",
                  background: dirty ? "#2563EB" : "#F1F5F9",
                  color: dirty ? "#fff" : "#94A3B8",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: dirty ? "pointer" : "default",
                }}
              >
                {pick("적용", "Apply")}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
