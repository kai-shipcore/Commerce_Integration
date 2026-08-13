/**
 * Code Guide:
 * /planning/action-list — what to order today.
 *
 * Distinct from /planning/forecast-validation, which reports on how the model is
 * performing. This page joins that forecast to stock on hand, preorder backlog
 * and confirmed inbound, and ranks SKUs by what needs attention.
 *
 * (It was previously distinguished from /planning/demand-forecast, which covered
 * both jobs against the legacy pipeline and was deleted in August 2026.)
 *
 * All figures come from the FastAPI planning endpoints, which read the same
 * Python module the forecasting repo's own dashboard renders, so the two cannot
 * disagree about a recommended quantity.
 *
 * Planning parameters are read from the query string so that returning from a
 * SKU detail view restores what the user was working at.
 */

import { ActionListContent } from "@/components/planning/action-list/action-list-content";
import { ActionListPageHeader } from "@/components/planning/action-list/page-header";
import { planningParamsFrom } from "@/components/planning/action-list/types";

export default async function ActionListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const first = (key: string) => {
    const v = sp[key];
    return Array.isArray(v) ? v[0] : v;
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <ActionListPageHeader />
      <ActionListContent initialParams={planningParamsFrom(first)} />
    </div>
  );
}
