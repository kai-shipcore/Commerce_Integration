import React from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { SegmentDetailTable } from "@/components/planning/demand-forecast/segment-detail-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SEGMENT_LABELS: Record<string, { name: string; description: React.ReactNode }> = {
  smooth_full:  { name: "Smooth / Full history",  description: "StatsForecast model — sufficient history for statistical time series forecasting." },
  smooth_short: { name: "Smooth / Short history", description: <><strong>Low confidence.</strong> V1 model — smooth demand pattern but fewer than 52 weeks of history. Sorted by weeks until reclassification to full history.</> },
  intermittent: { name: "Intermittent",            description: "Restock policy — irregular or sparse demand." },
};

const ALL_PRODUCT_TYPES = ["Car Cover", "Seat Cover", "Floor Mat"];

export default async function SegmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ segment: string }>;
  searchParams: Promise<{ types?: string }>;
}) {
  const { segment } = await params;
  const { types } = await searchParams;
  const meta = SEGMENT_LABELS[segment] ?? { name: segment, description: "" };

  const initialTypes = types
    ? types.split(",").map((t) => t.trim()).filter((t) => ALL_PRODUCT_TYPES.includes(t))
    : ALL_PRODUCT_TYPES;

  return (
    <div className="mx-auto max-w-screen-xl space-y-4 px-6 py-6">
      <div>
        <Link
          href="/planning/demand-forecast"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Demand Forecast
        </Link>
      </div>

      <div>
        <h1 className="text-xl font-semibold">{meta.name}</h1>
        {meta.description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{meta.description}</p>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm font-medium">SKU detail</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <SegmentDetailTable segment={segment} initialTypes={initialTypes} />
        </CardContent>
      </Card>
    </div>
  );
}
