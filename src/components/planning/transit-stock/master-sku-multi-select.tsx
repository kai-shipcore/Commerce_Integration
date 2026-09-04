"use client";

/**
 * Code Guide:
 * Master SKU picker for the Transit Stock "Add Record" dialog: click the field,
 * get the active master SKU list, type to filter, tick as many as you need.
 *
 * It replaces a free-text input. That input had no list and no existence check
 * on either side, so a mistyped SKU was saved to fc_transit_records and then
 * quietly did nothing: syncStats() only updates fc_stats rows that match an
 * existing master_sku, so the transit qty landed nowhere. Selection is
 * therefore restricted to what this list returns.
 *
 * Hand-rolled rather than the shared Command/Popover combobox in
 * src/components/ui: this dialog is a hand-built fixed overlay and its dark
 * mode comes from `.dark .transit-stock-fullbleed [style*="…"]` rules in
 * globals.css, which a Radix portal would render outside of. Inline `#fff` /
 * `#f1f5f9` / `#EFF6FF` backgrounds below are the colors those rules key on.
 *
 * Results are capped, not paged (same reasoning as SkuFinder in
 * planning/action-list): 50 visible matches means the reader has not typed
 * enough to be choosing between them, and the footer says how many were left
 * off. The list comes from the server so it never has to hold every SKU.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

const PAGE_LIMIT = 50;
const DEBOUNCE_MS = 200;

export function MasterSkuMultiSelect({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const { pick } = useI18n();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  // Flag, not a message: keeping the text out of the effect keeps `pick` (and
  // therefore a locale switch) from re-triggering the fetch.
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const selected = new Set(value);
  // Clamped on read: the list shrinks as the reader types, and moving the
  // highlight back with a setState in an effect would cost a second render on
  // every keystroke.
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ search: search.trim(), limit: String(PAGE_LIMIT) });
      fetch(apiPath(`/api/planning/transit-records/master-skus?${params.toString()}`), {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((res) => res.json())
        .then((json) => {
          if (!json.success) throw new Error(json.error ?? "request failed");
          setOptions(json.data as string[]);
          setTotal(Number(json.total ?? 0));
          setFailed(false);
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === "AbortError") return;
          setOptions([]);
          setTotal(0);
          setFailed(true);
        })
        .finally(() => setLoading(false));
      // Only the debounce is skipped on the first open; typing waits.
    }, search.trim() ? DEBOUNCE_MS : 0);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, search]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = (sku: string) => {
    onChange(selected.has(sku) ? value.filter((s) => s !== sku) : [...value, sku]);
  };

  const summary =
    value.length === 0
      ? pick("클릭해서 SKU 선택...", "Click to select SKUs...")
      : pick(`${value.length}개 선택됨`, `${value.length} selected`);

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <div style={{ position: "relative" }}>
        <Search
          size={13}
          style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", pointerEvents: "none" }}
        />
        <input
          className="form-input bg-white"
          style={{ paddingLeft: 26, paddingRight: 26 }}
          // Closed, the field reads as the summary rather than a grey
          // placeholder. Focus opens the panel and swaps in the (empty) search
          // term before any keystroke lands, so typing never edits the summary.
          value={open ? search : value.length > 0 ? summary : ""}
          placeholder={open ? pick("SKU 검색...", "Search SKUs...") : summary}
          disabled={disabled}
          role="combobox"
          aria-expanded={open}
          aria-controls="transit-master-sku-list"
          aria-autocomplete="list"
          autoComplete="off"
          onChange={(e) => {
            setSearch(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive(Math.min(options.length - 1, activeIndex + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive(Math.max(0, activeIndex - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const option = options[activeIndex];
              // Stays open: picking one SKU is rarely the whole job here.
              if (option) toggle(option);
            } else if (e.key === "Escape") {
              setOpen(false);
              setSearch("");
            }
          }}
        />
        <ChevronDown
          size={14}
          style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", pointerEvents: "none" }}
        />
      </div>

      {open && (
        <div
          id="transit-master-sku-list"
          role="listbox"
          aria-multiselectable
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "100%",
            marginTop: 4,
            zIndex: 30,
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            boxShadow: "0 6px 20px rgba(0,0,0,.12)",
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          {failed ? (
            <div style={{ padding: "8px 10px", fontSize: 12, color: "#dc2626", fontWeight: 600 }}>
              {pick("SKU 목록을 불러올 수 없습니다.", "Could not load the SKU list.")}
            </div>
          ) : loading && options.length === 0 ? (
            <div style={{ padding: "8px 10px", fontSize: 12, color: "#94a3b8" }}>{pick("불러오는 중...", "Loading...")}</div>
          ) : options.length === 0 ? (
            <div style={{ padding: "8px 10px", fontSize: 12, color: "#94a3b8" }}>{pick("결과가 없습니다.", "No results.")}</div>
          ) : (
            <>
              {options.map((sku, i) => {
                const isSelected = selected.has(sku);
                return (
                  <button
                    key={sku}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => toggle(sku)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      padding: "6px 10px",
                      border: "none",
                      textAlign: "left",
                      cursor: "pointer",
                      fontSize: 12,
                      fontFamily: "monospace",
                      fontWeight: isSelected ? 700 : 400,
                      background: isSelected ? "#EFF6FF" : i === activeIndex ? "#f1f5f9" : "#fff",
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 14,
                        height: 14,
                        flexShrink: 0,
                        borderRadius: 3,
                        border: `1px solid ${isSelected ? "#1a5cdb" : "#cbd5e1"}`,
                        background: isSelected ? "#1a5cdb" : "#fff",
                        color: "#fff",
                        fontSize: 10,
                        lineHeight: 1,
                      }}
                    >
                      {isSelected ? "✓" : ""}
                    </span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sku}</span>
                  </button>
                );
              })}
              {total > options.length && (
                <div style={{ padding: "6px 10px", borderTop: "1px solid #f1f5f9", fontSize: 11, color: "#94a3b8" }}>
                  {pick(
                    `${total}개 중 ${options.length}개 표시. 더 입력해 좁히세요.`,
                    `Showing ${options.length} of ${total}. Type more to narrow.`,
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
