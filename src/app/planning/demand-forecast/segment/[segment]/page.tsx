import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { SegmentDetailTable } from "@/components/planning/demand-forecast/segment-detail-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SEGMENT_LABELS: Record<string, { name: string; description: string }> = {
  smooth_full:  { name: "Smooth / Full history",  description: "StatsForecast model — sufficient history for statistical time series forecasting." },
  smooth_short: { name: "Smooth / Short history", description: "V1 model — smooth demand pattern but fewer than 52 weeks of history. Sorted by weeks until reclassification to full history." },
  intermittent: { name: "Intermittent",            description: "Restock policy — irregular or sparse demand." },
};

export default async function SegmentDetailPage({
  params,
}: {
  params: Promise<{ segment: string }>;
}) {
  const { segment } = await params;
  const meta = SEGMENT_LABELS[segment] ?? { name: segment, description: "" };

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
          <SegmentDetailTable segment={segment} />
        </CardContent>
      </Card>
    </div>
  );
}
