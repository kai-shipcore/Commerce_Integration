// Amazon FBA is split by destination in the velocity snapshots: orders shipped to
// Canada (sales_orders.shipping_country = 'CA') are 'Amazon FBA Canada', every other
// FBA order is 'Amazon FBA USA'. Readers that want "all FBA" (Demand Planning's FBA
// columns, the West = non-FBA split, OOS channel groups) must match every value here.
//
// 'Amazon FBA' is the pre-split value. Snapshot rows older than the incremental sync's
// lookback keep it until a full Velocity sync rewrites them, so it stays in the list.
export const FBA_USA_CHANNEL = "Amazon FBA USA";
export const FBA_CANADA_CHANNEL = "Amazon FBA Canada";
export const LEGACY_FBA_CHANNEL = "Amazon FBA";

export const FBA_CHANNELS = [FBA_USA_CHANNEL, FBA_CANADA_CHANNEL, LEGACY_FBA_CHANNEL] as const;

/** SQL list literal for `channel IN (...)`, e.g. `'Amazon FBA USA','Amazon FBA Canada','Amazon FBA'`. */
export const FBA_CHANNELS_SQL = FBA_CHANNELS.map((c) => `'${c}'`).join(",");
