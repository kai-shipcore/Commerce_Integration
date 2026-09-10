import type { CategoryFilter } from "@/types/demand-planning";

/**
 * The dashboard's category picker: one choice, three groups.
 *
 * It used to be a checkbox list over the five raw category codes, and picking
 * more than one was slow enough to be unusable — the server only scopes a
 * query when a single base category is selected, so any combination fell back
 * to fetching all 11k+ rows and filtering them in the browser, with the whole
 * set still passing through the grid and the container chain maths.
 *
 * The groups are the sets that are always read together: SWC and Accessories
 * are planned alongside Car Cover, and Seat Cover parts (CA-SC-PART-*)
 * already carry the SC category code, so that group's second half needs no
 * code of its own — the label just says so.
 */
export type CategoryGroup = "sc" | "cc" | "fm";

export const CATEGORY_GROUP_OPTIONS: { value: CategoryGroup; label: string; codes: CategoryFilter[] }[] = [
  { value: "sc", label: "Seat Cover + Part", codes: ["sc"] },
  { value: "cc", label: "Car Cover + SWC + Acc.", codes: ["cc", "swc", "ac"] },
  { value: "fm", label: "Floor Mat", codes: ["fm"] },
];

export const DEFAULT_CATEGORY_GROUP: CategoryGroup = "sc";

const GROUP_BY_CODE = new Map<string, CategoryGroup>(
  CATEGORY_GROUP_OPTIONS.flatMap((option) => option.codes.map((code) => [code, option.value] as const)),
);

export function categoryCodesForGroup(group: CategoryGroup): CategoryFilter[] {
  return CATEGORY_GROUP_OPTIONS.find((option) => option.value === group)?.codes
    ?? CATEGORY_GROUP_OPTIONS[0].codes;
}

/**
 * Reads the `product` query parameter. Links written before the picker became
 * single-choice carry a comma list (`?product=sc,cc`); rather than break them,
 * the first value that names a group wins — a shared link then opens on
 * something the reader asked for instead of a default.
 */
export function parseCategoryGroupParam(value: string | null): CategoryGroup {
  if (!value) return DEFAULT_CATEGORY_GROUP;
  for (const token of value.split(",")) {
    const group = GROUP_BY_CODE.get(token.trim().toLowerCase());
    if (group) return group;
  }
  return DEFAULT_CATEGORY_GROUP;
}
