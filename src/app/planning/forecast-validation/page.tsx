/**
 * Code Guide:
 * /planning/forecast-validation — evidence that the model is worth using.
 *
 * Answers three separate questions that are easy to conflate. Is the model
 * better than the spreadsheet it replaces, measured on backtest windows. How do
 * the forecasts it actually served hold up as those weeks close. And what does
 * demand look like underneath all of it, so the accuracy figures are read at the
 * right scale.
 *
 * Distinct from /planning/action-list, which is about what to order today.
 * Nothing here is an instruction; it is the basis for trusting the ones there.
 *
 * Sections render as their data arrives and say so in place when they have
 * none, rather than being hidden. Section 04 fills as runs accumulate. Section
 * 06 was quarantined until model development finished; it has been served from
 * outputs/reports/final_test.json since 2026-08-14 and is now the strongest
 * claim on the page rather than the absence of one. This comment said the
 * opposite until then.
 *
 * The page runs on two clocks and every section says which. Sections 02, 03 and
 * 04 read data/processed and move with the Tuesday cron. Sections 01, 05 and 06
 * read the snapshot pinned by ML_DATA_SNAPSHOT and are supposed to sit still,
 * which makes them trustworthy only while that snapshot still resembles what is
 * being served. See section-basis.tsx: that stopped being true on 2026-08-11
 * and nothing on the page could express it.
 */

import { ValidationContent } from "@/components/planning/validation/validation-content";
import { ValidationPageHeader } from "@/components/planning/validation/page-header";

export default function ForecastValidationPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <ValidationPageHeader />
      <ValidationContent />
    </div>
  );
}
