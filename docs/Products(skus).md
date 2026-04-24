# Products (SKUs) 페이지 문서

> URL: `http://localhost:3000/skus`  
> 메뉴명: **Products**  
> 작성일: 2026-04-24

---

## 1. 개요

Products 페이지는 상품(SKU) 카탈로그를 관리하는 핵심 화면입니다.  
여러 쇼핑몰 플랫폼(Shopify, Amazon, eBay, Walmart)에서 연동된 웹 SKU들을 **마스터 SKU 기준으로 집계**하여 하나의 상품 단위로 표시합니다.

---

## 2. 소스 파일 구조

```
페이지
└── src/app/skus/page.tsx                          # 메인 목록 페이지
└── src/app/skus/[id]/page.tsx                     # 상품 상세 페이지

API 라우트
└── src/app/api/skus/route.ts                      # GET(목록), POST(생성)
└── src/app/api/skus/[id]/route.ts                 # GET(단건), PATCH(수정), DELETE(삭제)
└── src/app/api/skus/bulk/route.ts                 # DELETE(일괄 삭제)
└── src/app/api/skus/backfill-master/route.ts      # 마스터 SKU 일괄 채우기

컴포넌트
└── src/components/sku/sku-table-columns.tsx       # 테이블 컬럼 정의
└── src/components/sku/sku-form-dialog.tsx         # 상품 생성/수정 다이얼로그
└── src/components/sku/bulk-actions-bar.tsx        # 다중 선택 액션 바
└── src/components/sku/master-sku-backfill-banner.tsx  # 마스터 SKU 백필 배너
```

---

## 3. 기능 설명

### 3-1. 목록 화면 (`/skus`)

| 기능 | 설명 |
|------|------|
| **마스터 SKU 기준 집계** | 동일한 `masterSkuCode`를 가진 웹 SKU 변형들을 하나의 행으로 표시 |
| **검색** | Master SKU 코드, 웹 SKU 코드, 상품명, 설명 기준으로 검색 |
| **카테고리 필터** | 카테고리 값으로 필터링 |
| **정렬** | Master SKU, 이름, 재고(Available), 판매량 기준 오름/내림차순 정렬 |
| **판매 기간 선택** | 테이블 헤더에서 30일 / 60일 / 90일 / 1년 기준 판매량 전환 |
| **페이지네이션** | 기본 50개씩, 서버사이드 페이징 |
| **CSV 내보내기** | 선택된 행 또는 전체 목록을 CSV 파일로 다운로드 |
| **상품 추가** | "Add Product" 버튼으로 새 SKU 생성 다이얼로그 오픈 |
| **다중 선택** | 체크박스로 여러 행 선택 후 일괄 삭제/내보내기 |

#### 테이블 컬럼

| 컬럼 | 내용 |
|------|------|
| (체크박스) | 행 선택 |
| **Master SKU** | 마스터 SKU 코드 (고정 컬럼) |
| **Variants** | 해당 마스터 SKU에 속한 웹 SKU 변형 수 |
| **Name** | 상품명, 재고 부족 시 `Low Stock` 뱃지 표시 |
| **Category** | 카테고리 |
| **Available** | 가용 재고 / 재주문 기준, 하단에 On Hand·Reserved·Backorder 요약 |
| **Price** | 소비자가 (Retail Price) |
| **Sales** | 선택 기간 내 판매 수량 합계 |
| (액션 메뉴) | Master SKU 클립보드 복사, 상세 보기 |

---

### 3-2. 상품 상세 화면 (`/skus/[id]`)

| 기능 | 설명 |
|------|------|
| **통계 카드** | Available / On Hand / Backorder / 소비자가 / 판매 건수 |
| **상품 기본정보** | Master SKU, 카테고리, 재고 요약 (OH/AV/RSV/BO) |
| **창고별 재고** | `InventoryBalance` 테이블의 위치별 재고 상세 (Available, On Hand, Reserved, Backorder, Inbound) |
| **판매 히스토리 차트** | 기간 선택(30일/60일/90일/1년/전체)에 따른 일별 판매 차트 |
| **Web SKUs** | 동일 masterSkuCode를 가진 웹 SKU 변형 목록 (접기/펼치기) |
| **수정** | Edit 버튼 → SKUFormDialog (PATCH 요청) |
| **삭제** | Delete 버튼 → 확인 다이얼로그 후 DELETE 요청 |

---

### 3-3. 상품 생성/수정 다이얼로그 (`SKUFormDialog`)

입력 필드: SKU Code, Name, Description, Category, On Hand(재고), Reorder Point(재주문 기준), Unit Cost(원가), Retail Price(소비자가)

- **생성**: `POST /api/skus`
- **수정**: `PATCH /api/skus/[id]`

---

### 3-4. 일괄 삭제 (`BulkActionsBar`)

행을 1개 이상 선택하면 화면 상단에 액션 바가 표시됩니다.

- **Export**: 선택된 행을 CSV로 내보내기
- **Delete**: `DELETE /api/skus/bulk` 호출, 최대 100개까지 한 번에 삭제
  - 커스텀 배리언트(자식 SKU)가 있는 경우 삭제 불가
  - 삭제 전 확인 다이얼로그 표시

---

## 4. 연결 DB 테이블

모든 데이터는 **내부 PostgreSQL (`shipcore` 스키마, Prisma 관리)** 에서 읽고 씁니다.

### 4-1. 핵심 테이블

