import { Suspense } from "react";
import { ContainerTimelinePage as ContainerTimelineContent } from "@/components/planning/container-timeline/container-timeline-page";

export default function ContainerTimelinePage() {
  return (
    <Suspense>
      <ContainerTimelineContent />
    </Suspense>
  );
}
