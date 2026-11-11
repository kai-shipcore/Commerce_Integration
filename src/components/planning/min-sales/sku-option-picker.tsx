"use client";

/**
 * Code Guide:
 * Single-select master SKU picker for the Min Sales register form. Click or
 * focus to open the list of active SKU Master rows, type to search by SKU or
 * product name, pick with the mouse or the arrow keys and Enter.
 *
 * Selection is restricted to what the list returns, so a mistyped SKU never
 * reaches the save. Same server-side search and 50-result cap as the Transit
 * Stock picker (master-sku-multi-select.tsx): 50 visible matches means the
 * reader has not typed enough yet, and the footer says how many were left off.
 * Each option also shows the calculated T.Avg current and any minimum already
 * registered, so the reader can see what they are about to change.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

/** Fields every picker endpoint returns. */
export type BaseSkuOption = {
  masterSku: string;
  productName: string | null;
  calculatedTotalAvgCurr: number | null;
};

export type SkuOption = BaseSkuOption & {
  registeredMin: number | null;
};

const MIN_SALES_ENDPOINT = "/api/planning/sku-min-sales/sku-options";

const PAGE_LIMIT = 50;
const DEBOUNCE_MS = 200;

function formatAvg(value: number | null): string {
  return value === null ? "-" : value.toFixed(2);
}

/**
 * Also used by the Replacing Soon page with its own `endpoint` (guarded by its
 * own permission) and `renderRegistered` for what that page registers.
 */
export function SkuOptionPicker<T extends BaseSkuOption = SkuOption>({
  value,
  onChange,
  disabled,
  endpoint = MIN_SALES_ENDPOINT,
  renderRegistered,
}: {
  value: T | null;
  onChange: (next: T | null) => void;
  disabled?: boolean;
  endpoint?: string;
  renderRegistered?: (option: T) => ReactNode;
}) {
  const { pick } = useI18n();
  const registeredBadge = (option: T): ReactNode => {
    if (renderRegistered) return renderRegistered(option);
    const registeredMin = (option as unknown as Partial<SkuOption>).registeredMin;
    return registeredMin != null
      ? <div className="font-semibold text-[#b45309]">{pick("등록됨", "Registered")} {formatAvg(registeredMin)}</div>
      : null;
  };
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Clamped on read so a shrinking list never needs a corrective setState.
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ search: search.trim(), limit: String(PAGE_LIMIT) });
      fetch(apiPath(`${endpoint}?${params.toString()}`), {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((res) => res.json())
        .then((json) => {
          if (!json.success) throw new Error(json.error ?? "request failed");
          setOptions(json.data as T[]);
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
    }, search.trim() ? DEBOUNCE_MS : 0);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [endpoint, open, search]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function close() {
    setOpen(false);
    setSearch("");
  }

  function choose(option: T) {
    onChange(option);
    close();
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          className="form-input h-8 w-full bg-white pl-7 pr-12 font-mono text-xs"
          // Closed, the field shows the chosen SKU; focus swaps in the search term.
          value={open ? search : value?.masterSku ?? ""}
          placeholder={open
            ? pick("SKU 또는 제품명 검색...", "Search SKU or product...")
            : pick("클릭해서 SKU 선택...", "Click to select a SKU...")}
          disabled={disabled}
          role="combobox"
          aria-expanded={open}
          aria-controls="min-sales-sku-list"
          aria-autocomplete="list"
          autoComplete="off"
          onChange={(event) => {
            setSearch(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActive(Math.min(options.length - 1, activeIndex + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive(Math.max(0, activeIndex - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const option = options[activeIndex];
              if (open && option) choose(option);
            } else if (event.key === "Escape") {
              close();
            } else if (event.key === "Tab") {
              close();
            }
          }}
        />
        {value && !open && !disabled ? (
          <button
            type="button"
            aria-label={pick("선택 해제", "Clear selection")}
            onClick={() => onChange(null)}
            className="absolute right-6 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
      </div>

      {open ? (
        <div
          ref={listRef}
          id="min-sales-sku-list"
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 min-w-[360px] overflow-y-auto rounded-md border border-[#e2dfd8] bg-white shadow-lg"
        >
          {failed ? (
            <div className="px-3 py-2 text-xs font-semibold text-[#c42b2b]">{pick("SKU 목록을 불러올 수 없습니다.", "Could not load the SKU list.")}</div>
          ) : loading && options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">{pick("불러오는 중...", "Loading...")}</div>
          ) : options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">{pick("결과가 없습니다.", "No results.")}</div>
          ) : (
            <>
              {options.map((option, index) => {
                const isSelected = value?.masterSku === option.masterSku;
                return (
                  <div
                    key={option.masterSku}
                    data-index={index}
                    role="option"
                    aria-selected={isSelected}
                    // mousedown, not click: fires before the input blurs.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      choose(option);
                    }}
                    onMouseEnter={() => setActive(index)}
                    className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 ${index === activeIndex ? "bg-[#eef3fd]" : ""}`}
                  >
                    <Check className={`h-3.5 w-3.5 shrink-0 text-[#1a5cdb] ${isSelected ? "opacity-100" : "opacity-0"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-xs">{option.masterSku}</div>
                      {option.productName ? <div className="truncate text-[11px] text-muted-foreground">{option.productName}</div> : null}
                    </div>
                    <div className="shrink-0 text-right text-[11px] leading-tight">
                      <div className="font-mono text-muted-foreground">{pick("계산", "Calc")} {formatAvg(option.calculatedTotalAvgCurr)}</div>
                      {registeredBadge(option)}
                    </div>
                  </div>
                );
              })}
              {total > options.length ? (
                <div className="border-t border-[#e2dfd8] px-3 py-1.5 text-[11px] text-muted-foreground">
                  {pick(
                    `${total}개 중 ${options.length}개 표시. 검색어를 더 입력하세요.`,
                    `Showing ${options.length} of ${total}. Type more to narrow down.`,
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
