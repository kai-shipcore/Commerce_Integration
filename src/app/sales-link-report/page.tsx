/**
 * Code Guide:
 * Standalone page for rebuilding the Excel Sales tab's Link Sales block from
 * ecommerce_data.vw_sales_order_items_link_new.
 */

import { AppLayout } from "@/components/layout/app-layout";
import { SalesLinkReportTable } from "@/components/sales-link-report/sales-link-report-table";
import { FileSpreadsheet } from "lucide-react";

export default function SalesLinkReportPage() {
  return (
    <AppLayout>
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          <h1 className="text-xl font-semibold">Sales Link Report</h1>
        </div>

        <SalesLinkReportTable />
      </div>
    </AppLayout>
  );
}
