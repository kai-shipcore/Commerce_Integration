import { SegmentationOverview } from "@/components/planning/demand-forecast/segmentation-overview";

export default function DemandForecastPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">Demand Forecast</h1>
        <p className="text-sm text-muted-foreground">
          Segmentation overview across all active SKUs
        </p>
      </div>
      <SegmentationOverview />
    </div>
  );
}
