"use client";

import { useEffect } from "react";
import { apiPath } from "@/lib/api-path";

export default function DemandForecastLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    fetch(apiPath("/api/forecast-server/start"), { method: "POST" }).catch(() => {});

    const handleBeforeUnload = () => {
      navigator.sendBeacon(apiPath("/api/forecast-server/stop"));
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      // Do not stop on navigation — other pages (e.g. SKU planning) also use the forecast server
    };
  }, []);

  return <>{children}</>;
}
