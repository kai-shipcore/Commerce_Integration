import { SkuForecastsShell } from "@/components/planning/sku-forecasts/shell/sku-forecasts-shell";
import type { SkuForecastTab } from "@/components/planning/sku-forecasts/shell/sku-forecast-tabs";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseTab(value: string | undefined): SkuForecastTab {
  if (
    value === "inventory" ||
    value === "history" ||
    value === "purchase" ||
    value === "forecast"
  ) return value;
  return "sales";
}

const VALID_FILTERS = ["all", "critical", "watch", "high", "low", "order"];

export default async function SkuForecastsPage({
  searchParams,
}: {
  searchParams: Promise<{
    sku?: string | string[];
    tab?: string | string[];
    includeDrafts?: string | string[];
    highlightContainerId?: string | string[];
    highlightContainer?: string | string[];
    filter?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const initialSku = firstParam(params.sku);
  const initialTab = parseTab(firstParam(params.tab));
  const includeDrafts = firstParam(params.includeDrafts);
  const initialIncludeDraftContainers = includeDrafts === "1" || includeDrafts === "true";
  const filterParam = firstParam(params.filter);
  const initialFilter = filterParam && VALID_FILTERS.includes(filterParam) ? filterParam : undefined;

  return (
    <SkuForecastsShell
      initialSku={initialSku}
      initialTab={initialTab}
      initialIncludeDraftContainers={initialIncludeDraftContainers}
      initialHighlightedContainerId={firstParam(params.highlightContainerId)}
      initialHighlightedContainerName={firstParam(params.highlightContainer)}
      initialFilter={initialFilter}
    />
  );
}
