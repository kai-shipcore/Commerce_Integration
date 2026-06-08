import { Suspense } from "react";
import { DemandPlanningDashboard } from "@/components/planning/dashboard/demand-planning-dashboard";

export default function PlanningDashboardAgGridPage() {
  return (
    <Suspense>
      <DemandPlanningDashboard gridMode="ag-grid" />
    </Suspense>
  );
}
