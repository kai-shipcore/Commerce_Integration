"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppLayout } from "@/components/layout/app-layout";

interface PlanningShellProps {
  children: ReactNode;
}

export function PlanningShell({ children }: PlanningShellProps) {
  const pathname = usePathname();
  const fullBleedPages = new Set([
    "/planning/container-planning",
    "/planning/available-stock",
    "/planning/purchase-orders",
    "/planning/sku-master",
    "/planning/factories",
  ]);
  const surfaceClass = fullBleedPages.has(pathname)
    ? "min-w-0"
    : "planning-surface min-w-0";

  return (
    <AppLayout>
      <div className={surfaceClass}>{children}</div>
    </AppLayout>
  );
}
