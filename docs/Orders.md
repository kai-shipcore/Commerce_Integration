# Orders 페이지 문서

> URL: `http://localhost:3000/orders`  
> 메뉴명: **Orders**  
> 작성일: 2026-04-24

---

## 1. 개요

Orders 페이지는 외부 채널(Shopify, Amazon, eBay, Walmart 등)에서 수집된 **판매 주문 피드**를 조회하는 화면입니다.  
데이터는 외부 Supabase DB(`ecommerce_data` 스키마)의 주문 테이블을 직접 읽어 표시하며, **읽기 전용**으로 운영됩니다.  
날짜 범위·플랫폼 필터를 조합하여 주문을 검색하고, 행 클릭 시 라인 아이템 상세를 다이얼로그로 확인할 수 있습니다.

---

## 2. 소스 파일 구조

```
페이지
└── src/app/orders/page.tsx                              # 메인 페이지

API 라우트
└── src/app/api/orders/route.ts                          # GET (주문 목록 조회)
└── src/app/api/orders/[id]/route.ts                     # GET (주문 단건 상세 조회)

컴포넌트
└── src/components/orders/order-table-columns.tsx        # 테이블 컬럼 정의
└── src/components/orders/order-detail-dialog.tsx        # 주문 상세 다이얼로그

DB 헬퍼
└── src/lib/db/supabase-lookup.ts                        # getSalesOrders() 함수
                                                         # getSalesOrderDetail() 함수
```

---

## 3. 기능 설명

### 3-1. 상단 요약 카드

| 카드 | 내용 |
|------|------|
| **Total Orders** | 현재 필터 조건에 해당하는 주문 건수 |
| **Revenue** | 현재 필터 결과의 주문 총액(Gross) 합계 |
| **Units** | 현재 필터 결과의 라인 아이템 순수량(`net_quantity`) 합계 |
| **Platforms** | 현재 필터 결과에 존재하는 고유 플랫폼 소스 수 |

> 요약 수치는 날짜/플랫폼 필터에 연동되어 실시간으로 갱신됩니다.

---

### 3-2. 날짜 범위 필터

헤더 우측의 **날짜 프리셋 드롭다운**으로 조회 기간을 선택합니다.

| 옵션 | 범위 |
|------|------|
| **Today** | 오늘 00:00 ~ 23:59 |
| **Yesterday** | 어제 00:00 ~ 23:59 |
| **Last 7 days** | 오늘 포함 최근 7일 |
| **Last 30 days** | 오늘 포함 최근 30일 |
| **Custom** | 사용자 지정 날짜 범위 (DateRangePicker 표시) |

기본값은 **Today**입니다.

---

### 3-3. 플랫폼 필터

**Platform 드롭다운**으로 특정 플랫폼 소스만 필터링합니다.  
목록은 외부 DB `ecommerce_data.sales_orders` 테이블의 `platform_source` 고유값을 동적으로 조회하여 표시합니다.

---

### 3-4. 검색

Order Number, External Order ID, Buyer Email(`buyer_email` 또는 `customer_email`) 기준으로 부분 검색(ILIKE)을 지원합니다.

---

### 3-5. 테이블 컬럼

| 컬럼 | 내용 |
|------|------|
| **Order** | 주문 번호(`orderNumber`) + 외부 주문 ID(`externalOrderId`) |
| **Platform** | 플랫폼 소스 (Badge 표시) |
| **Order Time** | 주문 일시 |
| **Order Status** | 주문 처리 상태 (Badge 표시) |
| **Financial** | 결제 상태 |
| **Lines** | 라인 아이템 수 |
| **Units** | 순수량 합계 (`net_quantity`) |
| **Total** | 주문 총액 (통화 포맷) |
| **Sales Channel** | 판매 채널 |
| **Country** | 배송 국가 |
| **Buyer** | 구매자 이메일 |

정렬 가능 컬럼: Order Time, Order Number, Platform, Order Status, Financial, Lines, Units, Total, Sales Channel, Country, Buyer

---

### 3-6. 주문 상세 다이얼로그 (`OrderDetailDialog`)

테이블 행 클릭 시 `GET /api/orders/[id]` 를 호출하여 상세 정보를 다이얼로그로 표시합니다.

**상단 요약 카드 (4개)**

| 카드 | 내용 |
|------|------|
| **Platform** | 플랫폼 소스 + 외부 주문 ID |
| **Order Status** | 주문 상태 + 주문 일시 |
| **Financial** | 결제 상태 + 주문 총액 |
| **Buyer** | 구매자 이메일 + 배송 국가 |

**Order Context 섹션**

| 항목 | 설명 |
|------|------|
| Sales channel | 판매 채널 |
| Fulfillment channel | 풀필먼트 채널 |

**Line Items 섹션**

라인 아이템별로 상품명, SKU, 상태 Badge, 수량 정보(Qty / Net / Fulfilled / Refunded / Unit Price)를 카드 형태로 표시합니다.

---

### 3-7. CSV 내보내기

현재 필터·정렬 조건을 유지한 채 전체 데이터를 CSV로 다운로드합니다.  
(`exportAll=true` 파라미터로 최대 100,000건까지 한 번에 조회)

내보내기 컬럼:  
`Order ID`, `Platform Source`, `Order Number`, `External Order ID`, `Order Date`, `Order Status`, `Financial Status`, `Sales Channel`, `Buyer Email`, `Shipping Country`, `Line Count`, `Unit Count`, `Currency`, `Total Price`

