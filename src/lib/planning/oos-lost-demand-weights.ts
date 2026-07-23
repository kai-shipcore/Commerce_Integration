export const OOS_LOST_DEMAND_WEIGHTS_STORAGE_KEY = "planning-dashboard-oos-lost-demand-weights";

export type Marketplace = "amazon" | "ebay" | "walmart";
// null = no override — server computes the weight fresh each sync from
// category-level 90-day sales ratios (marketplace / Shopify).
export type MarketplaceWeights = Record<Marketplace, number | null>;
export type CategoryKey = "SC" | "CC" | "FM";
export type OosLostDemandWeights = Record<CategoryKey, MarketplaceWeights>;

const AUTO_MARKETPLACE_WEIGHTS: MarketplaceWeights = { amazon: null, ebay: null, walmart: null };

export const DEFAULT_OOS_LOST_DEMAND_WEIGHTS: OosLostDemandWeights = {
  SC: { ...AUTO_MARKETPLACE_WEIGHTS },
  CC: { ...AUTO_MARKETPLACE_WEIGHTS },
  FM: { ...AUTO_MARKETPLACE_WEIGHTS },
};

export const OOS_LOST_DEMAND_CATEGORIES: Array<{ key: CategoryKey; label: string }> = [
  { key: "SC", label: "Seat Cover" },
  { key: "CC", label: "Car Cover" },
  { key: "FM", label: "Floor Mat" },
];

export const OOS_LOST_DEMAND_MARKETPLACES: Array<{ key: Marketplace; label: string }> = [
  { key: "amazon", label: "Amazon" },
  { key: "ebay", label: "eBay" },
  { key: "walmart", label: "Walmart" },
];

function isValidWeight(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function normalizeMarketplaceWeights(value: unknown, fallback: MarketplaceWeights): MarketplaceWeights {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const stored = value as Record<string, unknown>;
  return Object.fromEntries(
    OOS_LOST_DEMAND_MARKETPLACES.map(({ key }) => [
      key,
      stored[key] === null ? null : isValidWeight(stored[key]) ? stored[key] : fallback[key],
    ]),
  ) as MarketplaceWeights;
}

export function normalizeOosLostDemandWeights(value: unknown): OosLostDemandWeights {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_OOS_LOST_DEMAND_WEIGHTS;
  const stored = value as Record<string, unknown>;
  return Object.fromEntries(
    OOS_LOST_DEMAND_CATEGORIES.map(({ key }) => [
      key,
      normalizeMarketplaceWeights(stored[key], DEFAULT_OOS_LOST_DEMAND_WEIGHTS[key]),
    ]),
  ) as OosLostDemandWeights;
}

export function loadSavedOosLostDemandWeights(): OosLostDemandWeights {
  if (typeof window === "undefined") return DEFAULT_OOS_LOST_DEMAND_WEIGHTS;
  try {
    return normalizeOosLostDemandWeights(
      JSON.parse(window.localStorage.getItem(OOS_LOST_DEMAND_WEIGHTS_STORAGE_KEY) ?? "{}"),
    );
  } catch {
    return DEFAULT_OOS_LOST_DEMAND_WEIGHTS;
  }
}
