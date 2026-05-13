# Velocity — Sales Velocity Dashboard

> 판매 채널·카테고리·기간별 판매 속도를 한눈에 파악하는 내부 대시보드

---

## 개요

| | |
|---|---|
| **목적** | Master SKU 단위 판매 수량을 채널·기간별로 비교 분석 |
| **데이터 소스** | Supabase (Shopify / Amazon / Walmart / eBay 주문 통합) |
| **갱신 방식** | 수동 Sync — 버튼 클릭 시 최신 데이터 반영 |
| **검증 상태** | ✅ 전 채널·카테고리·모드 완전 일치 확인 (2026-05-13) |

---

## 화면 구성

```
┌─────────────────────────────────────────────────────────┐
│  Velocity                          Last synced: 05/13 14:22   [Sync] │
├─────────────────────────────────────────────────────────┤
│  Item     [ Car Cover ]  [ Seat Cover ]  [ Floor Mat ]          │
│  Channel  [ All ]  [ Coverland ]  [ Amazon FBA ]  [ ... ]      │
│  Mode     [ Sales ]  [ TTM ]  [ Pre Order ]    Period ▾        │
├─────────────────────────────────────────────────────────┤
│  [ Export ]  [ Export All ]                                      │
│                                                                   │
│  Master SKU │ Total Sales          │ Final Car Cover Sales       │
│             │ 90D  60D  30D  15D  7D│ Final SKU  90D  60D  ...  │
│  ─────────────────────────────────────────────────────  │
│  Total      │ 3,412 ...            │ Total  3,412 ...            │
│  CC-CC-15-… │   241 ...            │ CC-CC-15-…  241 ...         │
└─────────────────────────────────────────────────────────┘
```

---

## 필터 옵션

### Item (단일 선택)

| 선택값 | 표시 데이터 |
|---|---|
| **Car Cover** | Total Sales + Final Car Cover Sales (BKGR → BKLG 변환 표시) |
| **Seat Cover** | Link Sales/TTM + Custom Sales/TTM |
| **Floor Mat** | Total Sales |

### Channel (다중 선택)

`Coverland` · `Icarcover` · `Amazon FBA` · `Amazon FBM` · `Auto_Armor` · `Advance_Parts` · `Walmart`

### Mode

| 모드 | 집계 대상 |
|---|---|
| **Sales** | 일반 판매 주문 |
| **TTM** | TTM(To The Market) 주문 |
| **Pre Order** | 선주문 — 기간 필터 없이 전체 합산 |

### 기간 설정

- **Period 모드** — N일 chip으로 지정 (기본: 90 · 60 · 30 · 15 · 7D, 최대 5개)
- **Custom 모드** — 날짜 범위 직접 입력 (최대 5개)
- 기준일: 항상 오늘 −2일 (당일·전일 데이터 제외)

---

## 테이블 컬럼 구조

### Car Cover

```
Master SKU │ ←── Total Sales ──→ │ ←──── Final Car Cover Sales ────→
           │ 90D  60D  30D  15D  7D│ Final SKU          90D  60D  ...
```

> Final SKU는 Total SKU에서 `BKGR` → `BKLG`로 치환하여 표시. 수치는 동일.

### Seat Cover

```
Master SKU │ ←── Link Sales/TTM ──→ │ ←── Custom Sales/TTM ──→
           │ 90D  60D  30D  15D  7D  │ Custom SKU  90D  60D  ...
```

Pre Order 모드에서는 Link / Custom / TTM Pre Order 3개 그룹으로 표시.

### Floor Mat

```
Master SKU │ ←── Total Sales ──→
           │ 90D  60D  30D  15D  7D
```

---

## 데이터 흐름

