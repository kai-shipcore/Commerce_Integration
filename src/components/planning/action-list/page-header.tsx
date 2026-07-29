"use client";

/**
 * Code Guide:
 * Page header for the action list. Written rather than imported: the existing
 * page-headers.tsx exports one specific header per demand-forecast page and has
 * no generic component to reuse. The markup follows the same convention so the
 * pages look like siblings.
 */

import { useI18n } from "@/lib/i18n/i18n-provider";

export function ActionListPageHeader() {
  const { pick } = useI18n();
  return (
    <div>
      <h1 className="text-xl font-semibold">{pick("발주 목록", "Action List")}</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {pick(
          "예측과 재고, 선주문, 입고 예정을 결합해 지금 조치가 필요한 SKU를 우선순위로 보여줍니다.",
          "Forecast joined to stock, preorder backlog and confirmed inbound, ranked by what needs attention now.",
        )}
      </p>
    </div>
  );
}
