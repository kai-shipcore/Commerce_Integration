"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppLayout } from "@/components/layout/app-layout";
import { stripBasePath } from "@/lib/api-path";

interface PlanningShellProps {
  children: ReactNode;
}

export function PlanningShell({ children }: PlanningShellProps) {
  const pathname = usePathname();
  const appPathname = stripBasePath(pathname);
  const fullBleedPages = new Set([
    "/planning/dashboard-ag-grid",
    "/planning/dashboard",
    "/planning/container-planning",
    "/planning/available-stock",
    "/planning/purchase-orders",
    "/planning/sku-master",
    "/planning/factories",
    "/planning/seat-cover/parts",
  ]);
  const surfaceClass = fullBleedPages.has(appPathname)
    ? "min-w-0"
    : "planning-surface min-w-0";

  return (
    <AppLayout>
      <div className={surfaceClass}>{children}</div>
    </AppLayout>
  );
}
