"use client";

/** Operate-mode extension: inherit the planning toolbar, keep the grid visible while
 * editing, and expose scope, references, errors and save state beside the formula. */
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calculator, Check, ChevronDown, Crosshair, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/i18n-provider";
import {
  cellReference, formulaForCell, isFormulaId, MAX_FORMULA_LENGTH, validateFormula,
  type FormulaConfig, type FormulaId, type FormulaResult,
} from "@/lib/planning/custom-formulas";

export interface FormulaBarHandle {
  beginDraft: (sku: string, field: string, text: string) => void;
  syncDraft: (sku: string, field: string, text: string) => void;
  selectCell: (sku: string, field: string, extendingSelection?: boolean) => boolean;
  isPicking: () => boolean;
}
interface Props {
  addressFor: (sku: string, field: string) => string | null;
  displayFormula: (text: string, sku: string) => string;
  resolveFormula: (text: string) => string;
  onEditorChange: (text: string) => void;
  onEditorCommit: () => boolean;
  onEditorCancel: () => void;
  onReferenceChange: (target: { sku: string; field: string } | null) => void;
  toolbarTarget?: HTMLElement | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: FormulaConfig;
  onChange: (config: FormulaConfig) => void;
  canEdit: boolean;
  getSelectedSkus: () => string[];
  fields: Array<{ id: string; label: string }>;
  evaluate: (sku: string, id: FormulaId, formula: string) => FormulaResult;
  onReveal: (id: FormulaId) => void;
  onFillDown: (id: FormulaId) => number;
  /** Address of the cell a formula is referencing, such as C6. Shown as a name box. */
  referenceAddress?: string | null;
}
export const FormulaBar = forwardRef<FormulaBarHandle, Props>(function FormulaBar({ toolbarTarget, open, onOpenChange: setOpen, config, onChange, canEdit, getSelectedSkus, fields, evaluate, onReveal, onFillDown, referenceAddress, addressFor, displayFormula, resolveFormula, onEditorChange, onEditorCommit, onEditorCancel, onReferenceChange }, ref) {
  const { pick } = useI18n();
  const [id, setId] = useState<FormulaId>("custom_formula_1");
  const [sku, setSku] = useState<string | null>(null);
  const [draft, updateDraft] = useState("");
  const [validationRequested, setValidationRequested] = useState(false);
  function setDraft(text: string) {
    updateDraft(text);
    setValidationRequested(false);
  }
  const [picking, updatePicking] = useState(false);
  function setPicking(value: boolean) {
    updatePicking(value);
    if (!value) onReferenceChange(null);
  }
  const [message, setMessage] = useState("");
  const [fieldPickerOpen, setFieldPickerOpen] = useState(false);
  const [fieldQuery, setFieldQuery] = useState("");
  const [fieldIndex, setFieldIndex] = useState(0);
  const fieldSearch = useRef<HTMLInputElement>(null);
  const filteredFields = fields.filter((field) => `${field.label} ${field.id}`.toLocaleLowerCase().includes(fieldQuery.trim().toLocaleLowerCase()));
  function chooseField(field: { id: string }) {
    setFieldPickerOpen(false);
    insert(`[${field.id}]`);
  }
  const input = useRef<HTMLInputElement>(null);
  const inlineEditing = useRef(false);
  const cursor = useRef({ start: 0, end: 0 });
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    input.current?.focus();
    input.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  });
  const column = config.find((c) => c.id === id)!;
  const resolvedDraft = resolveFormula(draft);
  const error = validateFormula(resolvedDraft);
  const preview = sku && !error ? evaluate(sku, id, resolvedDraft) : null;
  const visibleError = validationRequested ? error || preview?.error : null;
  // An in-cell edit can change the stored expression while the bar is open.
  // Follow it, unless the draft has already been typed over.
  const stored = sku === null ? "" : displayFormula(formulaForCell(column, sku), sku);
  const [seenStored, setSeenStored] = useState(stored);
  if (stored !== seenStored) {
    setSeenStored(stored);
    if (draft === seenStored) setDraft(stored);
  }
  function insert(reference: string) {
    const start = input.current?.selectionStart ?? cursor.current.start;
    const end = input.current?.selectionEnd ?? cursor.current.end;
    const next = draft.slice(0, start) + reference + draft.slice(end);
    setDraft(next.startsWith("=") ? next : `=${next}`);
    onEditorChange(next.startsWith("=") ? next : `=${next}`);
    const position = start + reference.length + (next.startsWith("=") ? 0 : 1);
    cursor.current = { start: position, end: position };
    pendingCaret.current = position;
  }
  // A null row means no cell is being edited; the selected grid cells are the target.
  function selectColumn(nextId: FormulaId, row: string | null) {
    const next = config.find((c) => c.id === nextId)!;
    setId(nextId); setSku(row);
    setDraft(row ? displayFormula(formulaForCell(next, row), row) : "");
    setPicking(false); setMessage(""); setOpen(true);
  }
  useImperativeHandle(ref, () => ({
    beginDraft: (row, field, text) => {
      if (!isFormulaId(field)) return;
      inlineEditing.current = false;
      setId(field); setSku(row); setDraft(text); setPicking(true); setMessage(""); setOpen(true);
      pendingCaret.current = text.length;
    },
    syncDraft: (row, field, text) => {
      if (!isFormulaId(field)) return;
      inlineEditing.current = document.activeElement !== input.current;
      setId(field); setSku(row); setDraft(text); setPicking(text.trimStart().startsWith("=")); setMessage("");
    },
    isPicking: () => picking && !inlineEditing.current,
    selectCell: (row, field, extendingSelection) => {
      if (picking && canEdit && column.enabled) {
        if (!fields.some((f) => f.id === field)) {
          setMessage(pick("이 셀은 수식에서 참조할 수 없습니다. 목록에서 컬럼을 선택하세요.", "This cell cannot be referenced. Choose a column from the list."));
          return true;
        }
        insert(addressFor(row, field) ?? cellReference(row, field));
        onReferenceChange({ sku: row, field });
        setMessage("");
        return true;
      }
      // Shift/Ctrl/Cmd clicks extend the selection and keep the formula being
      // edited, so the source expression can be applied to the chosen rows.
      // A plain click loads the clicked cell, as in a spreadsheet.
      if (isFormulaId(field) && (!extendingSelection || sku === null || field !== id)) selectColumn(field, row);
      return false;
    },
  }));
  // Writes an expression into every selected cell. Blank text empties the cell.
  function applyText(text: string) {
    if (!canEdit || !column.enabled) return;
    // The grid selection is the target; a single clicked cell is the fallback.
    const selected = getSelectedSkus();
    const targets = selected.length ? selected : sku ? [sku] : [];
    if (!targets.length) { setMessage(pick("먼저 그리드에서 셀을 선택하세요.", "Select cells in the grid first.")); return; }
    const overrides = { ...column.overrides };
    for (const row of targets) {
      if (text.trim()) overrides[row] = text;
      else delete overrides[row];
    }
    onChange(config.map((c) => c.id === id ? { ...c, overrides } : c));
    setPicking(false);
    if (!text.trim()) {
      setDraft("");
      setMessage("");
    } else {
      setMessage(pick(`${targets.length}개 칸에 적용했습니다. 이 탭에 저장됩니다.`, `Applied to ${targets.length} cells. Saved with this tab.`));
    }
  }
  function resetDraft() {
    onEditorCancel();
    inlineEditing.current = false;
    pendingCaret.current = null;
    cursor.current = { start: 0, end: 0 };
    setDraft(""); setMessage(""); setPicking(false);
  }
  function apply() {
    setValidationRequested(true);
    if (error || preview?.error) return;
    if (onEditorCommit()) { setPicking(false); return; }
    applyText(resolvedDraft);
  }
  const toggleButton = (
      <Button type="button" size="sm" variant="outline" className="h-[30px] shrink-0 rounded border-[#C2BFB5] px-2.5 text-[11px] font-semibold" aria-expanded={open} onClick={() => { setOpen(!open); setPicking(false); }}>
        <Calculator className="size-4" aria-hidden="true" />{pick("계산 컬럼", "Formula columns")}
      </Button>
  );
  return <section aria-label={pick("사용자 정의 수식", "Custom formulas")} className={open || toolbarTarget === undefined ? "shrink-0 border-b border-[#D9D6CE] bg-[#F7F6F2] px-3 py-3 text-xs" : "shrink-0"}>
    {toolbarTarget ? createPortal(toggleButton, toolbarTarget) : null}
    <div className={open ? "max-w-[1180px]" : undefined}>
    {(open || toolbarTarget === undefined) && <div className={open ? "relative flex flex-wrap items-end gap-x-3 gap-y-2" : "flex flex-wrap items-center gap-1.5"}>
      {toolbarTarget === undefined ? toggleButton : null}
      {open && <>
        <div className="relative z-10 -mb-px inline-flex max-w-full items-end gap-0.5">
          {config.filter((c) => c.enabled).map((c) => <Button key={c.id} type="button" size="sm" variant="ghost" aria-pressed={c.id === id} className={`max-w-64 rounded-b-none rounded-t-md border px-5 text-xs shadow-none ${c.id === id ? "h-11 border-[#C9D3EB] border-b-white bg-white font-semibold text-[#302E29] hover:bg-white" : "h-10 border-[#C9D3EB] bg-[#D6DFF5] font-medium text-[#53617C] hover:bg-[#C9D5F0]"}`} onClick={() => { selectColumn(c.id, null); onReveal(c.id); }}><span className="truncate">{c.name}</span></Button>)}
        </div>
        {config.some((c) => !c.enabled) && <Button type="button" size="sm" variant="outline" className="h-8 border-dashed border-[#B8B5AC] bg-white px-3 text-xs" disabled={!canEdit} onClick={() => {
          const next = config.find((c) => !c.enabled)!;
          onChange(config.map((c) => c.id === next.id ? { ...c, enabled: true } : c));
          selectColumn(next.id, null);
          onReveal(next.id);
        }}>{pick("+ 계산 컬럼 추가", "+ Add formula column")}</Button>}
        <span className="pb-3 text-[11px] text-[#77736A]">{pick("이 탭에서만 계산되며 주문 수량은 변경하지 않습니다.", "Calculated only in this tab. Order quantities stay unchanged.")}</span>
      </>}
    </div>}
    {open && <div className="border border-[#C9D3EB] bg-white">
      {!column.enabled ? <p className="text-muted-foreground">{pick("계산 컬럼을 추가한 뒤 셀을 선택하고 수식을 입력하세요.", "Add a formula column, then select cells and enter a formula.")}</p> : <>
        <div className="grid gap-3 px-4 py-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="rounded-lg border border-[#E2DFD8] bg-[#FBFAF8] p-3">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-[#555149]">{pick("컬럼 설정", "Column settings")}</span>
            <Input key={`${id}:${column.name}`} aria-label={pick("계산 컬럼 이름", "Formula column name")} className="h-9 border-[#D5D2CA] bg-[#FBFAF8] text-sm font-medium focus-visible:bg-white" defaultValue={column.name} maxLength={60} disabled={!canEdit}
              onBlur={(e) => { const name = e.target.value.trim(); if (name && name !== column.name) onChange(config.map((c) => c.id === id ? { ...c, name } : c)); }} />
          </label>
          </div>
        <div className="min-w-0 space-y-3">
          <div className="rounded-lg border border-[#E2DFD8] bg-[#FBFAF8] p-3">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold text-[#555149]">{pick("수식 작성", "Formula editor")}</span>
            <div className="flex flex-col gap-2 lg:flex-row">
          {referenceAddress && <span aria-label={pick("참조 셀 주소", "Referenced cell address")} className="flex h-10 min-w-14 shrink-0 items-center justify-center rounded-md border border-[#C9C6BD] bg-[#FBFAF8] px-3 font-mono text-sm font-semibold text-[#174EA6]">{referenceAddress}</span>}
          <Input ref={input} aria-label={pick("수식", "Formula")} className="h-10 min-w-0 flex-1 border-[#C9C6BD] bg-[#FBFAF8] font-mono text-sm shadow-inner focus-visible:bg-white" value={draft} disabled={!canEdit} maxLength={MAX_FORMULA_LENGTH}
            placeholder="=ROUNDUP(MAX(0, [tavg_c] * 60 - [total]), 0)"
            aria-invalid={Boolean(visibleError)} aria-describedby="planning-formula-help"
            onChange={(e) => { setDraft(e.target.value); onEditorChange(e.target.value); setPicking(e.target.value.trimStart().startsWith("=")); setMessage(""); }}
            onSelect={(e) => { cursor.current = { start: e.currentTarget.selectionStart ?? draft.length, end: e.currentTarget.selectionEnd ?? draft.length }; }}
            // Losing focus ends picking, so grid clicks select cells again. insert() refocuses the bar after each reference.
            onFocus={() => { inlineEditing.current = false; setPicking(draft.trimStart().startsWith("=")); }} onBlur={() => setPicking(false)} onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); apply(); }
              if (e.key === "Escape") {
                e.preventDefault(); e.stopPropagation();
                resetDraft();
              }
            }} />
              <div className="flex shrink-0 gap-2">
                <Button type="button" size="sm" variant={picking ? "secondary" : "outline"} className="h-10" disabled={!canEdit} aria-pressed={picking} onMouseDown={(e) => e.preventDefault()} onClick={() => { inlineEditing.current = false; setPicking(!picking); }}><Crosshair className="size-4" aria-hidden="true" />{picking ? pick("참조 선택 중", "Picking references") : pick("셀 참조", "Pick cell")}</Button>
                <Button type="button" size="icon" variant="ghost" className="size-10 text-[#77736A]" aria-label={pick("수식 초기화", "Reset formula")} title={pick("수식 초기화", "Reset formula")} onClick={resetDraft}><X className="size-4" aria-hidden="true" /></Button>
                <Button type="button" size="sm" className="h-10 bg-[#174EA6] px-4 hover:bg-[#123E85]" disabled={!canEdit} onClick={() => apply()}><Check className="size-4" aria-hidden="true" />{pick("적용", "Apply")}</Button>
              </div>
            </div>
          </label>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#EEECE7] pt-3">
          <Popover open={fieldPickerOpen} onOpenChange={(value) => { setFieldPickerOpen(value); setFieldQuery(""); setFieldIndex(0); }}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" disabled={!canEdit} className="h-8 w-72 max-w-full justify-between border-[#D5D2CA] bg-white px-2 text-[11px]" aria-label={pick("같은 행의 컬럼 참조 삽입", "Insert same-row column reference")}>
                {pick("같은 행의 컬럼 삽입…", "Insert column from this row…")}<ChevronDown className="size-3.5" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-0" onOpenAutoFocus={(event) => { event.preventDefault(); fieldSearch.current?.focus(); }} onCloseAutoFocus={(event) => event.preventDefault()}>
              <div className="flex items-center gap-2 border-b px-3 py-2">
                <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <Input ref={fieldSearch} role="combobox" aria-expanded="true" aria-controls="formula-field-options" aria-autocomplete="list" aria-activedescendant={filteredFields[fieldIndex] ? `formula-field-${fieldIndex}` : undefined} aria-label={pick("컬럼 검색", "Search columns")} placeholder={pick("컬럼 이름 또는 ID 검색…", "Search column name or ID…")} className="h-8 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0" value={fieldQuery} onChange={(event) => { setFieldQuery(event.target.value); setFieldIndex(0); }} onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const next = Math.max(0, Math.min(filteredFields.length - 1, fieldIndex + (event.key === "ArrowDown" ? 1 : -1)));
                    setFieldIndex(next);
                    document.getElementById(`formula-field-${next}`)?.scrollIntoView({ block: "nearest" });
                  }
                  if (event.key === "Enter") { event.preventDefault(); if (filteredFields[fieldIndex]) chooseField(filteredFields[fieldIndex]); }
                }} />
              </div>
              <div id="formula-field-options" role="listbox" aria-label={pick("컬럼 목록", "Columns")} className="max-h-64 overflow-y-auto p-1">
                {filteredFields.map((field, index) => <button key={field.id} id={`formula-field-${index}`} type="button" role="option" aria-selected={index === fieldIndex} onMouseEnter={() => setFieldIndex(index)} onClick={() => chooseField(field)} className={`flex w-full items-center justify-between gap-3 rounded px-2 py-2 text-left text-xs ${index === fieldIndex ? "bg-[#E8EEF9] text-[#174EA6]" : "text-foreground"}`}>
                  <span className="min-w-0 break-words">{field.label}</span><span className="shrink-0 text-[10px] text-muted-foreground">[{field.id}]</span>
                </button>)}
                {!filteredFields.length && <p className="px-3 py-5 text-center text-xs text-muted-foreground">{pick("검색 결과가 없습니다.", "No columns found.")}</p>}
              </div>
            </PopoverContent>
          </Popover>
          <Button type="button" size="sm" variant="outline" className="h-8 text-[11px]" disabled={!canEdit} onClick={() => {
            const count = onFillDown(id);
            setPicking(false);
            setMessage(count ? pick(`${count}개 셀에 맨 위 수식을 채웠습니다.`, `Filled ${count} cells from the top selected formula.`) : pick("같은 계산 컬럼에서 두 행 이상을 선택하세요.", "Select at least two rows in the same formula column."));
          }}>{pick("아래로 채우기", "Fill down")} <kbd className="ml-1 rounded border border-[#D5D2CA] bg-[#F7F6F2] px-1 font-sans text-[9px]">Ctrl+D</kbd></Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 text-[11px] text-[#9A3F35] hover:bg-[#FFF0EE] hover:text-[#7D2F28]" disabled={!canEdit} onClick={() => applyText("")}>{pick("선택한 칸 비우기", "Clear selected cells")}</Button>
          <span className="text-[11px] text-[#77736A]">{pick("여러 칸을 선택하면 같은 수식을 한 번에 넣을 수 있습니다.", "Select several cells to put the same formula in each.")}</span>
          <span role="status" className={`ml-auto break-words text-[11px] font-medium ${visibleError ? "text-destructive" : "text-[#555149]"}`}>{message || visibleError || (preview?.value != null ? `${pick("미리보기", "Preview")}: ${String(preview.value)}` : "")}</span>
        </div>
        </div>
        <p id="planning-formula-help" className="rounded-md bg-[#F7F6F2] px-3 py-2 text-[10px] leading-4 text-[#6C685F]">{pick("‘=’로 시작하세요. [컬럼ID]는 같은 SKU, SKU(\"SKU\", \"컬럼ID\")는 특정 SKU를 참조합니다. 지원 함수: IF, IFERROR, MIN, MAX, SUM, ABS, ROUND, ROUNDUP, ROUNDDOWN", "Start with ‘=’. [columnID] references this SKU; SKU(\"SKU\", \"columnID\") references a specific SKU. Functions: IF, IFERROR, MIN, MAX, SUM, ABS, ROUND, ROUNDUP, ROUNDDOWN")}</p>
        {visibleError && <p role="alert" className="rounded-md bg-[#FFF0EE] px-3 py-2 text-[11px] text-[#8B3028]">{pick(`수식을 확인하세요 (${visibleError}). 수식을 수정한 뒤 Enter를 누르세요.`, `Check your formula (${visibleError}). Edit it, then press Enter.`)}</p>}
        </div>
        </div>
      </>}
    </div>}
    </div>
  </section>;
});
