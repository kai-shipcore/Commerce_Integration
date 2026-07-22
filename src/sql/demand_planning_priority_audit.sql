/*
  수요예측 우선순위 및 발주 추천 전체 조회

  우선순위
    1순위: 최근 30일 Pre-Order가 있음
    2순위: 사용 가능 재고가 0 이하
    3순위: 최근 30일 판매량 상위 10%

  발주 추천 공식
    Pre-Order
    + (일평균 수요 × 리드타임 70일)
    + (일평균 수요 × 안전재고 30일)
    - 현재 재고
    - 확정 입고

  계산 결과가 0 이하면 최종 발주량은 0입니다.
*/

WITH base AS (
  /* 1. SKU별 필요한 원본 데이터를 가져옵니다. */
  SELECT
    s.master_sku AS sku,

    -- 현재 사용 가능 재고
    (
      COALESCE(s.west_available_stock, 0)
      + COALESCE(s.east_available_stock, 0)
      + COALESCE(s.transit_stock, 0)
    )::int AS available_stock,

    -- 최근 30일 Pre-Order 수량
    (
      COALESCE(s.west_30d_pre, 0)
      + COALESCE(s.east_30d_pre, 0)
    )::numeric AS pre_order_qty,

    COALESCE(s.total_30d, 0)::int AS sales_30d,
    COALESCE(s.total_avg_curr, 0)::numeric AS avg_daily_demand,
    COALESCE(inbound.inbound_qty, 0)::int AS inbound_qty,

    -- MOQ 또는 Pack 단위 (0이나 음수이면 1 사용)
    CASE
      WHEN COALESCE(p.order_multiple, p.moq, 1) > 0
        THEN COALESCE(p.order_multiple, p.moq, 1)
      ELSE 1
    END::int AS order_unit,
    s.calculated_at

  FROM shipcore.fc_stats s
  LEFT JOIN shipcore.fc_products p
    ON p.master_sku = s.master_sku

  -- 확정된 컨테이너 입고 수량
  LEFT JOIN (
    SELECT
      ci.master_sku,
      SUM(ci.qty)::int AS inbound_qty
    FROM shipcore.fc_container_items ci
    JOIN shipcore.fc_containers c
      ON c.id = ci.container_id
    WHERE c.status IN ('shipped', 'packing_received')
    GROUP BY ci.master_sku
  ) inbound
    ON inbound.master_sku = s.master_sku

  -- Seat Cover SKU만 조회
  WHERE
    UPPER(p.category_code) = 'SC'
    OR (
      p.category_code IS NULL
      AND (
        UPPER(s.master_sku) LIKE 'CA-SC-%'
        OR UPPER(s.master_sku) LIKE 'CL-SC-%'
      )
    )
),

best_seller AS (
  /* 2. 판매량이 있는 SKU 중 상위 10%가 시작되는 판매량을 구합니다. */
  SELECT
    COALESCE(
      PERCENTILE_DISC(0.90) WITHIN GROUP (ORDER BY sales_30d),
      0
    )::int AS minimum_sales_30d
  FROM base
  WHERE sales_30d > 0
),

calculated AS (
  /* 3. 조건과 발주 추천 수량을 계산합니다. */
  SELECT
    b.*,
    bs.minimum_sales_30d AS best_seller_minimum,

    (b.pre_order_qty > 0) AS is_pre_order,
    (b.available_stock <= 0) AS is_no_stock,
    (
      b.sales_30d > 0
      AND b.sales_30d >= bs.minimum_sales_30d
    ) AS is_best_seller,

    ROUND(b.avg_daily_demand * 70)::int AS lead_time_demand,
    ROUND(b.avg_daily_demand * 30)::int AS safety_stock,

    -- 음수 보정 전 발주 추천 수량
    (
      ROUND(b.pre_order_qty)
      + ROUND(b.avg_daily_demand * 70)
      + ROUND(b.avg_daily_demand * 30)
      - b.available_stock
      - b.inbound_qty
    )::int AS raw_recommended_qty

  FROM base b
  CROSS JOIN best_seller bs
)

/* 4. 전체 SKU의 최종 결과를 출력합니다. */
SELECT
  CASE
    WHEN is_pre_order  THEN 'P1 Pre-Order'
    WHEN is_no_stock  THEN 'P2 No Stock'
    WHEN is_best_seller THEN 'P3 Best Seller'
    ELSE 'Normal'
  END AS priority,

  -- 두 가지 이상의 조건이 동시에 해당하는지 쉽게 확인하는 컬럼
  CONCAT_WS(
    ' + ',
    CASE WHEN is_pre_order   THEN 'Pre-Order' END,
    CASE WHEN is_no_stock   THEN 'No Stock' END,
    CASE WHEN is_best_seller THEN 'Best Seller' END
  ) AS matched_conditions,

  sku,
  available_stock,
  pre_order_qty,
  sales_30d,
  best_seller_minimum,
  ROUND(avg_daily_demand, 3) AS avg_daily_demand,
  lead_time_demand,
  safety_stock,
  inbound_qty,
  raw_recommended_qty,

  -- 음수이면 0으로 처리한 기본 추천량
  CASE
    WHEN raw_recommended_qty > 0 THEN raw_recommended_qty
    ELSE 0
  END AS base_recommended_qty,
  order_unit,

  -- MOQ/Pack 단위로 올림한 최종 발주량
  CASE
    WHEN raw_recommended_qty <= 0 THEN 0
    ELSE (
      CEIL(raw_recommended_qty::numeric / order_unit)
      * order_unit
    )::int
  END AS final_recommended_qty,

  calculated_at

FROM calculated
ORDER BY
  CASE
    WHEN is_pre_order   THEN 1
    WHEN is_no_stock   THEN 2
    WHEN is_best_seller THEN 3
    ELSE 4
  END,
  sales_30d DESC,
  sku;
