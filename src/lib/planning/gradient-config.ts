import type { GradientTier } from "./order-optimizer";
export type { GradientTier };

export const GRADIENT_STORAGE_KEY = "planning-dashboard-gradient";
export const GRADIENT_SC_STORAGE_KEY = "planning-dashboard-gradient-sc";

export const DEFAULT_GRADIENT: GradientTier[] = [
  { min_sales: 10.0, bonus: 15, tier: "TOP" },
  { min_sales:  5.0, bonus:  5, tier: "A"   },
  { min_sales:  0.3, bonus: -5, tier: "B"   },
  { min_sales:  0.1, bonus:-10, tier: "C"   },
];

export const DEFAULT_GRADIENT_SC: GradientTier[] = [
  { min_sales: 18.0, bonus: 15, tier: "TOP" },
  { min_sales:  8.0, bonus:  5, tier: "A"   },
  { min_sales:  3.0, bonus:  0, tier: "B"   },
  { min_sales:  0.3, bonus: -5, tier: "C"   },
  { min_sales:  0.1, bonus:-10, tier: "D"   },
];

function loadSaved(key: string, fallback: GradientTier[]): GradientTier[] {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = JSON.parse(window.localStorage.getItem(key) ?? "null") as unknown;
    if (Array.isArray(stored) && stored.length > 0) return stored as GradientTier[];
  } catch {
    // ignore
  }
  return fallback;
}

export function loadSavedGradient(): GradientTier[] {
  return loadSaved(GRADIENT_STORAGE_KEY, DEFAULT_GRADIENT);
}

export function saveGradient(gradient: GradientTier[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GRADIENT_STORAGE_KEY, JSON.stringify(gradient));
}

export function loadSavedGradientSC(): GradientTier[] {
  return loadSaved(GRADIENT_SC_STORAGE_KEY, DEFAULT_GRADIENT_SC);
}

export function saveGradientSC(gradient: GradientTier[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GRADIENT_SC_STORAGE_KEY, JSON.stringify(gradient));
}
