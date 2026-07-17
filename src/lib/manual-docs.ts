/**
 * Code Guide:
 * Single source of truth mapping a navigation menu id to its help
 * documentation. Used by both the client-side help link (AppLayout) and
 * the server-side /manual/[menuId] route, so a menu's manual entry and
 * its permission gate can never drift apart.
 */

export type ManualDocEntry = { kind: "section"; sectionId: string };

export const MANUAL_DOC_BY_MENU_ID: Record<string, ManualDocEntry> = {
  // Generic fallback for menus with no dedicated help content yet
  // (e.g. products, collections, purchase-orders). No permission section
  // is registered for this pseudo-id, so it only requires a login.
  overview: { kind: "section", sectionId: "overview" },

  // Dedicated standalone docs (admin-only feature areas)
  "invoice-price-control": { kind: "section", sectionId: "invoice-price-control" },
  "seat-cover-sizes": { kind: "section", sectionId: "seat-cover-sizes" },
  "production-vehicles": { kind: "section", sectionId: "production-vehicles" },
  "production-parts-codes": { kind: "section", sectionId: "production-parts-codes" },
  "part-sku-generator": { kind: "section", sectionId: "part-sku-generator" },

  // General manual, split per section
  dashboard: { kind: "section", sectionId: "command-center" },
  inventory: { kind: "section", sectionId: "inventory" },
  orders: { kind: "section", sectionId: "orders" },
  velocity: { kind: "section", sectionId: "velocity" },
  "demand-planning": { kind: "section", sectionId: "demand-planning" },
  "sku-forecasts": { kind: "section", sectionId: "sku-planning" },
  "demand-forecast": { kind: "section", sectionId: "demand-forecast-page" },
  "container-planning": { kind: "section", sectionId: "container-planning" },
  "container-timeline": { kind: "section", sectionId: "container-timeline" },
  "transit-stock": { kind: "section", sectionId: "transit-stock" },
  "available-stock": { kind: "section", sectionId: "available-stock" },
  "sku-master": { kind: "section", sectionId: "sku-master" },
  "seat-cover-parts": { kind: "section", sectionId: "parts" },
  factories: { kind: "section", sectionId: "factories" },
  "warehouse-admin": { kind: "section", sectionId: "warehouse" },
  integrations: { kind: "section", sectionId: "integrations" },
  "audit-log": { kind: "section", sectionId: "audit-log" },
  "container-import": { kind: "section", sectionId: "container-import" },
};

export const DEFAULT_MANUAL_MENU_ID = "overview";

// Demo videos embedded inline in a menu's help section (see manual-access's
// rewriteMediaPaths + /manual/media/[menuId]). Filenames live in
// src/content/manual/media, gated by the same permission as the doc page.
export const MANUAL_VIDEO_BY_MENU_ID: Record<string, string> = {
  "invoice-price-control": "invoice-price-control-demo.webm",
};

// sku-forecasts has multiple in-page anchors (one per tab) inside the same
// "sku-planning" section — these are hash-only jumps, not separate docs,
// since the tabs all share one permission section.
export const SKU_FORECAST_SECTION_ANCHOR_BY_TAB: Record<string, string> = {
  sales: "sp-analysis",
  inventory: "sp-inventory",
  history: "sp-inbound-history",
  purchase: "sp-recommend",
  forecast: "sp-forecast",
};
