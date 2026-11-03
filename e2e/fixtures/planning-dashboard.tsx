// The real dashboard and grid, with network responses supplied by the test.
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/lib/i18n/i18n-provider";
import { DemandPlanningDashboard } from "@/components/planning/dashboard/demand-planning-dashboard";
import "@/app/globals.css";

createRoot(document.getElementById("root")!).render(
  <I18nProvider><DemandPlanningDashboard gridMode="ag-grid" /></I18nProvider>,
);