파일명: `orders-export-YYYY-MM-DD.csv`

---

### 3-8. 연결 장애 처리

외부 DB 연결이 불가능한 경우(`isLookupConnectionError`) 500 에러 대신 빈 데이터 + `degraded: true` 응답을 반환하여 페이지가 정상적으로 렌더링되도록 처리합니다.

---

## 4. 연결 DB 테이블

Orders 페이지는 **외부 Supabase PostgreSQL** 을 사용합니다.  
Prisma가 아닌 별도의 `pg.Pool` 커넥션으로 직접 SQL을 실행합니다.

### 4-1. 주 조회 테이블

#### `ecommerce_data.sales_orders` — 주문 헤더

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | int | 내부 고유 ID |
| `platform_source` | text | 플랫폼 소스 (예: shopify, amazon) |
| `external_order_id` | text | 외부 시스템 주문 ID |
| `order_number` | text | 주문 번호 |
| `order_date` | timestamp | 주문 일시 |
| `order_status` | text | 주문 처리 상태 |
| `financial_status` | text | 결제 상태 |
| `total_price` | numeric | 주문 총액 |
| `currency` | text | 통화 코드 |
| `buyer_email` | text | 구매자 이메일 |
| `customer_email` | text | 고객 이메일 (buyer_email 없을 때 fallback) |
| `shipping_country` | text | 배송 국가 |
| `sales_channel` | text | 판매 채널 |
| `fulfillment_channel` | text | 풀필먼트 채널 (상세 조회 시 사용) |

---

#### `ecommerce_data.sales_order_items` — 주문 라인 아이템

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | int | 라인 아이템 고유 ID |
| `order_id` | int | 주문 헤더 FK |
| `external_line_item_id` | text | 외부 라인 아이템 ID |
| `sku` | text | SKU 코드 |
| `product_name` | text | 상품명 |
| `quantity` | int | 주문 수량 |
| `net_quantity` | int | 순수량 (반품·취소 제외) |
| `fulfilled_quantity` | int | 출고 완료 수량 |
| `refunded_quantity` | int | 환불 수량 |
| `unit_price` | numeric | 단가 |
| `shipping_price` | numeric | 배송비 |
| `item_tax` | numeric | 세금 |
| `item_status` | text | 라인 아이템 상태 |
| `fulfillment_status` | text | 풀필먼트 상태 |
| `currency` | text | 통화 코드 |

---

### 4-2. 요약 집계용 뷰 테이블

#### `shipcore.sc_sales_orders` — 주문 요약 집계용

상단 요약 카드(Total Orders, Revenue, Units, Platforms)의 합산 쿼리에만 사용됩니다.  
목록 조회 쿼리는 `ecommerce_data.sales_orders`를 직접 사용합니다.

| 집계 항목 | 출처 컬럼 |
|-----------|-----------|
| Total Orders | `COUNT(DISTINCT so.id)` |
| Revenue | `SUM(so.total_price)` |
| Units | `SUM(sales_order_items.net_quantity)` |
| Platforms | `COUNT(DISTINCT so.platform_source)` |

---

## 5. API 요약

| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| `GET` | `/api/orders` | 주문 목록 조회 (날짜/플랫폼/검색/페이징/정렬 지원) |
| `GET` | `/api/orders/[id]` | 주문 단건 상세 조회 (라인 아이템 포함) |

### GET `/api/orders` 파라미터

| 파라미터 | 기본값 | 설명 |
|----------|--------|------|
| `page` | `1` | 페이지 번호 |
| `limit` | `20` | 페이지당 행 수 (최대 200, exportAll 시 최대 100,000) |
| `exportAll` | `false` | 전체 내보내기 여부 |
| `search` | - | Order Number, External Order ID, Buyer Email 검색 |
| `platformSource` | `all` | 특정 플랫폼 소스 필터 |
| `startDate` | - | 조회 시작일 (`yyyy-MM-dd`) |
| `endDate` | - | 조회 종료일 (`yyyy-MM-dd`, 해당 일 23:59까지 포함) |
| `sortBy` | `orderDate` | `orderDate`, `orderNumber`, `platformSource`, `orderStatus`, `financialStatus`, `totalPrice`, `lineCount`, `unitCount`, `salesChannel`, `shippingCountry`, `buyerEmail` |
| `sortOrder` | `desc` | `asc` or `desc` |

### GET `/api/orders/[id]` 파라미터

| 파라미터 | 설명 |
|----------|------|
| `id` | 주문 내부 ID (양의 정수) — 유효하지 않으면 400, 존재하지 않으면 404 반환 |

---

## 6. 다른 페이지 주문 데이터와의 차이점

| 구분 | Orders 페이지 | Products 페이지 (salesrecord) |
|------|--------------|-------------------------------|
| **데이터 소스** | 외부 Supabase (`ecommerce_data.sales_orders`) | 내부 Prisma (`shipcore.salesrecord`) |
| **DB 연결** | 별도 `pg.Pool` (supabase-lookup) | Prisma Client |
| **목적** | 주문 헤더 + 라인 아이템 원문 조회 | Master SKU 기준 판매량 집계 |
| **쓰기 가능** | X (읽기 전용) | X (읽기 전용, 연동으로만 생성) |
| **라인 아이템** | O (상세 다이얼로그에서 확인) | X (수량 집계만 표시) |
| **날짜 필터** | O (날짜 프리셋 + Custom Range) | O (30일/60일/90일/1년 프리셋) |
