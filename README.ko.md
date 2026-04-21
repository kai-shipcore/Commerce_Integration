# Commerce Integration

Commerce Integration은 SKU 마스터 데이터, 과거 판매 데이터, 외부 재고 스냅샷, 컬렉션, 사용자 권한 및 마켓플레이스 연동을 단일 Next.js 애플리케이션에서 관리하기 위한 내부 운영 워크스페이스입니다.

이 프로젝트는 두 가지 데이터 축으로 동작합니다.
- Prisma를 통해 메인 PostgreSQL에 저장되는 내부 운영 데이터
- 별도 외부 데이터베이스에서 조회하는 마스터 SKU 해석, 재고 스냅샷, 주문 피드 데이터

## 프로젝트 개요

현재 애플리케이션은 예측(Forecasting)보다는 일상적인 커머스 운영에 집중하고 있습니다. 구현된 주요 기능은 다음과 같습니다.

- SKU 및 마스터 SKU 매핑을 위한 상품 카탈로그 관리
- 과거 판매 이력 관리와 수동 판매 입력/가져오기
- 외부 조회 DB 기반의 재고 스냅샷 브라우징 (창고별/상품별 그룹화)
- 외부 주문 피드 조회 (필터링 및 상세 드릴다운 지원)
- 과거 판매 및 재고 데이터를 활용한 대시보드 및 분석
- SKU 컬렉션 관리
- 마켓플레이스 자격 증명 관리 및 Shopify 판매 동기화
- 인증, 역할 기반 접근 제어, 메뉴 노출 제어
- OpenAPI 규격 기반의 Swagger API 문서 제공

## 주요 화면

### Command Center
- 경로: `/dashboard` (구 Dashboard)
- SKU 수, 컬렉션 수, 활성 연동, 저재고 항목 등 핵심 지표 제공
- 판매 추세, 상위 판매 SKU, 최근 활동 표시
- Redis가 설정되어 있으면 일부 응답을 캐시함

### Products
- 경로: `/skus`
- SKU 생성, 수정, 삭제, 검색, 정렬, 페이지네이션, CSV 내보내기
- 마스터 SKU, 카테고리, 원가, 판매가, 요약 재고 표시
- 기간별 판매 요약 제공
- 마스터 SKU 백필 배너 포함

### Product Detail
- 경로: `/skus/[id]`
- 상품 요약, 로케이션별 재고 잔액, 판매 이력, 관련 웹 SKU 표시

### Inventory
- 경로: `/inventory`
- 외부 조회 DB의 재고 스냅샷을 읽어옴
- 창고 기준 필터, 상품 기준 그룹화, 정렬, 페이지네이션, CSV 내보내기 지원
- on hand, allocated, available, backorder, warehouse, created timestamp 노출

### Orders
- 경로: `/orders`
- 외부 조회 DB의 주문 헤더와 주문 아이템을 조회
- 날짜 프리셋, 사용자 지정 기간, 플랫폼 필터, 검색, 정렬, 페이지네이션, CSV 내보내기, 상세 다이얼로그 지원

### Demand Signals / Sales
- 경로: `/sales` (구 Sales)
- 내부 `SalesRecord` 목록 조회
- 플랫폼 및 연동 스토어 기준 필터 지원
- 수동 입력과 CSV import 지원

### Collections
- 경로: `/collections`, `/collections/[id]`
- SKU를 운영 목적에 맞게 묶는 컬렉션 생성/수정/관리
- 설명, 핀 고정, 색상 코드 지원

### Analytics
- 경로: `/analytics`
- 개요, 추세, 재고 상태 탭 제공
- 현재는 과거 판매와 재고 중심 분석 화면으로 구성됨

### Marketplace APIs
- 경로: `/settings/integrations`
- Shopify, Amazon, eBay, Walmart 자격 증명 저장
- 연결 상태 확인 가능
- 실제 판매 동기화는 현재 Shopify만 구현됨
- Amazon/eBay/Walmart는 자격 증명 저장과 연결 관리 중심

### User Access
- 경로: `/settings/users`
- 관리자 전용
- 사용자 역할 변경과 메뉴 노출 권한 관리

### API 문서
- 경로: `/api-docs`
- `/api/openapi`에서 생성한 문서를 Swagger UI로 표시

## 기술 스택

