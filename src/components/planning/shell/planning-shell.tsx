import type { ReactNode } from "react";
import { AppLayout } from "@/components/layout/app-layout";

interface PlanningShellProps {
  children: ReactNode;
}

export function PlanningShell({ children }: PlanningShellProps) {
  return (
    <AppLayout>
      <div className="planning-surface min-w-0">{children}</div>
    </AppLayout>
  );
}
