import type { SalesGroupSortOrder, SortDir } from "@/lib/planning/sales-group-sort";

/**
 * How the planning grid is ordered: one column, one of three ways.
 *
 * Lives here rather than in the grid because the dashboard holds it — a sort
 * a planner set up should still be there after a reload, the same as their
 * filters — and persisted state has to be parsed back defensively.
 */
export type GridSort =
  | { key: string; kind: "value"; dir: SortDir }
  | { key: string; kind: "color"; colorType: "fill" | "text"; color: string }
  | { key: string; kind: "sales-group"; order: SalesGroupSortOrder };

function isSortDir(value: unknown): value is SortDir {
  return value === "asc" || value === "desc";
}

export function normalizeGridSort(value: unknown): GridSort | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const key = candidate.key;
  if (typeof key !== "string" || !key) return null;

  if (candidate.kind === "value") {
    return isSortDir(candidate.dir) ? { key, kind: "value", dir: candidate.dir } : null;
  }
  if (candidate.kind === "color") {
    const colorType = candidate.colorType;
    const color = candidate.color;
    if ((colorType !== "fill" && colorType !== "text") || typeof color !== "string") return null;
    return { key, kind: "color", colorType, color };
  }
  if (candidate.kind === "sales-group") {
    const order = candidate.order as Record<string, unknown> | undefined;
    if (!order) return null;
    const { first, originalDir, customDir } = order;
    if ((first !== "Original" && first !== "Custom") || !isSortDir(originalDir) || !isSortDir(customDir)) return null;
    return { key, kind: "sales-group", order: { first, originalDir, customDir } };
  }
  return null;
}