- Next.js 16 App Router
- React 19
- TypeScript
- Prisma + PostgreSQL
- NextAuth
- Tailwind CSS 4
- Radix UI
- TanStack Table 및 TanStack Query
- Recharts
- Upstash Redis
- Inngest

## 데이터 구조

### 메인 운영 DB

내부 PostgreSQL에는 아래와 같은 운영 엔티티가 저장됩니다.

- `SKU`
- `SalesRecord`
- `InventoryBalance`
- `InventorySnapshot`
- `InventoryLocation`
- `InventoryTransaction`
- `SKUCollection`, `SKUCollectionMember`
- `PlatformIntegration`
- `User`, `Account`, `Session`

이 데이터는 CRUD, 인증, 대시보드, 연동 상태 관리에 사용됩니다.

### 외부 조회 DB

별도 PostgreSQL 연결은 아래 용도로 사용됩니다.

- `size_chart.fn_extract_master_sku_from_web_sku`를 통한 마스터 SKU 해석
- `ecommerce_data.coverland_inventory` 재고 스냅샷 조회
- `ecommerce_data.sales_orders`, `ecommerce_data.sales_order_items` 주문 피드 조회

즉, 운영 데이터와 외부 조회/리포팅 데이터가 분리되어 있습니다.

### Shopify 동기화 흐름

현재 실제 동기화가 구현된 연동은 Shopify입니다.

1. `PlatformIntegration`에 자격 증명 저장
2. Shopify Admin API에서 주문 조회
3. 없는 SKU는 자동 생성
4. 외부 조회 DB를 통해 마스터 SKU 매핑
5. 내부 `SalesRecord`에 정규화된 판매 이력 저장
6. 재시작 가능한 전체 동기화를 위해 커서와 상태 저장

### 마켓플레이스 연동 아키텍처

마켓플레이스 연동 코드는 이제 공통 `core` 레이어와 플랫폼별 adapter 폴더로 분리되어 있습니다. 목적은 Shopify, Amazon, eBay, Walmart 구현을 서로 다른 팀원이 진행하더라도 같은 파일을 반복해서 건드리지 않게 하는 것입니다.

- `src/lib/integrations/core/*`
  adapter 계약, registry, connection check, sync 실행, SKU 해석, 판매 이력 저장 같은 공통 워크플로우를 담당합니다.
- `src/lib/integrations/shopify/*`
  Shopify 전용 config 검증, API client, payload mapping, adapter 로직을 담당합니다.
- `src/lib/integrations/amazon/*`
  Amazon 전용 adapter 스캐폴딩과 config 경계를 담당합니다.
- `src/lib/integrations/ebay/*`
  eBay 전용 adapter 스캐폴딩과 config 경계를 담당합니다.
- `src/lib/integrations/walmart/*`
  Walmart 전용 adapter 스캐폴딩과 config 경계를 담당합니다.

현재 팀 작업 경계는 다음과 같습니다.
- 공통 연동 흐름 수정은 `core/*` 와 integration API route에서 처리합니다.
- 플랫폼별 인증, API 호출, 응답 매핑 변경은 각 플랫폼 폴더 안에서만 처리하는 것을 기준으로 합니다.
- `src/app/api/integrations/*` 와 `src/lib/inngest/functions.ts` 는 플랫폼별 분기 대신 adapter registry를 통해 연동을 호출합니다.

## 폴더 구조

