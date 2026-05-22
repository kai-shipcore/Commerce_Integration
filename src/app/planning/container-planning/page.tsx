import { Suspense } from "react";
import { ContainerPlanningPage as ContainerPlanningContent } from "@/components/planning/container-planning/container-planning-page";

export default function ContainerPlanningPage() {
  return (
    <Suspense>
      <ContainerPlanningContent />
    </Suspense>
  );
}
