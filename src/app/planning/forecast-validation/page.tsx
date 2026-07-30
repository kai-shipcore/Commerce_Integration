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
 * The last two sections have no data yet by design: runs have to accumulate, and
 * the final test window is quarantined until model development finishes. Both
 * say so in place rather than being hidden.
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