```text
.
├─ src/
│  ├─ app/
│  │  ├─ api/                  # 앱 API 라우트
│  │  ├─ analytics/            # 분석 페이지
│  │  ├─ auth/                 # 로그인/회원가입/오류 페이지
│  │  ├─ collections/          # 컬렉션 목록/상세
│  │  ├─ dashboard/            # 대시보드
│  │  ├─ inventory/            # 재고 화면
│  │  ├─ orders/               # 주문 화면
│  │  ├─ sales/                # 판매 화면
│  │  ├─ settings/             # 연동/메뉴/권한 설정
│  │  └─ skus/                 # 상품 목록/상세
│  ├─ components/
│  │  ├─ analytics/            # 분석 위젯
│  │  ├─ auth/                 # 인증 UI
│  │  ├─ collection/           # 컬렉션 관련 다이얼로그
│  │  ├─ dashboard/            # 대시보드 위젯
│  │  ├─ inventory/            # 재고 테이블 컬럼
│  │  ├─ layout/               # 앱 레이아웃, 메뉴, 유저 메뉴
│  │  ├─ marketplaces/         # 마켓플레이스 아이콘
│  │  ├─ orders/               # 주문 테이블/상세
│  │  ├─ sales/                # 판매 입력/가져오기
│  │  ├─ sku/                  # SKU 폼, 컬럼, 벌크 액션
│  │  └─ ui/                   # 공용 UI 컴포넌트
│  └─ lib/
│     ├─ analytics/            # 분석 헬퍼
│     ├─ auth/                 # 비밀번호 관련 유틸
│     ├─ db/                   # Prisma 및 조회 DB 접근
│     ├─ inngest/              # 백그라운드 작업
│     ├─ integrations/
│     │  ├─ core/              # 공통 adapter 계약, sync runner, 저장 로직
│     │  ├─ shopify/           # Shopify adapter, client, mapper, config
│     │  ├─ amazon/            # Amazon adapter 스캐폴딩
│     │  ├─ ebay/              # eBay adapter 스캐폴딩
│     │  └─ walmart/           # Walmart adapter 스캐폴딩
│     ├─ openapi.ts            # OpenAPI 문서 생성
│     └─ redis.ts              # 캐시 헬퍼
├─ prisma/
│  ├─ migrations/              # 마이그레이션
│  ├─ schema.prisma            # 데이터 모델
│  └─ seed.ts                  # 시드 스크립트
├─ scripts/
│  ├─ start-dev.cmd            # 개발 실행 보조 스크립트
│  ├─ check-sku-sales.ts       # 로컬 점검 스크립트
│  └─ test-redis.ts            # Redis 테스트 스크립트
├─ public/                     # 정적 자산
├─ start-dev.cmd               # 루트 실행 스크립트
└─ README.ko.md
```

## 화면 가이드

현재 저장소에는 스크린샷 이미지 파일이 포함되어 있지 않지만, 온보딩이나 리뷰 용도로 캡처하면 좋은 주요 화면은 아래와 같습니다.

| 화면 | 경로 | 캡처 포인트 |
| --- | --- | --- |
| Command Center | `/dashboard` | KPI 카드, 판매 추세, 상위 판매 SKU, 최근 활동 |
| Products | `/skus` | 마스터 SKU 기준 테이블, 필터, 내보내기, 생성 다이얼로그 |
| Product Detail | `/skus/[id]` | 로케이션별 재고 잔액, 판매 이력 차트 |
| Inventory | `/inventory` | 창고 필터, 상품 그룹 토글, 요약 카드 |
| Orders | `/orders` | 날짜 필터, 플랫폼 필터, 주문 목록, 상세 다이얼로그 |
| Sales | `/sales` | 수동 판매 데이터, import 흐름, 플랫폼 필터 |
| Collections | `/collections` | 컬렉션 카드와 SKU 그룹화 흐름 |
| Marketplace APIs | `/settings/integrations` | 연동 카드, 연결 확인, 동기화 액션 |
| User Access | `/settings/users` | 역할 변경, 사용자별 메뉴 권한 |
| API Docs | `/api-docs` | `/api/openapi` 기반 Swagger UI |

나중에 이미지 파일까지 관리하려면 아래와 같은 경로 구성을 권장합니다.

```text
docs/
  screenshots/
    dashboard.png
    products.png
    inventory.png
    orders.png
    integrations.png
```

## ERD 요약

전체 모델은 `prisma/schema.prisma`에 있고, 핵심 관계만 요약하면 아래와 같습니다.

```text
User
 ├─ Account
 └─ Session

SKU
 ├─ SalesRecord
 ├─ InventoryBalance ── InventoryLocation
 ├─ InventorySnapshot
 ├─ InventoryTransaction ── InventoryLocation
 ├─ SKUCollectionMember ── SKUCollection
 ├─ POItem ── PurchaseOrder
 ├─ TrendData
 └─ SKU (셀프 관계: custom variant)

PlatformIntegration
 └─ SalesRecord

PurchaseOrder
 ├─ POItem ── SKU
 └─ Container
```

### 핵심 엔티티 설명

