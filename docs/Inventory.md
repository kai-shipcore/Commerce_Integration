# Inventory 페이지 문서

> URL: `http://localhost:3000/inventory`  
> 메뉴명: **Inventory**  
> 작성일: 2026-04-24

---

## 1. 개요

Inventory 페이지는 외부 Coverland 재고 피드에서 가져온 **실시간 재고 스냅샷**을 조회하는 화면입니다.  
Products 페이지의 내부 Prisma 재고와 달리, 이 페이지는 **외부 Supabase DB(`ecommerce_data` 스키마)** 를 직접 읽어 표시하며 **읽기 전용**으로 운영됩니다.

---

## 2. 소스 파일 구조

```
페이지
└── src/app/inventory/page.tsx                             # 메인 페이지

API 라우트
└── src/app/api/inventory/route.ts                        # GET (재고 목록 조회)
└── src/app/api/inventory/sync/route.ts                   # POST (재고 스냅샷 동기화)

컴포넌트
└── src/components/inventory/inventory-table-columns.tsx  # 테이블 컬럼 정의

DB 헬퍼
└── src/lib/db/supabase-lookup.ts                         # getCoverlandInventory() 함수
                                                          # syncInventorySnapshotFromSqlFile() 함수

SQL 스크립트
└── src/sql/Data_sync_sc_inventory_snapshot.sql           # 재고 동기화 SQL
```

---

## 3. 기능 설명

### 3-1. 상단 요약 카드

| 카드 | 내용 |
|------|------|
| **Total Products** | 고유 마스터 SKU 수 (창고 집계와 무관한 상품 단위 수) |
| **On Hand** | 전체 창고 실재고 합계 |
| **Available** | 전체 창고 가용 재고 합계 |
| **Warehouses** | 데이터에 존재하는 고유 창고 수 |

---

### 3-2. 그룹핑 모드

헤더의 **"Grouped by Product"** 버튼으로 두 가지 보기 방식을 전환합니다.

| 모드 | 설명 | 테이블 컬럼 |
|------|------|------------|
| **Warehouse 모드** (기본) | 마스터 SKU × 창고 조합으로 1행 표시 | Master SKU, Warehouse, On Hand, Allocated, Available, Backorder, Snapshot Time |
| **Product 모드** | 마스터 SKU 기준으로 모든 창고 수치를 합산하여 1행 표시 | Master SKU, Warehouses(창고 수), On Hand, Allocated, Available, Backorder, Snapshot Time |

---

### 3-3. 필터 및 검색

| 기능 | 설명 |
|------|------|
| **검색** | Master SKU 코드 또는 창고명으로 검색 |
| **창고 필터** | 드롭다운으로 특정 창고만 필터링 (Warehouse 모드에서만 활성화, Product 모드에서는 비활성) |
| **정렬** | Master SKU, Warehouse, On Hand, Allocated, Available, Backorder, Snapshot Time 기준 오름/내림차순 |
| **페이지네이션** | 기본 20개씩, 서버사이드 페이징 |

---

### 3-4. Sync (재고 동기화)

**Sync 버튼** → `POST /api/inventory/sync` 호출

동기화는 SQL 스크립트(`Data_sync_sc_inventory_snapshot.sql`)를 외부 DB에서 직접 실행하여 3단계로 처리됩니다.

```
Step 1: ecommerce_data.coverland_inventory → shipcore.sc_products 동기화 (UPSERT)
Step 2: ecommerce_data.coverland_inventory → shipcore.sc_warehouses 동기화 (UPSERT)
Step 3: shipcore.sc_inventory_snapshot 전체 TRUNCATE 후 coverland_inventory 데이터 INSERT
```

동기화 완료 후 자동으로 목록을 새로고침합니다.

---

### 3-5. CSV 내보내기

현재 필터/그룹핑 조건을 유지한 채 전체 데이터를 CSV로 다운로드합니다.

내보내기 컬럼: `Master SKU`, `Warehouse`, `On Hand`, `Allocated`, `Available`, `Backorder`, `Snapshot Time`

---

### 3-6. 연결 장애 처리

외부 DB 연결이 불가능한 경우(`isLookupConnectionError`) 500 에러 대신 빈 데이터 + `degraded: true` 응답을 반환하여 페이지가 정상적으로 렌더링되도록 처리합니다.

---

## 4. 연결 DB 테이블

