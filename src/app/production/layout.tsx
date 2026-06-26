import type { ReactNode } from "react";
import { ProductionShell } from "@/components/production/production-shell";

export default function ProductionLayout({ children }: { children: ReactNode }) {
  return <ProductionShell>{children}</ProductionShell>;
}