- `SKU`는 가장 중심이 되는 비즈니스 엔티티이며 웹 SKU와 마스터 SKU 묶음의 기준점 역할을 합니다
- `SalesRecord`는 정규화된 판매 이력을 저장하고 필요하면 `PlatformIntegration`과 연결됩니다
- `InventoryBalance`는 로케이션별 재고 상태를 저장하며, `SKU.currentStock`은 레거시 요약 필드 성격을 가집니다
- `SKUCollection`과 `SKUCollectionMember`는 재사용 가능한 상품 묶음을 구성합니다
- `PlatformIntegration`은 자격 증명, 동기화 커서, 동기화 통계를 보관합니다
- `User`는 역할과 메뉴 노출 설정을 함께 저장합니다
- trend 관련 테이블은 schema에 남아 있지만 현재 핵심 사용자 흐름은 아닙니다

## API 구성

`src/app/api` 아래에 주요 라우트가 있습니다.

- `api/analytics/dashboard`
- `api/auth/[...nextauth]`
- `api/auth/register`
- `api/collections`
- `api/integrations`
- `api/inventory`
- `api/openapi`
- `api/orders`
- `api/sales`
- `api/settings/menu`
- `api/settings/profile`
- `api/skus`
- `api/admin/users`

인터랙티브 문서는 `/api-docs`에서 확인할 수 있습니다.

## API 예시

아래 예시는 현재 라우트 핸들러 기준으로 작성했으며, 로컬 테스트나 프론트 연동 시 바로 참고할 수 있습니다.

### 상품 목록 조회

```http
GET /api/skus?page=1&limit=20&sortBy=masterSkuCode&sortOrder=asc&salesPeriod=30
```

예시 응답:

```json
{
  "success": true,
  "data": [
    {
      "id": "cmabc123",
      "masterSkuCode": "DP-1001",
      "skuCode": "DP-1001",
      "name": "Demand Pilot Sample Product",
      "description": "Example product",
      "category": "Accessories",
      "currentStock": 42,
      "reorderPoint": 10,
      "unitCost": "12.50",
      "retailPrice": "29.99",
      "webSkuCount": 3,
      "inventory": {
        "onHand": 48,
        "reserved": 2,
        "allocated": 4,
        "backorder": 0,
        "inbound": 12,
        "available": 42
      },
      "_count": {
        "salesRecords": 128
      },
      "salesSummary": {
        "totalQuantity": 128,
        "days": 30
      }
    }
  ],
  "periods": {
    "sales": 30
  },
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 120,
    "totalPages": 6
  }
}
```

### 상품 생성

```http
POST /api/skus
Content-Type: application/json
```

```json
{
  "skuCode": "DP-1001-BLK",
  "name": "Demand Pilot Sample Product Black",
  "description": "Black colorway",
  "category": "Accessories",
  "currentStock": 25,
  "reorderPoint": 8,
  "tags": ["sample", "black"],
  "unitCost": 12.5,
  "retailPrice": 29.99
}
```

### 연동 목록 조회

```http
GET /api/integrations
```

예시 응답:

```json
{
  "success": true,
  "data": [
    {
      "id": "cmint123",
      "platform": "shopify",
      "name": "Main Shopify Store",
      "isActive": true,
      "lastSyncAt": "2026-04-18T21:00:00.000Z",
      "lastSyncStatus": "success",
      "lastSyncError": null,
      "totalOrdersSynced": 540,
      "totalRecordsSynced": 1210,
      "createdAt": "2026-04-01T10:00:00.000Z",
      "updatedAt": "2026-04-18T21:00:00.000Z"
    }
  ]
}
```

### Shopify 연동 생성

```http
POST /api/integrations
Content-Type: application/json
```

```json
{
  "platform": "shopify",
  "name": "Main Shopify Store",
  "config": {
    "shopDomain": "mystore.myshopify.com",
    "accessToken": "shpat_xxxxxxxxxxxxx",
    "apiVersion": "2024-01"
  }
}
```

### 재고 스냅샷 조회

```http
GET /api/inventory?page=1&limit=20&groupBy=warehouse&warehouse=all&sortBy=masterSku&sortOrder=asc
```

예시 응답:

```json
{
  "success": true,
  "data": [
    {
      "masterSku": "DP-1001",
      "onHand": 120,
      "allocated": 15,
      "available": 105,
      "backorder": 0,
      "warehouse": "LA",
      "createdAt": "2026-04-18T06:00:00.000Z"
    }
  ],
  "warehouses": ["LA", "NJ"],
  "summary": {
    "totalRows": 350,
    "totalProducts": 180,
    "totalWarehouses": 2,
    "onHand": 8200,
    "allocated": 400,
    "available": 7800,
    "backorder": 65
  },
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 350,
    "totalPages": 18
  }
}
```

