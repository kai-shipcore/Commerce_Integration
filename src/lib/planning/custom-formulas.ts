/** Small, bounded spreadsheet expression interpreter. Never executes JavaScript. */
export const FORMULAS_STORAGE_KEY = "planning-custom-formulas-v1";
export const FORMULA_IDS = ["custom_formula_1", "custom_formula_2"] as const;
export type FormulaId = typeof FORMULA_IDS[number];
export interface FormulaColumn {
  id: FormulaId;
  enabled: boolean;
  name: string;
  formula: string;
  overrides: Record<string, string>;
}
export type FormulaConfig = FormulaColumn[];
export type FormulaValue = number | string | boolean | null;
export interface FormulaResult { value: FormulaValue; error?: string }
export const MAX_FORMULA_LENGTH = 2000;
export function isFormulaId(id: string): id is FormulaId {
  return (FORMULA_IDS as readonly string[]).includes(id);
}
export function normalizeFormulaConfig(raw: unknown): FormulaConfig {
  return FORMULA_IDS.map((id, index) => {
    const source = Array.isArray(raw) ? raw.find((c) => c?.id === id) : undefined;
    return {
      id, enabled: source?.enabled === true,
      name: typeof source?.name === "string" ? source.name.trim().slice(0, 60) || `Calc ${index + 1}` : `Calc ${index + 1}`,
      formula: typeof source?.formula === "string" ? source.formula.slice(0, MAX_FORMULA_LENGTH) : "",
      overrides: Object.fromEntries(Object.entries(source?.overrides && typeof source.overrides === "object" ? source.overrides : {})
        .filter((entry): entry is [string, string] => entry[0].length <= 200 && typeof entry[1] === "string" && entry[1].length <= MAX_FORMULA_LENGTH)
        .slice(0, 20000)),
    };
  });
}
/** Each cell holds its own expression. An empty cell has no formula. */
export function formulaForCell(column: FormulaColumn, sku: string): string {
  return Object.hasOwn(column.overrides, sku) ? column.overrides[sku] : "";
}
/** Older configs stored one expression for the whole column. Copy it into each
 * row that has none, then drop it. Returns the same object when there is nothing
 * to move, so callers can compare references. */
export function materializeDefaultFormulas(config: FormulaConfig, skus: string[]): FormulaConfig {
  if (!config.some((column) => column.formula.trim())) return config;
  return config.map((column) => {
    if (!column.formula.trim()) return column;
    const overrides = { ...column.overrides };
    for (const sku of skus) if (!Object.hasOwn(overrides, sku)) overrides[sku] = column.formula;
    return { ...column, formula: "", overrides };
  });
}
/** Copy expressions, not their evaluated values. Row IDs must be in displayed
 * order and exclude filtered/pinned rows; sparse selections stay sparse. */
export function fillDownFormulas(
  config: FormulaConfig, rowIds: string[], columnIds: string[], selected: ReadonlySet<string>,
  translate: (formula: string, sourceSku: string, targetSku: string) => string = (formula) => formula,
): { config: FormulaConfig; count: number } {
  let count = 0;
  const next = config.map((column) => {
    if (!column.enabled || !columnIds.includes(column.id)) return column;
    const rows = rowIds.filter((sku) => selected.has(`${sku}::${column.id}`));
    if (rows.length < 2) return column;
    const formula = formulaForCell(column, rows[0]);
    const overrides = { ...column.overrides };
    for (const sku of rows.slice(1)) { overrides[sku] = translate(formula, rows[0], sku); count++; }
    return { ...column, overrides };
  });
  return { config: count ? next : config, count };
}
export function cellReference(sku: string, field: string): string {
  return `SKU(${JSON.stringify(sku)}, ${JSON.stringify(field)})`;
}

type Node = { kind: "literal"; value: FormulaValue }
  | { kind: "field"; name: string }
  | { kind: "unary"; op: string; node: Node }
  | { kind: "binary"; op: string; left: Node; right: Node }
  | { kind: "call"; name: string; args: Node[] };
