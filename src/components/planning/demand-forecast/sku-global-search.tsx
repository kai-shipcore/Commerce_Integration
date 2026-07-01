"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useI18n } from "@/lib/i18n/i18n-provider";

interface SearchResult {
  unique_id: string;
  segment: "smooth_full" | "smooth_short" | "intermittent";
  active_weeks: number | null;
}

export function SKUGlobalSearch() {
  const router = useRouter();
  const { pick } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const SEGMENT_LABELS = {
    smooth_full:  pick("스무스", "Smooth"),
    smooth_short: pick("스무스 / 단기", "Smooth / Short"),
    intermittent: pick("비정기", "Intermittent"),
  };

  const SEGMENT_STYLES: Record<string, string> = {
    smooth_full:  "bg-blue-50 text-blue-700 border border-blue-200",
    smooth_short: "bg-violet-50 text-violet-700 border border-violet-200",
    intermittent: "bg-amber-50 text-amber-700 border border-amber-200",
  };

  useEffect(() => {
    if (!query.trim()) { setResults([]); setOpen(false); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/forecast/sku-search?q=${encodeURIComponent(query)}`);
        const data = (await res.json()) as SearchResult[];
        setResults(data);
        setOpen(data.length > 0);
        setActiveIdx(-1);
      } catch {
        setResults([]);
      }
    }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function navigate(result: SearchResult) {
    setOpen(false);
    setQuery("");
    router.push(`/planning/demand-forecast/segment/${result.segment}?sku=${encodeURIComponent(result.unique_id)}`);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      navigate(results[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative w-72">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          placeholder={pick("SKU 검색…", "Search any SKU…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          className="w-full rounded-md border bg-background pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md overflow-hidden">
          <ul className="max-h-[60vh] overflow-y-auto py-1">
            {results.map((r, i) => (
              <li
                key={r.unique_id}
                className={`flex items-center justify-between gap-2 px-3 py-2 cursor-pointer text-xs ${
                  i === activeIdx ? "bg-accent text-accent-foreground" : "hover:bg-accent hover:text-accent-foreground"
                }`}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseDown={(e) => { e.preventDefault(); navigate(r); }}
              >
                <span className="font-mono font-medium truncate">{r.unique_id}</span>
                <span className={`shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${SEGMENT_STYLES[r.segment]}`}>
                  {SEGMENT_LABELS[r.segment]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
