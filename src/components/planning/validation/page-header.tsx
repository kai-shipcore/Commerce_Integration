"use client";

/**
 * Code Guide:
 * Page header for forecast validation. Mirrors the action list header so the two
 * planning pages read as siblings.
 */

import { useI18n } from "@/lib/i18n/i18n-provider";

export function ValidationPageHeader() {
  const { pick } = useI18n();
  return (
    <div>
      <h1 className="text-xl font-semibold">{pick("예측 검증", "Forecast Validation")}</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {pick(
          "새 모델이 기존 스프레드시트 방식보다 실제로 나은지, 시간이 지나며 어떻게 달라지는지, 그리고 수요가 어디에 몰려 있는지를 보여줍니다.",
          "Whether the model actually beats the spreadsheet it replaces, how it holds up as weeks close, and where demand really sits.",
        )}
      </p>
    </div>
  );
}