type Token = { kind: string; text: string };
class FormulaError extends Error {}
const fail = (message: string): never => { throw new FormulaError(message); };
function tokenize(source: string): Token[] {
  if (source.length > MAX_FORMULA_LENGTH) fail("#LIMIT!");
  let rest = source.trim().replace(/^=/, "");
  const tokens: Token[] = [];
  while (rest.trim()) {
    rest = rest.trimStart();
    const match = /^(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|("(?:[^"\\]|\\.)*")|\[([^\[\]]+)\]|([A-Za-z_][A-Za-z_0-9]*)|(<=|>=|<>|!=|[+\-*/^%=<>() ,]))/.exec(rest);
    if (!match) fail("#SYNTAX!");
    const m = match!;
    tokens.push(m[1] ? { kind: "number", text: m[1] }
      : m[2] ? { kind: "string", text: m[2] }
      : m[3] ? { kind: "field", text: m[3] }
      : m[4] ? { kind: "name", text: m[4].toUpperCase() }
      : { kind: m[5], text: m[5] });
    rest = rest.slice(m[0].length);
    if (tokens.length > 500) fail("#LIMIT!");
  }
  tokens.push({ kind: "end", text: "" });
  return tokens;
}
function parse(source: string): Node {
  const tokens = tokenize(source);
  let pos = 0;
  const take = (kind: string) => tokens[pos].kind === kind ? (pos++, true) : false;
  const expect = (kind: string) => { if (!take(kind)) fail("#SYNTAX!"); };
  const precedence: Record<string, number> = { "=": 1, "<>": 1, "!=": 1, "<": 1, ">": 1, "<=": 1, ">=": 1, "+": 2, "-": 2, "*": 3, "/": 3, "^": 4 };
  function expression(min = 0, depth = 0): Node {
    if (depth > 40) fail("#LIMIT!");
    const token = tokens[pos++];
    let node: Node;
    if (token.kind === "number") node = { kind: "literal", value: Number(token.text) };
    else if (token.kind === "string") {
      try { node = { kind: "literal", value: JSON.parse(token.text) }; } catch { return fail("#SYNTAX!"); }
    } else if (token.kind === "field") node = { kind: "field", name: token.text };
    else if (token.kind === "+" || token.kind === "-") node = { kind: "unary", op: token.kind, node: expression(4, depth + 1) };
    else if (token.kind === "(") { node = expression(0, depth + 1); expect(")"); }
    else if (token.kind === "name") {
      if (token.text === "TRUE" || token.text === "FALSE") node = { kind: "literal", value: token.text === "TRUE" };
      else {
        expect("(");
        const args: Node[] = [];
        if (!take(")")) {
          do { args.push(expression(0, depth + 1)); } while (take(","));
          expect(")");
        }
        node = { kind: "call", name: token.text, args };
      }
    } else return fail("#SYNTAX!");
    while (true) {
      if (take("%")) { node = { kind: "unary", op: "%", node }; continue; }
      const op = tokens[pos].kind;
      const priority = precedence[op];
      if (priority === undefined || priority < min) break;
      pos++;
      node = { kind: "binary", op, left: node, right: expression(priority + (op === "^" ? 0 : 1), depth + 1) };
    }
    return node;
  }
  const result = expression();
  expect("end");
  return result;
}
function numeric(value: FormulaValue): number {
  // Missing history must not silently become zero inventory.
  if (value === null) return fail("#N/A");
  if (typeof value === "boolean") return Number(value);
  if (typeof value !== "number") return fail("#VALUE!");
  if (!Number.isFinite(value)) return fail("#NUM!");
  return value;
}
function shiftDecimal(value: number, places: number): number {
  const [coefficient, exponent = "0"] = String(value).split("e");
  return Number(`${coefficient}e${Number(exponent) + places}`);
}
export function validateFormula(source: string): string | null {
  if (!source.trim()) return null;
  try { parse(source); return null; } catch (e) { return e instanceof FormulaError ? e.message : "#SYNTAX!"; }
}

