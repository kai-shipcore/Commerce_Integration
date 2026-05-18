import type { ReactNode } from "react";
import { PlanningShell } from "@/components/planning/shell/planning-shell";

interface PlanningLayoutProps {
  children: ReactNode;
}

export default function PlanningLayout({ children }: PlanningLayoutProps) {
  return <PlanningShell>{children}</PlanningShell>;
}
