"use client";

import { Plus, Trash2, X } from "lucide-react";
import { PlanningColorPalettePopover } from "./planning-color-palette";
import { useI18n } from "@/lib/i18n/i18n-provider";
import type {
  ConditionalFormatOperator,
  ConditionalFormatRange,
  ConditionalFormatRule,
  ConditionalFormatStyle,
} from "@/lib/planning/conditional-formatting";

const OPERATORS: Array<{ value: ConditionalFormatOperator; ko: string; en: string }> = [
  { value: "greaterThan", ko: "보다 큼", en: "Greater than" },
  { value: "greaterThanOrEqual", ko: "크거나 같음", en: "Greater than or equal to" },
  { value: "lessThan", ko: "보다 작음", en: "Less than" },
  { value: "lessThanOrEqual", ko: "작거나 같음", en: "Less than or equal to" },
  { value: "equal", ko: "같음", en: "Is equal to" },
  { value: "notEqual", ko: "같지 않음", en: "Is not equal to" },
  { value: "between", ko: "사이", en: "Is between" },
  { value: "textContains", ko: "텍스트에 포함", en: "Text contains" },
  { value: "textNotContains", ko: "텍스트에 포함되지 않음", en: "Text does not contain" },
  { value: "textStartsWith", ko: "텍스트로 시작", en: "Text starts with" },
  { value: "textEndsWith", ko: "텍스트로 끝남", en: "Text ends with" },
  { value: "isEmpty", ko: "비어 있음", en: "Is empty" },
  { value: "isNotEmpty", ko: "비어 있지 않음", en: "Is not empty" },
  { value: "dateBefore", ko: "날짜가 이전", en: "Date is before" },
  { value: "dateAfter", ko: "날짜가 이후", en: "Date is after" },
  { value: "dateIs", ko: "날짜가 같음", en: "Date is" },
  { value: "customFormula", ko: "사용자 지정 수식", en: "Custom formula is" },
];

const needsValue = (operator: ConditionalFormatOperator) => operator !== "isEmpty" && operator !== "isNotEmpty";

export function conditionalRangeLabel(range: ConditionalFormatRange, pick: (ko: string, en: string) => string): string {
  if (range.kind === "columns") {
    const visible = range.columnIds.slice(0, 2).join(", ");
    return range.columnIds.length > 2
      ? pick(`${visible} 외 ${range.columnIds.length - 2}개 컬럼`, `${visible} and ${range.columnIds.length - 2} more columns`)
      : visible || pick("선택된 컬럼 없음", "No columns selected");
  }
  const first = range.cellKeys[0]?.replace("::", " / ") ?? pick("선택된 셀 없음", "No cells selected");
  return range.cellKeys.length > 1
    ? pick(`${first} 외 ${range.cellKeys.length - 1}개 셀`, `${first} and ${range.cellKeys.length - 1} more cells`)
    : first;
}

function styleButton(active: boolean) {
  return {
    width: 34, height: 32, border: "1px solid #CBD5E1", borderRadius: 5,
    background: active ? "#DBEAFE" : "#fff", color: active ? "#1D4ED8" : "#334155",
    cursor: "pointer", fontWeight: 700,
  } as const;
}

