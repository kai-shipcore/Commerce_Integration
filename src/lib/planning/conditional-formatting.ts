export const CONDITIONAL_FORMAT_RULES_STORAGE_KEY = "planning-dashboard-conditional-format-rules";

export type ConditionalFormatOperator =
  | "greaterThan" | "greaterThanOrEqual" | "lessThan" | "lessThanOrEqual"
  | "equal" | "notEqual" | "between"
  | "textContains" | "textNotContains" | "textStartsWith" | "textEndsWith"
  | "isEmpty" | "isNotEmpty"
  | "dateBefore" | "dateAfter" | "dateIs" | "customFormula";

export type ConditionalFormatRange =
  | { kind: "cells"; cellKeys: string[] }
  | { kind: "columns"; columnIds: string[] };

export interface ConditionalFormatStyle {
  fillColor?: string;
  textColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  fontSize?: number;
}

export interface ConditionalFormatRule {
  id: string;
  range: ConditionalFormatRange;
  operator: ConditionalFormatOperator;
  value?: string;
  value2?: string;
  style: ConditionalFormatStyle;
  enabled: boolean;
}

const OPERATORS = new Set<ConditionalFormatOperator>([
  "greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual", "equal", "notEqual", "between",
  "textContains", "textNotContains", "textStartsWith", "textEndsWith", "isEmpty", "isNotEmpty",
  "dateBefore", "dateAfter", "dateIs", "customFormula",
]);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const RANGE_ENTRY_CACHE = new WeakMap<ConditionalFormatRange, Set<string>>();

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function conditionalCellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") {
    const content = value as { html?: unknown };
    if (typeof content.html === "string") return decodeHtml(content.html);
  }
  return decodeHtml(String(value));
}

function comparable(value: string): string | number {
  const trimmed = value.trim();
  if (trimmed !== "" && Number.isFinite(Number(trimmed.replace(/,/g, "")))) return Number(trimmed.replace(/,/g, ""));
  return trimmed.toLocaleLowerCase();
}

function compare(left: string, right: string): number {
  const a = comparable(left);
  const b = comparable(right);
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function compareDates(left: string, right: string): number | null {
  const dateKey = (value: string): number | null => {
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value.trim());
    if (iso) return Number(iso[1]) * 10000 + Number(iso[2]) * 100 + Number(iso[3]);
    const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(value.trim());
    if (us) return Number(us[3]) * 10000 + Number(us[1]) * 100 + Number(us[2]);
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) return null;
    const date = new Date(timestamp);
    return date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
  };
  const a = dateKey(left);
  const b = dateKey(right);
  return a === null || b === null ? null : a - b;
}

function formulaArgument(expression: string, value: string): string | null {
  const result = expression.trim();
  const cellRef = /^\$?[A-Z]{1,3}\$?\d+$/i;
  if (cellRef.test(result) || /^VALUE$/i.test(result)) return value;
  const fn = /^(TRIM|LOWER|UPPER)\((.*)\)$/i.exec(result);
  if (!fn) return null;
  const inner = formulaArgument(fn[2], value);
  if (inner === null) return null;
  if (fn[1].toUpperCase() === "TRIM") return inner.trim();
  if (fn[1].toUpperCase() === "LOWER") return inner.toLocaleLowerCase();
  return inner.toLocaleUpperCase();
}

function formulaLiteral(raw: string): string | null {
  const value = raw.trim();
  const quoted = /^(?:"([\s\S]*)"|'([\s\S]*)')$/.exec(value);
  if (quoted) return (quoted[1] ?? quoted[2]).replace(/""/g, '"');
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return value;
  if (/^(TRUE|FALSE)$/i.test(value)) return value.toLocaleLowerCase();
  return null;
}

function matchesCustomFormula(formula: string, value: string): boolean {
  const expression = formula.trim().replace(/^=/, "").trim();
  const blank = /^ISBLANK\((.*)\)$/i.exec(expression);
  if (blank) return formulaArgument(blank[1], value) === "";
  const notBlank = /^NOT\(ISBLANK\((.*)\)\)$/i.exec(expression);
  if (notBlank) return formulaArgument(notBlank[1], value) !== "";
  const match = /^(.+?)\s*(<>|>=|<=|=|>|<)\s*(.+)$/.exec(expression);
  if (!match) return false;
  const left = formulaArgument(match[1], value);
  const right = formulaLiteral(match[3]);
  if (left === null || right === null) return false;
  const result = compare(left, right);
  return match[2] === "=" ? result === 0
    : match[2] === "<>" ? result !== 0
      : match[2] === ">" ? result > 0
        : match[2] === ">=" ? result >= 0
          : match[2] === "<" ? result < 0
            : result <= 0;
}