```
각 판매 채널 (Shopify · Amazon · Walmart · eBay)
          │
          ▼
  Supabase — ecommerce_data
  ┌─────────────────────────────────────────────────────────────────┐
  │ vw_sales_order_items_link_new                                   │
  │  • sales_orders + sales_order_items를 기반으로 주문 SKU를       │
  │    Master SKU로 해석                                            │
  │  • Shopify(COVERLAND): fn_extract_master_sku_from_web_sku()로  │
  │    Web SKU → m1/m2/m3 최대 3개 Master SKU 추출 (UNION ALL)     │
  │  • Non-Shopify(Amazon/Walmart/eBay): shiphero_kit_components   │
  │    INNER JOIN으로 kit 구성 SKU 해석                             │
  │  • CL-SC-10-* SKU는 size_chart_dev로 size 코드 정규화          │
  │  • unit_price > 0 필터, Non-Amazon 채널 제외                    │
  ├─────────────────────────────────────────────────────────────────┤
  │ vw_sales_order_items_custom_new                                 │
  │  • Seat Cover Custom SKU 전용 뷰                                │
  │  • Link 뷰와 동일한 주문 소스에서 Custom Master SKU 경로로 해석 │
  │  • velocity_custom_snapshot 에만 사용됨                         │
  └─────────────────────────────────────────────────────────────────┘
          │
          │  [ Sync 버튼 ]  POST /api/velocity/sync
          │  • item_status 필터: delivered / fulfilled / shipped 등
          │  • channel / item_category / order_type CASE 매핑
          │  • SKU remap 3건 정규화
          │  • SUM(quantity) 집계
          │  • 두 테이블 TRUNCATE → 전체 데이터를 500행씩 나눠 upsert
          ▼
  Primary DB — shipcore
  ┌──────────────────────────────────────────────────────┐
  │ velocity_link_snapshot                               │
  │  (order_date, item_category, channel,                │
  │   order_type, link_master_sku, link_qty)             │
  ├──────────────────────────────────────────────────────┤
  │ velocity_custom_snapshot                             │
  │  (order_date, item_category, channel,                │
  │   order_type, custom_master_sku, custom_qty)         │
  └──────────────────────────────────────────────────────┘
          │
          │  GET /api/velocity/data
          │  • 기간별 CASE WHEN SUM 피벗 (최대 5개 컬럼)
          │  • custom_snapshot은 Seat Cover 선택 시에만 조회
          ▼
  Velocity 대시보드
  (기간별 피벗, 검색, 정렬, XLSX 내보내기)
```

---

## Export

| 버튼 | 파일 내용 |
|---|---|
| **Export** | 현재 모드(Sales 또는 TTM 또는 Pre Order) 단일 시트 |
| **Export All** | Sales + TTM + Pre Order 3개 모드를 하나의 파일에 나란히 |

파일명: `velocity_{item}_{channels}_{날짜}.xlsx`

---

## 채널 매핑

| 플랫폼 소스 | 이행 채널 | Velocity 채널명 |
|---|---|---|
| Shopify Coverland | — | Coverland |
| Shopify Icarcover | — | Icarcover |
| Amazon | FBA | Amazon FBA |
| Amazon | Merchant (FBM) | Amazon FBM |
| Walmart | — | Walmart |
| eBay (AutoArmor) | — | Auto_Armor |
| eBay | — | Advance_Parts |

---

## 검증 결과

| 검증 항목 | 결과 |
|---|---|
| velocity_link_snapshot ↔ Supabase 뷰 수치 대조 | ✅ 완전 일치 |
| 검증 채널 | Coverland · Icarcover · Amazon FBA/FBM · Walmart · Auto_Armor · Advance_Parts |
| 검증 카테고리 | Car Cover · Seat Cover · Floor Mat |
| 검증 모드 | sales · ttm · preorder · ttm_preorder 전체 |
| 검증 기준일 | 2026-05-13 |

**미검증**: 채널 raw export 파일 (Shopify Admin, Amazon Seller Central 등) → DB 원본 직접 대조

---

## 관련 파일

| 파일 | 설명 |
|---|---|
| `src/app/velocity/page.tsx` | 메인 페이지, 필터 UI |
| `src/components/velocity/velocity-table-columns.tsx` | 테이블 컬럼 정의 |
| `src/lib/velocity-export.ts` | XLSX 내보내기 |
| `src/app/api/velocity/sync/route.ts` | Supabase 동기화 API |
| `src/app/api/velocity/data/route.ts` | 집계 데이터 조회 API |