export function ConditionalFormattingPanel({
  open,
  rules,
  currentRange,
  onChange,
  onClose,
}: {
  open: boolean;
  rules: ConditionalFormatRule[];
  currentRange: ConditionalFormatRange | null;
  onChange: (rules: ConditionalFormatRule[]) => void;
  onClose: () => void;
}) {
  const { pick } = useI18n();
  if (!open) return null;

  const updateRule = (id: string, patch: Partial<ConditionalFormatRule>) => {
    onChange(rules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule));
  };
  const updateStyle = (id: string, patch: Partial<ConditionalFormatStyle>) => {
    onChange(rules.map((rule) => rule.id === id ? { ...rule, style: { ...rule.style, ...patch } } : rule));
  };
  const addRule = () => {
    if (!currentRange) return;
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `rule-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    onChange([...rules, {
      id, range: currentRange, operator: "greaterThan", value: "0", enabled: true,
      style: { fillColor: "#FFFFFF", textColor: "#000000", bold: false, fontSize: 11 },
    }]);
  };

  return (
    <aside style={{ position: "fixed", zIndex: 120, top: 0, right: 0, width: "min(410px, 100vw)", height: "100vh", background: "#fff", boxShadow: "-8px 0 24px rgba(15,23,42,.18)", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px", borderBottom: "1px solid #E2E8F0" }}>
        <strong style={{ fontSize: 18, color: "#0F172A" }}>{pick("조건부 서식 규칙", "Conditioning formatting rules")}</strong>
        <button type="button" onClick={onClose} aria-label={pick("닫기", "Close")} style={{ border: 0, background: "transparent", cursor: "pointer", padding: 4 }}><X size={20} /></button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr", borderBottom: "1px solid #E2E8F0" }}>
        <div style={{ padding: 13, textAlign: "center", color: "#15803D", fontWeight: 700, borderBottom: "3px solid #15803D" }}>{pick("단일 색상", "Single color")}</div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {rules.length === 0 && (
          <div style={{ padding: "36px 18px", textAlign: "center", color: "#64748B", fontSize: 13, lineHeight: 1.6 }}>
            {pick("셀 또는 전체 컬럼을 선택한 뒤 규칙을 추가하세요.", "Select cells or full columns, then add a rule.")}
          </div>
        )}
        {rules.map((rule, index) => (
          <section key={rule.id} style={{ border: "1px solid #CBD5E1", borderRadius: 8, padding: 14, marginBottom: 14, background: "#F8FAFC" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <strong style={{ fontSize: 13 }}>{pick(`규칙 ${index + 1}`, `Rule ${index + 1}`)}</strong>
              <button type="button" onClick={() => onChange(rules.filter((item) => item.id !== rule.id))} aria-label={pick("규칙 삭제", "Delete rule")} style={{ border: 0, background: "transparent", color: "#64748B", cursor: "pointer" }}><Trash2 size={17} /></button>
            </div>
            <label style={{ display: "block", fontSize: 12, color: "#475569", marginBottom: 6 }}>{pick("적용 범위", "Apply to range")}</label>
            <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
              <div style={{ flex: 1, padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: 5, background: "#fff", fontSize: 12 }}>{conditionalRangeLabel(rule.range, pick)}</div>
              <button type="button" disabled={!currentRange} onClick={() => currentRange && updateRule(rule.id, { range: currentRange })} style={{ border: "1px solid #CBD5E1", borderRadius: 5, background: "#fff", padding: "0 9px", cursor: currentRange ? "pointer" : "default", fontSize: 11 }}>{pick("현재 선택", "Current selection")}</button>
            </div>
            <label style={{ display: "block", fontSize: 12, color: "#475569", marginBottom: 6 }}>{pick("다음 조건일 때 셀 서식 지정", "Format cells if...")}</label>
            <select value={rule.operator} onChange={(event) => updateRule(rule.id, { operator: event.target.value as ConditionalFormatOperator })} style={{ width: "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: 5, background: "#fff", marginBottom: 8 }}>
              {OPERATORS.map((operator) => <option key={operator.value} value={operator.value}>{pick(operator.ko, operator.en)}</option>)}
            </select>
            {needsValue(rule.operator) && (
              <div style={{ display: "flex", gap: 7, marginBottom: 14 }}>
                <input type={rule.operator.startsWith("date") ? "date" : "text"} value={rule.value ?? ""} placeholder={rule.operator === "customFormula" ? '=TRIM(LOWER(AZ4))="n"' : pick("값 또는 텍스트", "Value or text")} onChange={(event) => updateRule(rule.id, { value: event.target.value })} style={{ width: rule.operator === "between" ? "50%" : "100%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: 5 }} />
                {rule.operator === "between" && <input value={rule.value2 ?? ""} placeholder={pick("최댓값", "Maximum value")} onChange={(event) => updateRule(rule.id, { value2: event.target.value })} style={{ width: "50%", padding: "9px 10px", border: "1px solid #CBD5E1", borderRadius: 5 }} />}
              </div>
            )}
            <label style={{ display: "block", fontSize: 12, color: "#475569", marginBottom: 6 }}>{pick("서식 스타일", "Formatting style")}</label>
            <div style={{ padding: 10, border: "1px solid #CBD5E1", borderRadius: 6, background: rule.style.fillColor ?? "#fff", color: rule.style.textColor ?? "#000", fontSize: rule.style.fontSize ?? 11, fontWeight: rule.style.bold ? 700 : 400, fontStyle: rule.style.italic ? "italic" : "normal", textDecoration: [rule.style.underline ? "underline" : "", rule.style.strikethrough ? "line-through" : ""].filter(Boolean).join(" ") || "none", marginBottom: 8 }}>{pick("미리보기", "Preview")} Aa 123</div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
              <button type="button" title={pick("굵게", "Bold")} style={styleButton(Boolean(rule.style.bold))} onClick={() => updateStyle(rule.id, { bold: !rule.style.bold })}>B</button>
              <button type="button" title={pick("기울임", "Italic")} style={{ ...styleButton(Boolean(rule.style.italic)), fontStyle: "italic" }} onClick={() => updateStyle(rule.id, { italic: !rule.style.italic })}>I</button>
              <button type="button" title={pick("밑줄", "Underline")} style={{ ...styleButton(Boolean(rule.style.underline)), textDecoration: "underline" }} onClick={() => updateStyle(rule.id, { underline: !rule.style.underline })}>U</button>
              <button type="button" title={pick("취소선", "Strikethrough")} style={{ ...styleButton(Boolean(rule.style.strikethrough)), textDecoration: "line-through" }} onClick={() => updateStyle(rule.id, { strikethrough: !rule.style.strikethrough })}>S</button>
              <PlanningColorPalettePopover
                currentColor={rule.style.textColor ?? "#000000"}
                targetLabel={pick("조건부 서식 · 글자색", "Conditioning formatting · Font color")}
                ariaKind="font"
                onApply={(value) => updateStyle(rule.id, { textColor: value })}
                onReset={() => updateStyle(rule.id, { textColor: "#000000" })}
                trigger={<button type="button" title={pick("글자색", "Font color")} style={{ ...styleButton(false), color: rule.style.textColor ?? "#000000", borderBottom: `4px solid ${rule.style.textColor ?? "#000000"}` }}>A</button>}
              />
              <PlanningColorPalettePopover
                currentColor={rule.style.fillColor ?? "#FFFFFF"}
                targetLabel={pick("조건부 서식 · 채우기 색", "Conditioning formatting · Fill color")}
                ariaKind="fill"
                onApply={(value) => updateStyle(rule.id, { fillColor: value })}
                onReset={() => updateStyle(rule.id, { fillColor: "#FFFFFF" })}
                trigger={<button type="button" title={pick("채우기 색", "Fill color")} style={{ ...styleButton(false), background: rule.style.fillColor ?? "#FFFFFF" }}>▰</button>}
              />
              <select title={pick("글자 크기", "Font size")} value={rule.style.fontSize ?? 11} onChange={(event) => updateStyle(rule.id, { fontSize: Number(event.target.value) })} style={{ height: 32, border: "1px solid #CBD5E1", borderRadius: 5, background: "#fff" }}>
                {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24].map((size) => <option key={size}>{size}</option>)}
              </select>
            </div>
          </section>
        ))}
      </div>
      <div style={{ padding: 16, borderTop: "1px solid #E2E8F0", display: "flex", gap: 8 }}>
        <button type="button" disabled={!currentRange} onClick={addRule} style={{ flex: 1, padding: 10, border: "1px solid #15803D", borderRadius: 6, color: currentRange ? "#15803D" : "#94A3B8", background: "#fff", cursor: currentRange ? "pointer" : "default", fontWeight: 700 }}><Plus size={16} style={{ display: "inline", verticalAlign: "-3px", marginRight: 5 }} />{pick("규칙 추가", "Add another rule")}</button>
        <button type="button" onClick={onClose} style={{ padding: "10px 20px", border: 0, borderRadius: 6, background: "#15803D", color: "#fff", cursor: "pointer", fontWeight: 700 }}>{pick("완료", "Done")}</button>
      </div>
    </aside>
  );
}