export function matchesConditionalFormatRule(rule: ConditionalFormatRule, rawValue: unknown): boolean {
  if (!rule.enabled) return false;
  const value = conditionalCellText(rawValue);
  const expected = rule.value ?? "";
  switch (rule.operator) {
    case "isEmpty": return value.trim() === "";
    case "isNotEmpty": return value.trim() !== "";
    case "textContains": return value.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
    case "textNotContains": return !value.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
    case "textStartsWith": return value.toLocaleLowerCase().startsWith(expected.toLocaleLowerCase());
    case "textEndsWith": return value.toLocaleLowerCase().endsWith(expected.toLocaleLowerCase());
    case "greaterThan": return compare(value, expected) > 0;
    case "greaterThanOrEqual": return compare(value, expected) >= 0;
    case "lessThan": return compare(value, expected) < 0;
    case "lessThanOrEqual": return compare(value, expected) <= 0;
    case "equal": return compare(value, expected) === 0;
    case "notEqual": return compare(value, expected) !== 0;
    case "between": return compare(value, expected) >= 0 && compare(value, rule.value2 ?? "") <= 0;
    case "dateBefore": return (compareDates(value, expected) ?? 0) < 0;
    case "dateAfter": return (compareDates(value, expected) ?? 0) > 0;
    case "dateIs": return compareDates(value, expected) === 0;
    case "customFormula": return matchesCustomFormula(expected, value);
  }
}

function isRuleInRange(rule: ConditionalFormatRule, cellKey: string, columnId: string): boolean {
  let entries = RANGE_ENTRY_CACHE.get(rule.range);
  if (!entries) {
    entries = new Set(rule.range.kind === "cells" ? rule.range.cellKeys : rule.range.columnIds);
    RANGE_ENTRY_CACHE.set(rule.range, entries);
  }
  return entries.has(rule.range.kind === "cells" ? cellKey : columnId);
}

export function conditionalFormatForCell(
  rules: ConditionalFormatRule[], cellKey: string, columnId: string, value: unknown,
): ConditionalFormatStyle | null {
  let result: ConditionalFormatStyle | null = null;
  for (const rule of rules) {
    if (isRuleInRange(rule, cellKey, columnId) && matchesConditionalFormatRule(rule, value)) {
      result = { ...(result ?? {}), ...rule.style };
    }
  }
  return result;
}

export function normalizeConditionalFormatRules(value: unknown): ConditionalFormatRule[] {
  if (!Array.isArray(value)) return [];
  const rules: ConditionalFormatRule[] = [];
  for (const item of value.slice(0, 100)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const raw = item as Record<string, unknown>;
    if (typeof raw.id !== "string" || !OPERATORS.has(raw.operator as ConditionalFormatOperator)) continue;
    const range = raw.range as Record<string, unknown> | undefined;
    if (!range || (range.kind !== "cells" && range.kind !== "columns")) continue;
    const entries = range.kind === "cells" ? range.cellKeys : range.columnIds;
    if (!Array.isArray(entries)) continue;
    const cleanEntries = Array.from(new Set(entries.filter((entry): entry is string => typeof entry === "string" && entry.length > 0))).slice(0, 50000);
    const rawStyle = raw.style && typeof raw.style === "object" && !Array.isArray(raw.style) ? raw.style as Record<string, unknown> : {};
    const style: ConditionalFormatStyle = {};
    if (typeof rawStyle.fillColor === "string" && HEX_COLOR.test(rawStyle.fillColor)) style.fillColor = rawStyle.fillColor.toUpperCase();
    if (typeof rawStyle.textColor === "string" && HEX_COLOR.test(rawStyle.textColor)) style.textColor = rawStyle.textColor.toUpperCase();
    for (const key of ["bold", "italic", "underline", "strikethrough"] as const) {
      if (typeof rawStyle[key] === "boolean") style[key] = rawStyle[key];
    }
    if (typeof rawStyle.fontSize === "number" && Number.isFinite(rawStyle.fontSize)) style.fontSize = Math.min(48, Math.max(6, Math.round(rawStyle.fontSize)));
    rules.push({
      id: raw.id.slice(0, 100),
      range: range.kind === "cells" ? { kind: "cells", cellKeys: cleanEntries } : { kind: "columns", columnIds: cleanEntries },
      operator: raw.operator as ConditionalFormatOperator,
      value: typeof raw.value === "string" ? raw.value.slice(0, 500) : undefined,
      value2: typeof raw.value2 === "string" ? raw.value2.slice(0, 500) : undefined,
      style,
      enabled: raw.enabled !== false,
    });
  }
  return rules;
}

export function loadSavedConditionalFormatRules(): ConditionalFormatRule[] {
  if (typeof window === "undefined") return [];
  try {
    return normalizeConditionalFormatRules(JSON.parse(window.localStorage.getItem(CONDITIONAL_FORMAT_RULES_STORAGE_KEY) ?? "[]"));
  } catch {
    window.localStorage.removeItem(CONDITIONAL_FORMAT_RULES_STORAGE_KEY);
    return [];
  }
}
