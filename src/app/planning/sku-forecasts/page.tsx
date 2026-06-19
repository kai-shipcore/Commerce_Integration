import { SkuForecastsShell } from "@/components/planning/sku-forecasts/shell/sku-forecasts-shell";

export default async function SkuForecastsPage({
  searchParams,
}: {
  searchParams: Promise<{ sku?: string | string[] }>;
}) {
  const params = await searchParams;
  const initialSku = Array.isArray(params.sku) ? params.sku[0] : params.sku;
  return <SkuForecastsShell initialSku={initialSku} />;
}