#### `shipcore.sku` — 상품 마스터

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | String (cuid) | 내부 고유 ID |
| `skuCode` | String (unique) | 웹/Shopify 변형 SKU 코드 |
| `masterSkuCode` | String? | 마스터 SKU (외부 Supabase 함수로 파싱) |
| `name` | String | 상품명 |
| `description` | String? | 상품 설명 |
| `category` | String? | 카테고리 |
| `currentStock` | Int | 레거시 재고 필드 (UI 호환용) |
| `reorderPoint` | Int? | 재주문 기준 수량 |
| `isCustomVariant` | Boolean | 커스텀 배리언트 여부 |
| `parentSKUId` | String? | 부모 SKU ID (배리언트 계층) |
| `unitCost` | Decimal? | 원가 |
| `retailPrice` | Decimal? | 소비자가 |
| `shopifyProductId` | String? | Shopify 연동 ID |
| `amazonASIN` | String? | Amazon 연동 ID |
| `walmartItemId` | String? | Walmart 연동 ID |
| `ebayItemId` | String? | eBay 연동 ID |
| `createdAt` / `updatedAt` | DateTime | 생성/수정 시각 |

> 인덱스: `skuCode`, `masterSkuCode`, `parentSKUId`, `category`, `isCustomVariant`

---

#### `shipcore.inventorybalance` — 창고별 재고 잔량

목록 페이지의 **Available / On Hand / Reserved / Backorder / Inbound** 수치의 실제 출처입니다.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `skuId` | String (FK → sku) | SKU 참조 |
| `locationId` | String (FK → inventorylocation) | 창고 위치 참조 |
| `onHandQty` | Int | 실재고 수량 |
| `reservedQty` | Int | 예약된 수량 |
| `allocatedQty` | Int | 할당된 수량 |
| `backorderQty` | Int | 백오더 수량 |
| `inboundQty` | Int | 입고 예정 수량 |
| `availableQty` | Int | 가용 수량 (`onHand - reserved - allocated`) |

> 목록 페이지에서는 동일 masterSkuCode에 속한 모든 SKU의 inventorybalance를 합산하여 표시합니다.

---

#### `shipcore.inventorylocation` — 창고/위치 마스터

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | String | 위치 ID |
| `code` | String (unique) | 위치 코드 (예: `DEFAULT`) |
| `name` | String | 위치 이름 |
| `isDefault` | Boolean | 기본 창고 여부 |
| `isActive` | Boolean | 활성 여부 |

---

#### `shipcore.salesrecord` — 판매 기록

목록의 **Sales 컬럼** 및 상세의 **판매 히스토리 차트** 데이터 출처입니다.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `skuId` | String (FK → sku) | SKU 참조 |
| `masterSkuCode` | String? | 집계용 마스터 SKU |
| `platform` | String | shopify, walmart, ebay, manual |
| `orderId` | String | 주문 ID |
| `saleDate` | DateTime | 판매일 |
| `quantity` | Int | 판매 수량 |
| `unitPrice` | Decimal | 단가 |
| `totalAmount` | Decimal | 총액 |
| `fulfilled` | Boolean | 이행 여부 |

> 목록 페이지에서는 `masterSkuCode` 기준으로 `groupBy` + `_sum(quantity)` 집계합니다.

---

### 4-2. 연관 테이블 (간접 연결)

| 테이블 | 연결 방식 | 용도 |
|--------|-----------|------|
| `skucollectionmember` | `skuId` FK | SKU가 속한 컬렉션 정보 (상세 페이지에서 조회) |
| `inventorysnapshot` | `skuId` FK | 재고 스냅샷 이력 (삭제 시 cascade 처리) |
| `trenddata` | `skuId` FK | 트렌드 분석 데이터 (삭제 시 cascade 처리) |
| `poitem` | `skuId` FK | 구매발주 라인 아이템 |

---

## 5. API 요약

| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| `GET` | `/api/skus` | 목록 조회 (masterSkuCode 기준 집계, 페이징/정렬/필터 지원) |
| `POST` | `/api/skus` | 상품 생성 (기본 창고에 InventoryBalance 자동 생성) |
| `GET` | `/api/skus/[id]` | 단건 조회 (Redis 캐시 적용, 창고별 재고 포함) |
| `PATCH` | `/api/skus/[id]` | 상품 수정 (재고 변경 시 InventoryBalance upsert) |
| `DELETE` | `/api/skus/[id]` | 단건 삭제 (커스텀 배리언트 있으면 삭제 불가) |
| `DELETE` | `/api/skus/bulk` | 일괄 삭제 (최대 100개, 트랜잭션으로 처리) |

---

## 6. 캐시 전략

- **단건 조회** (`GET /api/skus/[id]`): Redis 캐시 적용. 캐시 미스 시 DB 조회 후 저장.
- **수정/삭제** 시: 해당 SKU 캐시 및 대시보드 캐시(`dashboard:analytics`) 무효화.
- **생성** 시: 대시보드 캐시 무효화 (총 상품 수에 영향).

---

## 7. 재고 필드 관계 정리

```
SKU.currentStock          → 레거시 필드 (UI 호환용, 실제 연산에 사용하지 않음)

InventoryBalance (창고별)
  onHandQty               → 실재고
  reservedQty             → 예약됨 (주문 접수 후 출고 전)
  allocatedQty            → 할당됨
  backorderQty            → 재고 없이 접수된 주문
  inboundQty              → 입고 예정
  availableQty            → 가용 재고 = onHand - reserved - allocated

목록/상세에 표시되는 수치 = 해당 masterSkuCode의 모든 SKU 잔량 합산
```
