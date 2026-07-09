"use client";

import React from "react";
import { useI18n } from "@/lib/i18n/i18n-provider";

export function DemandForecastPageHeader() {
  const { pick } = useI18n();
  return (
    <div>
      <h1 className="text-lg font-semibold">{pick("수요 예측", "Demand Forecast")}</h1>
      <p className="text-sm text-muted-foreground">
        {pick("전체 활성 SKU의 세그멘테이션 개요", "Segmentation overview across all active SKUs")}
      </p>
    </div>
  );
}

const SEGMENT_META: Record<string, { ko: { name: string; desc: React.ReactNode }; en: { name: string; desc: React.ReactNode } }> = {
  smooth_full: {
    ko: { name: "스무스 / 전체 이력", desc: "StatsForecast 모델 — 통계적 시계열 예측에 충분한 이력이 있습니다." },
    en: { name: "Smooth / Full history", desc: "StatsForecast model — sufficient history for statistical time series forecasting." },
  },
  smooth_short: {
    ko: { name: "스무스 / 단기 이력", desc: <><strong>낮은 신뢰도.</strong> Window Average 모델 — 스무스 수요 패턴이지만 52주 미만의 이력입니다. 전체 이력 재분류까지 남은 주 수 기준 정렬됩니다.</> },
    en: { name: "Smooth / Short history", desc: <><strong>Low confidence.</strong> Window Average model — smooth demand pattern but fewer than 52 weeks of history. Sorted by weeks until reclassification to full history.</> },
  },
  intermittent: {
    ko: { name: "비정기", desc: "재입고 정책 — 불규칙하거나 드문 수요입니다." },
    en: { name: "Intermittent", desc: "Restock policy — irregular or sparse demand." },
  },
};

export function SegmentDetailPageHeader({ segment }: { segment: string }) {
  const { locale } = useI18n();
  const meta = SEGMENT_META[segment];
  if (!meta) return null;
  const { name, desc } = locale === "ko" ? meta.ko : meta.en;
  return (
    <div>
      <h1 className="text-xl font-semibold">{name}</h1>
      {desc && <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>}
    </div>
  );
}

export function AllSkusPageHeader() {
  const { pick } = useI18n();
  return (
    <div>
      <h1 className="text-xl font-semibold">{pick("전체 SKU", "All SKUs")}</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {pick(
          "세그먼트 전체를 아우르는 SKU 디렉토리 — 수요, 추세, 분류, 예측을 한눈에 봅니다.",
          "Cross-segment SKU directory — demand, momentum, classification, and forecast in one view.",
        )}
      </p>
    </div>
  );
}

export function SegmentDetailCardTitle() {
  const { pick } = useI18n();
  return <>{pick("SKU 상세", "SKU detail")}</>;
}

export function BackToDemandForecast() {
  const { pick } = useI18n();
  return <>{pick("수요 예측", "Demand Forecast")}</>;
}
