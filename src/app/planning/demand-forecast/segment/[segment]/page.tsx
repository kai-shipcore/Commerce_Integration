import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { SegmentDetailTable } from "@/components/planning/demand-forecast/segment-detail-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SKUGlobalSearch } from "@/components/planning/demand-forecast/sku-global-search";
import { SegmentDetailPageHeader, SegmentDetailCardTitle, BackToDemandForecast } from "@/components/planning/demand-forecast/page-headers";

const ALL_PRODUCT_TYPES = ["Car Cover", "Seat Cover", "Floor Mat"];

export default async function SegmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ segment: string }>;
  searchParams: Promise<{ types?: string; sku?: string }>;
}) {
  const { segment } = await params;
  const { types, sku } = await searchParams;

  const initialTypes = types
    ? types.split(",").map((t) => t.trim()).filter((t) => ALL_PRODUCT_TYPES.includes(t))
    : ALL_PRODUCT_TYPES;

  return (
    <div className="mx-auto max-w-screen-xl space-y-4 px-6 py-6">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/planning/demand-forecast"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          <BackToDemandForecast />
        </Link>
        <SKUGlobalSearch />
      </div>

      <SegmentDetailPageHeader segment={segment} />

      <Card>
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm font-medium"><SegmentDetailCardTitle /></CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <SegmentDetailTable segment={segment} initialTypes={initialTypes} initialSku={sku} />
        </CardContent>
      </Card>
    </div>
  );
}
