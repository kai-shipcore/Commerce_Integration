# Sales 페이지 문서

> URL: `http://localhost:3000/sales`  
> 메뉴명: **Demand Signals**  
> 작성일: 2026-04-24

---

## 1. 개요

Sales 페이지는 여러 플랫폼(Shopify, Walmart, eBay, Manual)에서 발생한 **판매 기록을 추적·관리**하는 화면입니다.  
수동 단건 입력과 CSV 일괄 가져오기를 모두 지원하며, 플랫폼·스토어 기준으로 필터링하여 판매 이행 현황을 조회할 수 있습니다.

---

## 2. 소스 파일 구조

```
페이지
└── src/app/sales/page.tsx                                   # 메인 페이지

API 라우트
└── src/app/api/sales/route.ts                               # GET(목록/집계), POST(생성)
└── src/app/api/sales/import/route.ts                        # POST(CSV 가져오기), GET(템플릿 다운로드)

컴포넌트
└── src/components/sales/sales-form-dialog.tsx               # 수동 판매 입력 다이얼로그
└── src/components/sales/import-dialog.tsx                   # CSV 가져오기 다이얼로그

라이브러리
└── src/lib/integrations/core/persist-sales.ts               # 플랫폼 연동 시 판매 저장 헬퍼
```

---

## 3. 기능 설명

### 3-1. 필터 컨트롤

| 필터 | 설명 |
|------|------|
| **Platform** | All Platforms / Shopify / Walmart / eBay / Manual 선택 |
| **Store** | 선택된 플랫폼에 속한 연동 스토어 목록 동적 표시 (`/api/integrations` 조회) |

---

### 3-2. 판매 내역 테이블

최근 판매 기록을 표시합니다 (기본 최대 50건).

| 컬럼 | 내용 |
|------|------|
| **Date** | 판매일 (달력 아이콘 표시) |
| **SKU** | 판매된 SKU 코드 |
| **Platform** | 판매 채널 (shopify, walmart, ebay, manual) |
| **Store** | 연동 스토어명 |
| **Order ID** | 주문 참조 번호 |
| **Quantity** | 판매 수량 |
| **Amount** | 총 판매 금액 |
| **Status** | 이행 여부 (Fulfilled / Pending) |

- 데이터 로딩 중 스피너 표시
- 판매 기록 없을 시 빈 상태 메시지 표시

---

### 3-3. 수동 판매 입력 다이얼로그 (`SalesFormDialog`)

**"Add Sale"** 버튼 클릭 시 오픈. 단건 판매 기록을 수동으로 생성합니다.

| 필드 | 설명 |
|------|------|
| **SKU** | `/api/skus` 에서 조회한 SKU 선택 |
| **Platform** | 판매 채널 선택 |
| **Order ID** | 주문 참조 번호 |
| **Sale Date** | 판매일 |
| **Quantity** | 판매 수량 |
| **Unit Price** | 단가 (입력 시 총액 자동 계산) |

- 제출: `POST /api/sales` (단건)

---

### 3-4. CSV 가져오기 다이얼로그 (`ImportDialog`)

**"Import CSV"** 버튼 클릭 시 오픈. 4단계 프로세스로 진행됩니다.

| 단계 | 내용 |
|------|------|
| **Upload** | 드래그&드롭 또는 파일 선택으로 CSV 업로드 |
| **Preview** | 첫 50행 미리보기 테이블 표시 |
| **Importing** | 서버 처리 중 진행 표시 |
| **Results** | 가져오기 결과 요약 + 행별 오류 리포트 (최대 100개 표시) |

**CSV 필수 컬럼**: `sku_code`, `sale_date`, `quantity`, `unit_price`

**CSV 선택 컬럼**: `platform`, `order_id`, `order_type`, `fulfilled`, `fulfilled_date`, `notes`

- 최대 **5,000행** 처리 가능 (500행 단위 배치 삽입)
- 누락된 SKU는 가져오기 중 **자동 생성**
- 중복 레코드는 건너뜀
- 성공 시 대시보드 분석 캐시 무효화
- 템플릿 파일 다운로드: `GET /api/sales/import`

---

## 4. 연결 DB 테이블

모든 데이터는 **내부 PostgreSQL (`shipcore` 스키마, Prisma 관리)** 에서 읽고 씁니다.

#### `shipcore.salesrecord` — 판매 기록

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | String (cuid) | 내부 고유 ID |
| `skuId` | String (FK → sku) | SKU 참조 |
| `integrationId` | String? (FK → integration) | 플랫폼 연동 참조 (Shopify, Walmart, eBay, Amazon) |
| `platform` | String | 판매 채널 (shopify, walmart, ebay, manual) |
| `orderId` | String? | 주문 참조 번호 |
| `orderType` | String | actual_sale 또는 pre_order (기본값: actual_sale) |
| `saleDate` | DateTime | 판매일 |
| `quantity` | Int | 판매 수량 |
| `unitPrice` | Decimal (10,2) | 단가 |
| `totalAmount` | Decimal (12,2) | 총 판매 금액 |
| `masterSkuCode` | String? | 집계용 마스터 SKU 코드 |
| `fulfilled` | Boolean | 이행 여부 (기본값: false) |
| `fulfilledDate` | DateTime? | 이행 완료일 |
| `notes` | String? | 메모 |
| `createdAt` | DateTime | 레코드 생성 시각 |

> 인덱스: `(skuId, saleDate)`, `saleDate`, `platform`, `orderType`, `masterSkuCode`, `integrationId`

---

## 5. API 요약

| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| `GET` | `/api/sales` | 판매 기록 목록 조회 (필터/페이징/집계 지원) |
| `POST` | `/api/sales` | 단건 또는 배열 일괄 생성 |
| `POST` | `/api/sales/import` | CSV 행 일괄 처리 (최대 5,000행) |
| `GET` | `/api/sales/import` | CSV 템플릿 파일 다운로드 |
| `GET` | `/api/integrations` | 스토어 필터용 연동 목록 조회 |

### GET `/api/sales` 파라미터

| 파라미터 | 기본값 | 설명 |
|----------|--------|------|
| `page` | `1` | 페이지 번호 |
| `limit` | `100` | 페이지당 행 수 |
| `platform` | - | 플랫폼 필터 (shopify, walmart, ebay, manual) |
| `integrationId` | - | 특정 연동 스토어 필터 |
| `skuId` | - | 특정 SKU ID 필터 |
| `masterSkuCode` | - | 마스터 SKU 코드 필터 |
| `orderType` | - | actual_sale 또는 pre_order |
| `startDate` | - | 조회 시작일 |
| `endDate` | - | 조회 종료일 |
| `groupBy` | - | day / week / month 기준 집계 (분석용) |

### POST `/api/sales` 요청 형식

- **단건**: `{ skuId, platform, saleDate, quantity, unitPrice, ... }` — Zod 스키마로 유효성 검사
- **배열**: 동일 객체의 배열 — 중복 레코드 자동 건너뜀, 트랜잭션 처리
