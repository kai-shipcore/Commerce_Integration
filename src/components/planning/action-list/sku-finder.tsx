"use client";

/**
 * Code Guide:
 * Jump to any forecastable SKU from the detail page.
 *
 * This replaces a plain <select> of the worklist sequence. That control had two
 * problems and they compounded: a native select of several hundred options can
 * only be searched by typing a prefix into a dropdown that gives no feedback,
 * and it held only the SKUs left after the list page's filters, so a SKU the
 * reader could name was unreachable without going back and clearing filters
 * first.
 *
 * One control does both jobs. Closed, it is the sequence: the SKU you are on
 * and its position. Typing searches every forecastable SKU, and results outside
 * the current filtered list are shown with a marker rather than hidden, because
 * "not in your current filter" is a different answer from "does not exist" and
 * the reader needs to be able to tell which they got.
 *
 * No fetch. The detail response already carries every forecastable SKU in
 * `skus` for exactly this purpose; the sequence is the narrower list the reader
 * arrived with. Both are in memory, so this is a filter over an array rather
 * than a search endpoint that would have to be built and kept in step with the
 * run.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useI18n } from "@/lib/i18n/i18n-provider";

/** Results rendered at once. The list is capped rather than paged: a reader who
 *  can see 50 matches has not typed enough to be choosing between them, and the
 *  count line says how many were left off. */
const MAX_RESULTS = 50;

export function SkuFinder({
  current,
  sequence,
  all,
  onSelect,
}: {
  current: string;
  /** The filtered, sorted list the reader arrived from. */
  sequence: string[];
  /** Every forecastable SKU in the run. */
  all: string[];
  onSelect: (sku: string) => void;
}) {
  const { pick } = useI18n();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const inSequence = useMemo(() => new Set(sequence), [sequence]);

  const results = useMemo(() => {
    const q = query.trim().toUpperCase();
    // Empty query shows the sequence, so opening the control without typing
    // gives the same list the old select did, in the order the reader chose.
    const pool = q ? all : sequence;
    if (!q) return pool.slice(0, MAX_RESULTS);
    // Prefix matches first: someone typing "CC-1" wants the SKUs that start
    // that way above the ones that merely contain it somewhere.
    const starts: string[] = [];
    const contains: string[] = [];
    for (const s of pool) {
      const u = s.toUpperCase();
      if (u.startsWith(q)) starts.push(s);
      else if (u.includes(q)) contains.push(s);
    }
    return [...starts, ...contains].slice(0, MAX_RESULTS);
  }, [query, all, sequence]);

  const total = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return sequence.length;
    return all.reduce((n, s) => (s.toUpperCase().includes(q) ? n + 1 : n), 0);
  }, [query, all, sequence]);

  // Clamped on read rather than reset in an effect. The highlight has to stay
  // inside a result list that shrinks as the reader types, and doing that with
  // a setState in an effect costs a second render pass on every keystroke and
  // is what react-hooks/set-state-in-effect exists to prevent. Typing already
  // sends it back to 0 in the change handler; this only guards the case where
  // the list shrinks under a highlight that was legal a moment ago.
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const choose = (sku: string) => {
    setOpen(false);
    setQuery("");
    onSelect(sku);
  };

  const position = sequence.indexOf(current);

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={open ? query : current}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={(e) => {
            setOpen(true);
            setQuery("");
            setActive(0);
            e.target.select();
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive(Math.min(results.length - 1, activeIndex + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive(Math.max(0, activeIndex - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const pickd = results[activeIndex];
              if (pickd) choose(pickd);
            } else if (e.key === "Escape") {
              setOpen(false);
              setQuery("");
              e.currentTarget.blur();
            }
          }}
          role="combobox"
          aria-expanded={open}
          aria-controls="sku-finder-list"
          aria-autocomplete="list"
          placeholder={pick("SKU 검색…", "Search any SKU…")}
          className="h-9 w-full rounded-md border bg-background pl-7 pr-2 font-mono text-[13px] outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {open && (
        <div
          id="sku-finder-list"
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-md border bg-background shadow-lg"
        >
          {results.length === 0 ? (
            <p className="px-3 py-2.5 text-[12.5px] text-muted-foreground">
              {pick(
                "예측 대상 SKU 중 일치하는 항목이 없습니다.",
                "No forecastable SKU matches that.",
              )}
            </p>
          ) : (
            <>
              {results.map((s, i) => {
                const outside = query.trim() !== "" && !inSequence.has(s);
                return (
                  <button
                    key={s}
                    type="button"
                    role="option"
                    aria-selected={i === activeIndex}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(s)}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left font-mono text-[12.5px] ${
                      i === activeIndex ? "bg-muted" : ""
                    } ${s === current ? "font-semibold" : ""}`}
                  >
                    <span className="truncate">{s}</span>
                    {/* Marked, not hidden. A reader who searched outside their
                        filter should know the result they are about to open is
                        not one of the rows they were working through. */}
                    {outside && (
                      <span className="shrink-0 font-sans text-[11px] text-muted-foreground">
                        {pick("필터 밖", "outside filter")}
                      </span>
                    )}
                  </button>
                );
              })}
              {total > results.length && (
                <p className="border-t px-3 py-1.5 text-[11.5px] text-muted-foreground">
                  {pick(
                    `${total}개 중 ${results.length}개 표시. 더 입력해 좁히세요.`,
                    `Showing ${results.length} of ${total}. Type more to narrow.`,
                  )}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Position in the sequence, kept visible while the control is closed.
          It moved out of the row beside the arrows so that the sequence and the
          thing that describes it cannot be read as belonging to different
          controls. */}
      {!open && position >= 0 && sequence.length > 1 && (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11.5px] tabular-nums text-muted-foreground">
          {position + 1}/{sequence.length}
        </span>
      )}
    </div>
  );
}
