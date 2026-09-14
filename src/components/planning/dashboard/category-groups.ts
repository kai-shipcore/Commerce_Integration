import type { CategoryFilter } from "@/types/demand-planning";

/**
 * The dashboard's category picker: a checkbox list over the five raw codes,
 * with the three common sets offered as one-click presets.
 *
 * It was briefly one choice of three groups. The reason was that picking more
 * than one category defeated server scoping entirely — the endpoint took a
 * single code and dropped it for any combination, so the browser received all
 * 11k+ rows and filtered them itself. That was fixed in the same commit
 * (`1989984`): the endpoint now takes the codes as a list and filters on ANY
 * of them. What remains is only the row volume of a wide selection, which is
 * the reader's call to make.
 *
 * The presets are the sets that are usually read together: SWC and Accessories
 * are planned alongside Car Cover, and Seat Cover parts (CA-SC-PART-*)
 * already carry the SC category code, so that preset's second half needs no
 * code of its own — the label just says so.
 */
export type CategoryGroup = "sc" | "cc" | "fm";

export const CATEGORY_GROUP_OPTIONS: { value: CategoryGroup; label: string; codes: CategoryFilter[] }[] = [
  { value: "sc", label: "Seat Cover + Part", codes: ["sc"] },
  { value: "cc", label: "Car Cover + SWC + Acc.", codes: ["cc", "swc", "ac"] },
  { value: "fm", label: "Floor Mat", codes: ["fm"] },
];

export const DEFAULT_CATEGORY_GROUP: CategoryGroup = "sc";

export function categoryCodesForGroup(group: CategoryGroup): CategoryFilter[] {
  return CATEGORY_GROUP_OPTIONS.find((option) => option.value === group)?.codes
    ?? CATEGORY_GROUP_OPTIONS[0].codes;
}

export const CATEGORY_CODE_OPTIONS: { value: CategoryFilter; label: string }[] = [
  { value: "sc", label: "Seat Cover" },
  { value: "cc", label: "Car Cover" },
  { value: "fm", label: "Floor Mat" },
  { value: "ac", label: "Accessories" },
  { value: "swc", label: "SWC" },
];

const VALID_CATEGORY_CODES = new Set<string>(CATEGORY_CODE_OPTIONS.map((option) => option.value));

/** The codes a bare dashboard opens on. Kept at Seat Cover so the first screen
 *  is what it has always been, rather than all five categories at once. */
export const DEFAULT_CATEGORY_CODES: CategoryFilter[] = categoryCodesForGroup(DEFAULT_CATEGORY_GROUP);

/**
 * Reads the `product` query parameter as the set of category codes to show.
 * Every token counts, so `?product=sc,cc` opens both — which is what such a
 * link meant when it was written, and what it means again now.
 *
 * Note this reads raw codes, not preset names. They spell the same for three
 * of them, so a link saying `?product=cc` now opens Car Cover alone rather
 * than the Car Cover + SWC + Accessories preset.
 */
export function parseCategoryCodesParam(value: string | null): CategoryFilter[] {
  if (!value) return DEFAULT_CATEGORY_CODES;
  const codes = value
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token): token is CategoryFilter => VALID_CATEGORY_CODES.has(token));
  // An unreadable parameter is treated as no parameter: an empty selection
  // would mean every category, which is not what a broken link should do.
  return codes.length ? [...new Set(codes)] : DEFAULT_CATEGORY_CODES;
}

/** Serializes back into `?product=`, in the option order so the URL is stable
 *  regardless of the order boxes were ticked. */
export function serializeCategoryCodes(codes: CategoryFilter[]): string {
  const selected = new Set(codes);
  return CATEGORY_CODE_OPTIONS
    .filter((option) => selected.has(option.value))
    .map((option) => option.value)
    .join(",");
}
