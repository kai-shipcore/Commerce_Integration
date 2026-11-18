export const CHANGED_ADS_FILL = "#FECACA";

const ADS_OVERRIDE_FIELDS: Record<string, string> = {
  tavg_p: "total_avg_prev_override",
  tavg_r: "total_avg_real_override",
  tavg_c: "total_avg_curr_override",
};

/** Returns the automatic red fill used by edited ADS cells. Keeping this
 * resolver shared makes the grid and its Filter by Color menu see the same
 * colour, including when the edited value is zero. */
export function changedAdsFill(
  columnId: string,
  row: Record<string, unknown>,
): string {
  const field = ADS_OVERRIDE_FIELDS[columnId];
  return field && row[field] != null ? CHANGED_ADS_FILL : "";
}
