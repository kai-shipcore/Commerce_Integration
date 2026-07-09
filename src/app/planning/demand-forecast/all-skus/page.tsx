import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { AllSkusTable } from "@/components/planning/demand-forecast/all-skus-table";
import { Card, CardContent } from "@/components/ui/card";
import { SKUGlobalSearch } from "@/components/planning/demand-forecast/sku-global-search";
import { AllSkusPageHeader, BackToDemandForecast } from "@/components/planning/demand-forecast/page-headers";

const ALL_PRODUCT_TYPES = ["Car Cover", "Seat Cover", "Floor Mat"];

export default async function AllSkusPage({
  searchParams,
}: {
  searchParams: Promise<{ types?: string }>;
}) {
  const { types } = await searchParams;

  const initialTypes = types
    ? types.split(",").map((t) => t.trim()).filter((t) => ALL_PRODUCT_TYPES.includes(t))
    : ALL_PRODUCT_TYPES;

  return (
    <div className="mx-auto max-w-screen-xl space-y-4 px-6 py-6">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/planning/demand-forecast"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          <BackToDemandForecast />
        </Link>
        <SKUGlobalSearch />
      </div>

      <AllSkusPageHeader />

      <Card>
        <CardContent className="py-4">
          <AllSkusTable initialTypes={initialTypes} />
        </CardContent>
      </Card>
    </div>
  );
}