Inventory 페이지는 **외부 Supabase PostgreSQL (`ecommerce_data`, `shipcore` 스키마)** 를 사용합니다.  
Prisma가 아닌 별도의 `pg.Pool` 커넥션으로 직접 SQL을 실행합니다.

### 4-1. 읽기 소스 테이블

#### `shipcore.sc_inventory_snapshot` — 재고 스냅샷 (주 조회 대상)

페이지에 표시되는 모든 재고 수치의 출처 테이블입니다.  
Sync 버튼 실행 시 전체 TRUNCATE 후 재입력됩니다.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `master_sku` | text | 마스터 SKU 코드 |
| `warehouse_code` | text | 창고 코드 |
| `on_hand_qty` | int | 실재고 수량 |
| `available_qty` | int | 가용 재고 수량 |
| `backorder_qty` | int | 백오더 수량 |
| `reserved_qty` | int | 예약(Allocated) 수량 |
| `manual_adjustment_qty` | int | 수동 조정 수량 |
| `final_usable_qty` | int | 최종 사용 가능 수량 |
| `created_at` | timestamp | 원본 데이터 생성 시각 |
| `snapshot_at` | timestamp | 스냅샷 동기화 실행 시각 |

---

### 4-2. 동기화 소스 테이블

#### `ecommerce_data.coverland_inventory` — 원본 재고 피드 (읽기 전용)

외부 Coverland 시스템에서 제공하는 원본 재고 데이터입니다.  
Sync 실행 시 이 테이블을 읽어 `sc_inventory_snapshot`으로 복사합니다.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `master_sku` | text | 마스터 SKU 코드 |
| `warehouse` | text | 창고 코드 |
| `on_hand` | int | 실재고 수량 |
| `available` | int | 가용 재고 수량 |
| `backorder` | int | 백오더 수량 |
| `created_at` | timestamp | 데이터 생성 시각 |

---

### 4-3. Sync 시 함께 갱신되는 테이블

| 테이블 | 처리 방식 | 내용 |
|--------|-----------|------|
| `shipcore.sc_products` | UPSERT | coverland_inventory의 master_sku를 상품 마스터에 등록/갱신 |
| `shipcore.sc_warehouses` | UPSERT | coverland_inventory의 warehouse 값을 창고 마스터에 등록/갱신 |
| `shipcore.sc_inventory_snapshot` | TRUNCATE → INSERT | 전체 삭제 후 최신 데이터로 재입력 |

---

## 5. API 요약

| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| `GET` | `/api/inventory` | 재고 목록 조회 (groupBy, warehouse 필터, 페이징/정렬 지원) |
| `POST` | `/api/inventory/sync` | SQL 스크립트 실행으로 재고 스냅샷 동기화 |

### GET 파라미터

| 파라미터 | 기본값 | 설명 |
|----------|--------|------|
| `page` | `1` | 페이지 번호 |
| `limit` | `20` | 페이지당 행 수 (최대 200, exportAll 시 최대 100000) |
| `exportAll` | `false` | 전체 내보내기 여부 |
| `groupBy` | `warehouse` | `warehouse` or `product` |
| `search` | - | Master SKU 또는 창고명 검색 |
| `warehouse` | `all` | 특정 창고 필터 (warehouse 모드에서만 유효) |
| `sortBy` | `masterSku` | `masterSku`, `warehouse`, `warehouseCount`, `onHand`, `allocated`, `available`, `backorder`, `createdAt` |
| `sortOrder` | `asc` | `asc` or `desc` |

---

## 6. Products 페이지 재고와의 차이점

| 구분 | Inventory 페이지 | Products 페이지 재고 |
|------|-----------------|---------------------|
| **데이터 소스** | 외부 Supabase (`sc_inventory_snapshot`) | 내부 Prisma (`inventorybalance`) |
| **DB 연결** | 별도 `pg.Pool` (supabase-lookup) | Prisma Client |
| **쓰기 가능** | X (읽기 전용, Sync로만 갱신) | O (상품 수정 시 재고 변경 가능) |
| **창고 정보** | O (warehouse_code 포함) | O (inventorylocation 테이블) |
| **실시간성** | Sync 버튼 실행 시점 기준 스냅샷 | 상품 수정 즉시 반영 |
| **집계 단위** | Master SKU × Warehouse (또는 Master SKU 합산) | Master SKU 기준 합산 |
