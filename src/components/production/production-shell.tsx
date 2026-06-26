"use client";

import type { ReactNode } from "react";
import { AppLayout } from "@/components/layout/app-layout";

interface ProductionShellProps {
  children: ReactNode;
}

export function ProductionShell({ children }: ProductionShellProps) {
  return (
    <AppLayout>
      <div className="min-w-0">{children}</div>
    </AppLayout>
  );
}
