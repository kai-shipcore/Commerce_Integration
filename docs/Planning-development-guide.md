# Planning Development Guide

This guide defines the ownership boundaries for parallel development of the new Planning area.

## Shared foundation

Files that should stay small and change infrequently:

- `src/app/planning/layout.tsx`
- `src/components/planning/shell/planning-shell.tsx`
- `src/components/planning/sku-forecasts/shell/sku-forecasts-shell.tsx`
- `src/features/planning/mock-data.ts` while prototyping

Rule: change shared files only when the contract between features changes, not for page-specific styling or business logic.

## Recommended ownership split

### Developer A

- `src/components/planning/sku-forecasts/shell/**`
- `src/components/planning/sku-forecasts/sales-analysis/**`
- `src/components/planning/container-planning/**`
- `src/features/planning/sku-forecasts/hooks/use-sku-forecast-summary.ts`
- `src/features/planning/sku-forecasts/hooks/use-sales-analysis.ts`

### Developer B

- `src/components/planning/sku-forecasts/inventory-inbound/**`
- `src/components/planning/sku-forecasts/purchase-recommendation/**`
- `src/components/planning/purchase-orders/**`
- `src/components/planning/sku-master/**`
- `src/features/planning/sku-forecasts/hooks/use-inventory-inbound.ts`
- `src/features/planning/sku-forecasts/hooks/use-purchase-recommendation.ts`

## SKU Forecasts decomposition

```text
SkuForecastsShell
├─ SkuBrowserPanel
├─ SkuHeader
├─ SkuKpiStrip
└─ SkuForecastTabs
   ├─ SalesAnalysisTab
   ├─ InventoryInboundTab
   └─ PurchaseRecommendationTab
```

The shell owns selected SKU state and shared summary data.
Each tab owns only its own presentation and its own future data hook.

## TODO by feature

### Shared

- Replace mock data with API-backed hooks.
- Decide loading, empty, and error states for all Planning screens.
- Preserve thin shared layout boundaries; avoid pushing page-specific logic upward.

### SKU Forecasts / Sales Analysis

- Add real 7/15/30/60/90-day sales queries.
- Replace placeholder bars with a proper chart component.
- Add channel breakdown tables and weighted-average logic from real data.

### SKU Forecasts / Inventory & Inbound

- Add real inventory and inbound-container data.
- Add container status badges and projected-stock timeline.
- Define behavior for SKUs with no inbound inventory.

### SKU Forecasts / Purchase Recommendation

- Finalize target-stock formula.
- Add MOQ rounding, explanation copy, and create-PO action.
- Decide how approvals and overrides should be represented.

### Container Planning

- Build container creation/edit forms.
- Add PO linking, SKU quantity editing, status transitions, and CBM utilization.
- Decide whether packing-list import belongs here or in a later workflow.

### Purchase Orders

- Add create/edit flow, workflow state, and line-item editing.
- Add shortage auto-fill and import/export affordances.
- Wire the PO state machine before attaching backend persistence.

### SKU Master

- Add inline editing for CBM, MOQ, case quantity, and weight.
- Add CSV import/export flow and validation.
- Add missing-data indicators and audit behavior.

## Branching recommendation

1. Merge shared planning foundation first.
2. Then work in parallel:
   - `feat/planning-sales-container`
   - `feat/planning-inventory-po-master`
3. Shared-file changes should be separate, small PRs.

## Review checklist

- Did this change stay within the owner's folder?
- If a shared file changed, was that actually necessary?
- Are tabs still independent from one another?
- Did a mock-only assumption leak into future API design?