### 주문 피드 조회

```http
GET /api/orders?page=1&limit=20&platformSource=all&sortBy=orderDate&sortOrder=desc
```

예시 응답:

```json
{
  "success": true,
  "data": [
    {
      "id": 1024,
      "platformSource": "shopify",
      "externalOrderId": "gid://shopify/Order/123456789",
      "orderNumber": "#1001",
      "orderDate": "2026-04-18T14:30:00.000Z",
      "orderStatus": "paid",
      "totalPrice": 149.99,
      "currency": "USD",
      "financialStatus": "paid",
      "buyerEmail": "buyer@example.com",
      "shippingCountry": "US",
      "salesChannel": "online_store",
      "lineCount": 3,
      "unitCount": 5
    }
  ],
  "summary": {
    "totalOrders": 980,
    "totalRevenue": 182340.55,
    "totalUnits": 4130,
    "totalPlatforms": 3
  },
  "platformSources": ["amazon", "ebay", "shopify"],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 980,
    "totalPages": 49
  }
}
```

## 환경변수

현재 코드 기준으로 중요한 환경변수는 다음과 같습니다.

### 필수
- `DATABASE_URL`
- `NEXTAUTH_SECRET` (NextAuth 암호화 키)
- `NEXTAUTH_URL` (앱의 베이스 URL)

### 선택 사항이지만 실사용에 중요
- `SUPABASE_LOOKUP_DATABASE_URL`
  마스터 SKU 조회, 재고 화면, 주문 화면에 필요
- `UPSTASH_REDIS_REST_URL`: Upstash Redis 연결 URL
- `UPSTASH_REDIS_REST_TOKEN`: Upstash Redis 토큰
  (대시보드 및 판매 조회 캐싱용)
- `GOOGLE_CLIENT_ID`: 구글 OAuth 클라이언트 ID
- `GOOGLE_CLIENT_SECRET`: 구글 OAuth 클라이언트 보안 비밀번호
  구글 로그인 활성화

## 로컬 실행

### 런타임

- 권장 Node 버전: `22.x`
- 이 저장소의 engine 범위: `>=20.9 <24`

### 설치

```bash
npm install
```

### DB 준비

```bash
npx prisma migrate dev
```

필요하면 시드 실행:

```bash
npm run db:seed
```

### 앱 실행

이 프로젝트에서는 아래 방식이 가장 안전합니다.

```bash
start-dev.cmd
```

대안:

```bash
cmd /c npm.cmd run dev
```

루트 실행 스크립트를 권장하는 이유:
- Windows PowerShell에서는 `npm.ps1` 실행 정책에 걸릴 수 있음
- 이 저장소는 Windows 개발 안정성을 위해 로컬 Node 22 경로를 함께 사용하도록 구성됨

### 프로덕션 빌드

```bash
cmd /c npm.cmd run build
cmd /c npm.cmd run start
```

## 현재 제약 및 참고 사항

- Prisma schema에도 예전 `Forecast` 모델은 제거됨
- 다만 추후 확장을 위한 trend 관련 테이블은 schema에 남아 있음
- 실제 마켓플레이스 동기화는 현재 Shopify만 구현됨
- 마켓플레이스 코드는 공통 adapter core 기준으로 재구성되어 플랫폼별 구현 시 팀 간 파일 충돌을 줄이도록 정리됨
- 재고/주문 화면은 외부 조회 DB 연결이 가능해야 동작함
- Redis는 선택 사항이며, 없어도 앱은 동작하도록 처리되어 있음
- README 수정과 별개로 저장소 전반에는 기존 lint 이슈가 남아 있음

## 코드 읽기 추천 순서

1. `prisma/schema.prisma`
2. `src/components/layout/navigation-config.ts`
3. `src/app/dashboard/page.tsx`
4. `src/app/settings/integrations/page.tsx`
5. `src/lib/integrations/core/registry.ts`
6. `src/lib/integrations/core/sync-runner.ts`
7. `src/lib/integrations/shopify/adapter.ts`
8. `src/lib/db/supabase-lookup.ts`