/** One evaluator per immutable data/config revision; parsed trees and results are memoized. */
export function createFormulaEvaluator(
  config: FormulaConfig,
  skus: Iterable<string>,
  read: (sku: string, field: string) => FormulaValue | undefined,
) {
  const known = new Set(skus);
  const columns = new Map(config.map((c) => [c.id, c]));
  const compiled = new Map<string, Node | string>();
  const results = new Map<string, FormulaResult>();
  const visiting = new Set<string>();
  let steps = 0;
  function resolve(sku: string, field: string): FormulaValue {
    if (!known.has(sku)) return fail("#REF!");
    if (isFormulaId(field)) {
      const result = evaluate(sku, field);
      if (result.error) return fail(result.error);
      return result.value;
    }
    const value = read(sku, field);
    if (value === undefined) return fail("#REF!");
    return value;
  }
  function run(node: Node, sku: string): FormulaValue {
    if (++steps > 10000) return fail("#LIMIT!");
    if (node.kind === "literal") return node.value;
    if (node.kind === "field") return resolve(sku, node.name);
    if (node.kind === "unary") {
      const n = numeric(run(node.node, sku));
      return node.op === "-" ? -n : node.op === "%" ? n / 100 : n;
    }
    if (node.kind === "binary") {
      const a = run(node.left, sku), b = run(node.right, sku);
      if (node.op === "=") return a === b;
      if (node.op === "<>" || node.op === "!=") return a !== b;
      const x = numeric(a), y = numeric(b);
      switch (node.op) {
        case "+": return x + y;
        case "-": return x - y;
        case "*": return x * y;
        case "/": return y === 0 ? fail("#DIV/0!") : x / y;
        case "^": return x ** y;
        case "<": return x < y;
        case ">": return x > y;
        case "<=": return x <= y;
        case ">=": return x >= y;
      }
    }
    if (node.kind !== "call") return fail("#SYNTAX!");
    const { name, args } = node;
    const count = (min: number, max = min) => { if (args.length < min || args.length > max) fail("#ARGS!"); };
    if (name === "IF") { count(3); return run(args[Boolean(run(args[0], sku)) ? 1 : 2], sku); }
    if (name === "IFERROR") {
      count(2);
      try { const value = run(args[0], sku); if (typeof value === "number") numeric(value); return value; }
      catch (e) { if (!(e instanceof FormulaError) || e.message === "#LIMIT!" || e.message === "#CYCLE!") throw e; return run(args[1], sku); }
    }
    if (name === "SKU") {
      count(2);
      const target = run(args[0], sku), field = run(args[1], sku);
      if (typeof target !== "string" || typeof field !== "string") return fail("#VALUE!");
      return resolve(target, field);
    }
    if (!["MIN", "MAX", "SUM", "ABS", "ROUND", "ROUNDUP", "ROUNDDOWN"].includes(name)) return fail("#NAME?");
    count(name === "ABS" ? 1 : name.startsWith("ROUND") ? 2 : 1, name === "ABS" ? 1 : name.startsWith("ROUND") ? 2 : 100);
    const values = args.map((a) => numeric(run(a, sku)));
    if (name === "MIN") return Math.min(...values);
    if (name === "MAX") return Math.max(...values);
    if (name === "SUM") return values.reduce((a, b) => a + b, 0);
    if (name === "ABS") return Math.abs(values[0]);
    const [value, digits] = values;
    if (!Number.isInteger(digits) || Math.abs(digits) > 12) return fail("#NUM!");
    // Decimal shifting avoids 1.1 * 100 === 110.00000000000001. Spreadsheet
    // rounding uses 15 significant digits, also removing arithmetic noise.
    const magnitude = Number(shiftDecimal(Math.abs(value), digits).toPrecision(15));
    const rounded = name === "ROUNDUP" ? Math.ceil(magnitude) : name === "ROUNDDOWN" ? Math.floor(magnitude) : Math.round(magnitude);
    return Math.sign(value) * shiftDecimal(rounded, -digits);
  }
  function evaluate(sku: string, id: FormulaId): FormulaResult {
    const key = JSON.stringify([sku, id]);
    if (results.has(key)) return results.get(key)!;
    if (visiting.has(key)) return { value: null, error: "#CYCLE!" };
    if (visiting.size >= 64) return { value: null, error: "#LIMIT!" };
    if (!visiting.size) steps = 0;
    visiting.add(key);
    let result: FormulaResult;
    try {
      const column = columns.get(id);
      if (!column?.enabled || !known.has(sku)) fail("#REF!");
      const formula = formulaForCell(column!, sku);
      if (!formula.trim()) result = { value: null };
      else {
        if (!compiled.has(formula)) {
          try { compiled.set(formula, parse(formula)); } catch (e) { compiled.set(formula, e instanceof FormulaError ? e.message : "#SYNTAX!"); }
        }
        const tree = compiled.get(formula)!;
        if (typeof tree === "string") fail(tree);
        const value = run(tree as Node, sku);
        if (typeof value === "number") numeric(value);
        result = { value };
      }
    } catch (e) { result = { value: null, error: e instanceof FormulaError ? e.message : "#VALUE!" }; }
    finally { visiting.delete(key); }
    results.set(key, result);
    return result;
  }
  return { evaluate };
}
