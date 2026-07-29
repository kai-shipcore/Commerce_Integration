/**
 * Code Guide:
 * /planning/action-list/[sku] — detail for one SKU on the action list.
 *
 * The SKU travels in the path rather than a query string, so a row on the list
 * links to a real URL: shareable, bookmarkable, and openable in a new tab with a
 * middle click.
 *
 * The planning parameters travel in the query string and are read here, on the
 * server, rather than with useSearchParams in the client component. Both work,
 * but reading them here avoids the Suspense boundary that hook requires and
 * keeps the client component a pure function of its props.
 */

import { SkuDetailContent } from "@/components/planning/action-list/sku-detail-content";
import { planningParamsFrom } from "@/components/planning/action-list/types";

export default async function ActionListSkuPage({
  params,
  searchParams,
}: {
  params: Promise<{ sku: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { sku } = await params;
  const sp = await searchParams;
  const first = (key: string) => {
    const v = sp[key];
    return Array.isArray(v) ? v[0] : v;
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <SkuDetailContent sku={decodeURIComponent(sku)} planning={planningParamsFrom(first)} />
    </div>
  );
}
