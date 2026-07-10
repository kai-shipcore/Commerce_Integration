# 생산(Production) 모듈 현황 정리

이 문서는 상단 네비게이션 "생산" 그룹 아래 4개 메뉴(시트 커버 부품 / Vehicles / Parts & Codes / Part SKU Generator)의 현재 구현 상태를 코드 기준으로 정리한 것입니다. DB 구조, 현재 로직, 화면 간 연결 관계, 그리고 코드에서 실제로 확인된 제약/한계를 파악해 향후 개선 계획을 세우는 데 참고하기 위해 작성했습니다.

## 목차
1. [전체 그림 — 4개 메뉴는 어떻게 연결되는가](#전체-그림)
2. [시트 커버 부품 (Seat Cover Parts)](#1-시트-커버-부품-seat-cover-parts)
3. [Vehicles](#2-vehicles)
4. [Parts & Codes](#3-parts--codes)
5. [Part SKU Generator](#4-part-sku-generator)
6. [공통적으로 발견된 문제](#공통적으로-발견된-문제)
7. [개선 우선순위 제안](#개선-우선순위-제안)

---

## 전체 그림

```
Vehicles (sc_product_vehicle)          Parts & Codes (fc_production_parts / fc_production_codes / fc_designer_initials)
   │  Make/Model 텍스트만 제공              │  Part / Code / Initial 각각 활성 목록 제공
   │                                        ▲
   │                              seat-cover-part-catalog.ts (정적 60개 카탈로그, DB 아님)
   │                              → Part 등록 시 seat_row/position/category 복사
   └───────────────┬─────────────────────────┘
                    ▼
          Part SKU Generator (fc_part_skus)
          "{partName}-{makeAbbr}-{modelAbbr}-{code}-{initial}-{side}"
          → seat-diagram-picker.tsx가 Part의 seat_row/position/category로 부위별 후보 필터링
          → fc_part_sku_checklist_items (체크리스트)

시트 커버 부품 (fc_seat_cover_parts_front/rear/third)
   └─ 위 세 화면과 FK/데이터 연결이 전혀 없는 완전 독립 마스터
```

- **Vehicles**와 **Parts & Codes**는 각각 독립적인 마스터 데이터이며, **Part SKU Generator**가 이 둘을 문자열 조합 방식으로만 참조합니다. 즉 정식 FK 관계가 아니라 "그 시점에 화면에 떠 있던 텍스트 값을 이어붙이는" 느슨한 결합입니다.
- **시트 커버 부품**은 이름은 "부품"이지만 실제로는 완전히 별개 도메인(사이즈별 BOM)이며, 위 세 화면 중 어느 것과도 연결되어 있지 않습니다.

---

## 1. 시트 커버 부품 (Seat Cover Parts)

- 라우트: `/production/seat-cover-parts` · nav id: `seat-cover-sizes` · 권한 섹션: `seat-cover-parts`

### 목적
차량 시트 커버 제작에 필요한 부품 구성을 **사이즈(size) 단위 마스터 데이터**로 관리하는 화면입니다. 하나의 Size(특정 차종/트림의 시트 사이즈 코드)마다 Front(1열)/Rear(2열)/Third(3열) 좌석 위치별로 별도 테이블에서 부품 코드(Headrest, Top/Body, Bottom, Middle, Console, Backrest Storage, Armrest, Subpart 등)를 Driver/Passenger 대칭 정보와 함께 기록합니다. 사실상 "사이즈별 부품 BOM 마스터"이며, Blueprint/Manual/YMM(연식·메이커·모델), 재고(Inventory), 컨펌 여부 같은 참조 정보도 함께 관리합니다.

### 데이터 모델
Prisma 모델(`SeatCoverSize`, `SeatCoverSizeRear`, `SeatCoverSizeThird`)이 스키마에 정의되어 있지만, **API는 Prisma Client 대신 raw SQL(pg Pool)로 직접 쿼리**합니다. 즉 Prisma는 문서/마이그레이션용이고 런타임은 raw SQL입니다.

- `fc_seat_cover_parts_front` / `fc_seat_cover_parts_rear` / `fc_seat_cover_parts_third` (모두 `shipcore` 스키마)
- 공통 컬럼: `id`(cuid), `size`(**UNIQUE**, 사실상 비즈니스 키), `inventory`, `fitting_photo`, `confirmed`, `blueprint`, `manual`, `ymm`, `package`, Headrest/Top-Body/Bottom(Driver/DP-detail/Passenger), Middle, Armrest, `note`, `created_at`, `updated_at`
- Rear/Third에만 있음: `console*`, `backrest_storage*`, `subpart*`
- Front/Rear에만 있음: `fitting_dp_detail` · Rear에만 있음: `added_date`
- 과거 마이그레이션(`20260630150000`)에서 `*_qty`, 중복 detail 필드 등을 제거해 "D/P는 그룹당 필드 하나, qty는 UI 파생값"으로 단순화한 이력이 있음
- **다른 도메인 테이블과 FK 없음** — `size` 문자열이 유일한 식별자이며 참조 무결성 보장 없음

### 현재 기능
- `SeatCoverPartsGrid`(ag-Grid) — Front/Rear/Third 탭 전환마다 `GET /api/production/seat-cover-parts?tab=...` 재호출
- CRUD API: GET(전체 목록, `ORDER BY size`) / POST(신규, `size` 필수 검증만) / PATCH(부분수정, `size` 변경 불가) / DELETE(단건)
- **특수 로직**: 편집 다이얼로그에서 D/P 드롭다운("동일" / "Driver 기준 대칭" / "Passenger 기준 대칭")에 따라 Driver·Passenger 필드를 자동 복제/접미사 부여하고, `buildPackage()`가 각 부품 값을 조합해 `package` 텍스트를 실시간 자동 생성
- 컬럼별 텍스트+플로팅 필터, 단일 행 선택 Add/Edit/Delete, 현재 탭만 Excel Export
- Guest 역할은 일부 컬럼 숨김 + Add/Edit/Delete 버튼 비노출(프론트엔드 조건부 렌더링만)

### 관찰된 제약/한계
- **서버 권한 미검증** — API 3개 라우트 모두 `auth()`(로그인 여부)만 확인하고 `guardPermission("parts-codes", …)` 같은 세부 권한 체크가 전혀 없음. 로그인만 되어 있으면 읽기 전용 역할이라도 API를 직접 호출해 쓰기 가능
- 페이지네이션 없음(전체 행을 한 번에 반환)
- 엑셀 Import/일괄 등록 기능 없음(Export만 있음)
- POST/PATCH 검증이 `size` 필수 여부뿐, 나머지는 타입 검증 없이 그대로 저장
- `fitting_photo` 컬럼이 DB엔 있지만 그리드/폼 어디에도 노출되지 않는 죽은 컬럼으로 보임
- 다른 도메인(Vehicles, Part SKU 등)과 연동 없는 완전 독립 마스터

---

## 2. Vehicles

- 라우트: `/production/vehicles` · nav id: `production-vehicles`

### 목적
차량 마스터(차종) 데이터를 조회·등록·수정하는 화면입니다. 여기서 관리하는 Make/Model 목록이 **Part SKU Generator**의 Make/Model 캐스케이딩 셀렉트를 채우는 소스입니다.

### 데이터 모델
- Prisma 모델 없음 — **완전히 raw SQL로만 관리**되며, 이 저장소의 마이그레이션으로 생성되지도 않음(DB에 이미 존재한다고 가정하고 접근만 함)
- 실제 테이블: `shipcore.sc_product_vehicle`
- 컬럼: `id`, `f_number`(사실상 unique key), `vehicle_type`, `year_generation`, `make`, `model`, `model_2`, `submodel_1_label/value` ~ `submodel_6_label/value`(6쌍), `updated_at`
- **원본 소스는 별도 Supabase lookup DB의 `size_chart.product_vehicle`** — `syncProductVehicles()`가 이를 읽어 `sc_product_vehicle`에 upsert하고, 소스에서 사라진 행은 삭제하는 방식으로 **전체 미러링(mirror sync)**
- Part SKU Generator와는 **FK 없이 Make/Model 텍스트로만 연결**됨 — 생성된 SKU는 vehicle의 `id`/`f_number`를 저장하지 않음. 정식 "차량-부품 적합성(fitment)" 매핑 테이블은 존재하지 않음

### 현재 기능
- GET(전체 반환, 서버 페이지네이션 없음) / POST(`f_number`/`make`/`model` 필수) / PATCH(부분수정)
- **삭제 API 없음** — 개별 행 삭제 불가, "Sync" 버튼으로 소스 DB와 전체 재동기화할 때만 간접 삭제됨
- `VehicleGrid`(ag-grid) — F Number/Vehicle Type/Year-Gen/Make/Model/Model 2/Submodel 1~6/Updated, 컬럼 필터+정렬, Add/Edit 다이얼로그(edit 시 F Number 읽기 전용)
- CBM 관련 필드/로직 없음

### 관찰된 제약/한계
- 서버 페이지네이션 없음
- CSV 업로드/내보내기 없음(대량 반영은 소스 DB 동기화뿐)
- 행 삭제 API 부재
- **권한 체크 미흡** — GET/POST/PATCH 모두 `auth()`만 확인, `guardPermission("production-vehicles", …)` 없음. 같은 테이블을 읽는 `vehicle-options` 라우트는 `part-sku-generator` 권한으로 체크해서 **동일 데이터에 대해 권한 체크 기준이 라우트마다 제각각**
- 입력 검증 최소화(`f_number`/`make`/`model` 존재 여부만 체크)
- 차량-부품 매핑이 텍스트 매칭 수준이라 차종명이 바뀌면 기존 SKU와의 연결 추적이 어려움
- 🐛 **Sync 결과 표시 버그** — API(`src/app/api/product-vehicles/sync/route.ts:15`)는 `{ success, message: "... +N / -M vehicles" }` 형태로 건수를 문자열에만 담아 반환하는데, 클라이언트(`vehicle-grid.tsx:88-90`)는 존재하지 않는 `json.upserted`/`json.deleted` 필드를 읽어 `?? 0`으로 폴백합니다. 실제 동기화(upsert+delete)는 정상 수행되지만 **화면에는 항상 "Sync complete — upserted: 0, deleted: 0"만 표시**됩니다. `json.message`를 그대로 노출하거나 API 응답에 `upserted`/`deleted` 숫자 필드를 추가하면 해결됩니다.

---

## 3. Parts & Codes

- 라우트: `/production/parts-codes` · nav id: `production-parts-codes` · 권한 섹션: `parts-codes`

### 목적
Part SKU Generator가 SKU 문자열을 조합할 때 참조하는 "부품/코드/디자이너 이니셜 사전" 3종을 관리하는 화면입니다. 그 자체로는 업무 트랜잭션을 만들지 않는 순수 lookup 마스터입니다.

### 데이터 모델
Prisma 모델로 관리(3개 모두 독립 테이블, FK 없음):
- `fc_production_parts`(`ProductionPart`): `part_name`(**UNIQUE**), `description`, `seat_row`, `position`, `category`, `is_active` (`prisma/schema.prisma:481-496`)
  - ⚠️ 최초 마이그레이션엔 `part_code` 컬럼이 있었으나 후속 마이그레이션에서 완전히 제거되고 `part_name`이 식별자로 승격됨(과거 설계 문서/기억과 혼동 주의)
  - `seat_row`(`Front`/`Rear`/`Third Row`) · `position`(`Driver`/`Passenger`/`Middle`/`Universal`) · `category`(`Headrest`/`Top Body`/`Bottom`/`Arm`/`Console`/`Back Storage`/`Sub-part`)는 모두 **nullable 자유 텍스트 컬럼**입니다 — DB 레벨 enum이나 FK가 아니라, 등록 시 아래 "Part 등록(카탈로그 기반)" 플로우가 고정 카탈로그 값을 그대로 복사해 넣는 방식입니다. 값 자체에 대한 무결성 제약은 없습니다.
- `fc_production_codes`(`ProductionCode`): `code`(**UNIQUE**), `description`, `is_active` (원래 있던 `name` 컬럼은 제거됨)
- `fc_designer_initials`(`DesignerInitial`): `initial`(**UNIQUE**), `designer_name`, `is_active`
  - ⚠️ 한 번 완전히 DROP되었다가("User.name으로 대체" 사유) 다음날 다시 복원된 이력이 있음 — 구조가 재변경될 수 있는 불안정 영역

### 현재 기능
- `PartsCodesPage`가 탭(Part/Code/Designer Initial) UI를 만듭니다. **Code / Designer Initial 탭만 공용 컴포넌트 `MasterDataTab`으로 구동**되고(설정 객체만 다름), **Part 탭은 전용 컴포넌트 `PartRegistrationTab`으로 완전히 교체**되었습니다(`parts-codes-page.tsx:7, 78` — `import { PartRegistrationTab } ...`, `<PartRegistrationTab key={activeTab} />`).
- API: GET(검색/active 필터)·POST(생성)·PATCH(부분수정 또는 active 토글)·DELETE(soft delete, row 삭제 없음) — 모두 `guardPermission("parts-codes", action)`으로 보호, PATCH는 payload에 따라 `edit`/`status`/`delete` 권한을 세분화해서 체크. Part 탭도 동일한 `/api/production/parts` 엔드포인트와 `parts-codes` 권한 섹션을 그대로 사용합니다(별도 권한 신설 없음).
- Code/Designer Initial은 저장 전 `.toUpperCase()` 정규화 후 중복 체크
- 클라이언트 사이드 검색(`Array.filter`), "비활성 포함" 체크박스, master-detail 2단 레이아웃
- 모든 create/update/delete는 감사 로그(`logAudit`) 기록

#### Part 등록(카탈로그 기반) — `PartRegistrationTab`
- **표준 시트커버 Part 카탈로그**: `src/lib/seat-cover-part-catalog.ts`에 `SEAT_COVER_PART_CATALOG`라는 이름으로 하드코딩된 배열 60개(`SeatCoverPartRow × SeatCoverPartPosition × SeatCoverPartCategory` 조합). **DB 테이블이 아니라 순수 프론트/서버 공용 정적 상수**이며, `src/components/planning/seat-cover/add-part-dialog.tsx`의 `PART_OPTIONS`와 값이 동일하게 유지되어야 하는 미러 구조입니다(코드 주석에 명시). 카탈로그 자체를 늘리거나 수정하는 관리 화면은 없고, 코드 배포로만 바뀝니다.
- 등록 흐름: 사용자가 카탈로그에서 항목 하나를 고르면 그 항목의 `seatRow`/`position`/`category`가 폼에 그대로 복사되어 읽기전용으로 표시되고, 사용자는 실제 DB에 저장될 **`partName`(자유 입력, UNIQUE)** 을 별도로 입력합니다 — 즉 카탈로그 선택값은 "분류 태그"일 뿐이고 저장되는 고유 키는 아닙니다. 여러 `ProductionPart` 레코드가 같은 카탈로그 분류를 공유할 수 있습니다.
- Row/Position/Category는 생성 시점에만 값이 채워지고 이후 수정 폼에서는 다시 바꿀 수 없습니다(Description/Active만 편집 가능) — `part-registration-tab.tsx:408-419`.
- 이 컬럼들이 존재하는 이유는 **Part SKU Generator의 좌석 다이어그램 부위 필터**가 이 값 기준으로 Part를 매칭하기 때문입니다(§4 참고). Code/Designer Initial 쪽에는 이런 분류 컬럼이 없습니다.

### 관찰된 제약/한계
- 서버 페이지네이션 없음(전체 반환 후 프론트 필터링)
- 엑셀 업로드/내보내기 없음, 벌크 등록/일괄 삭제 없음
- 검증이 `min(1)` 수준으로 얕음(형식/길이 제한 없음)
- Delete는 soft delete만 있고 하드 삭제 API 없음(비활성 레코드가 영구 보존됨)
- `seat_row`/`position`/`category`는 TypeScript 유니온 타입으로만 제약되고 DB 레벨 CHECK/enum이 없어, 카탈로그를 거치지 않고 직접 API를 호출하면 임의 문자열이 저장될 수 있음
- 카탈로그(`seat-cover-part-catalog.ts`)와 Planning 모듈의 `PART_OPTIONS`가 값 동기화를 코드 리뷰에만 의존하고 있어, 한쪽만 수정되면 두 모듈의 부위 이름이 어긋날 위험

---

## 4. Part SKU Generator

- 라우트: `/production/part-sku-generator` · nav id: `part-sku-generator` · 권한 섹션: `part-sku-generator` (actions: `read/create/edit/delete/status`)

### 목적
Make/Model(Vehicles) · Part/Code/Initial(Parts & Codes) · Side 값을 조합해 표준 Part SKU 문자열을 생성하고, 생성된 SKU 목록과 진행 체크리스트를 관리하는 화면입니다. **미리보기 전용 유틸리티가 아니라 실제로 DB에 저장되는 기능**입니다.

### 데이터 모델
- `fc_part_skus`(`PartSku`): `sku`(**UNIQUE**), `partName`, `make`, `makeAbbr`, `model`, `modelAbbr`, `code`, `initial`, `side`, `createdByName`, `isActive`(soft-delete), timestamps
- `fc_part_sku_checklist_items`(`PartSkuChecklistItem`): `partSkuId`(FK, `onDelete: Cascade`), `description`, `status`(기본 "Pending"), timestamps — SKU 1건당 체크리스트 N건

**SKU 조합 규칙**: `{partName}-{makeAbbr}-{modelAbbr}-{code}-{initial}-{side}` (side는 `D`/`P`/`MD`/`MP` 중 하나). 이 join 로직이 **프론트(미리보기)와 백엔드(POST) 양쪽에 중복 구현**되어 있음(공유 유틸 없음).

### 현재 기능
- "생성기" 탭 상단 좌측에 `SeatDiagramPicker`(`seat-diagram-picker.tsx`) 좌석 다이어그램이 있고, Front(1열)/Rear(2열)/Third Row(3열)를 토글합니다. 부위를 클릭하면 그 부위의 `{seatRow, position, category}`로 `ProductionPart` 목록을 필터링합니다(`part-sku-generator-page.tsx:195-196`): `part.position === zone.position`이면 매칭되고, 추가로 **`zone.position !== "Middle" && part.position === "Universal"`인 Part는 Middle을 제외한 모든 Driver/Passenger 부위에 폴백으로 매칭**됩니다. 다이어그램 부위 자체는 필터일 뿐이고, 실제 SKU에 들어가는 `partName`은 필터링된 목록에서 사용자가 최종 선택한 `ProductionPart`입니다. (Part의 `seatRow`/`position`/`category`가 어떻게 채워지는지는 §3 "Part 등록(카탈로그 기반)" 참고.)
- "세션 설정"에서 Make(Vehicles 테이블 조회) → 해당 Make의 Model이 다시 캐스케이딩 조회. **Make Abbr/Model Abbr는 마스터 데이터가 아니라 자유 텍스트 입력**(예: "HY", "PA")이며 검증 없음. 필드 입력 순서는 Make → Make Abbr → Model → Model Abbr → Initial입니다.
- Make/Model/MakeAbbr/ModelAbbr/Initial 5개가 채워지면 세션 준비 완료 → 이후 Part/Code/Side만 바꿔가며 연속 생성하는 워크플로우
- 6개 값이 다 채워지면 실시간 SKU 미리보기 표시(`side === "Universal"`이면 마지막 세그먼트 생략, `:188`) → "생성" 클릭 시 POST, **DB 유니크 체크(`findUnique`)로 완전 문자열 일치 기준 중복 방지**, 성공 시 목록 새로고침 + 방금 생성한 항목 자동 선택(Make/MakeAbbr/Model/ModelAbbr/Initial 세션과 다이어그램 부위 선택은 유지, Part/Code/Side만 초기화). 세션 전체를 지우는 별도 "초기화" 액션도 있음.
- 좌측: 생성된 SKU 목록(검색은 SKU/Part명/Make/MakeAbbr/Model/ModelAbbr/Code/Initial/Side/생성자/좌석 위치까지 포함, 비활성 포함 토글, 활성/비활성 배지, 생성자 표시)
- 우측 상세: 구성요소 breakdown + **체크리스트**(항목 추가/상태 변경 Pending·In Progress·Done은 `edit` 권한 필요/삭제)
- SKU 삭제 버튼은 하드 삭제가 아니라 `isActive=false` soft delete(재활성화 가능)인 반면, **체크리스트 항목 삭제는 하드 삭제**입니다(`part-skus/[id]/checklist/[itemId]/route.ts`) — 같은 화면 안에서 삭제의 되돌리기 가능 여부가 레벨마다 다릅니다.

### 관찰된 제약/한계
- Make Abbr/Model Abbr가 자유 텍스트라 같은 차종에 서로 다른 약어가 입력될 위험(사전 정의 매핑 없음)
- SKU 조합 로직이 프론트/백엔드에 중복 구현되어 있어 규칙 변경 시 두 곳을 함께 고쳐야 함
- 중복 체크가 완전 문자열 일치 기준이라, 약어 표기가 다르면(예: "HY" vs "Hyundai") 같은 조합이어도 중복으로 감지되지 않음
- soft delete만 있고 재활성화 전용 UI 버튼은 없음("비활성 포함" 조회로만 확인 가능)
- 체크리스트 상태값이 하드코딩된 상수(마스터 데이터화 안 됨)

---

## 공통적으로 발견된 문제

4개 화면을 관통해서 반복적으로 나타나는 패턴입니다.

1. **API 레벨 권한 체크가 화면마다 제각각** — Parts & Codes/Part SKU Generator는 `guardPermission`으로 세밀하게 체크하지만, **시트 커버 부품과 Vehicles는 로그인 여부만 확인**하고 별도 권한 체크가 없습니다. 같은 `sc_product_vehicle` 테이블을 읽는 두 라우트(`product-vehicles` vs `vehicle-options`)조차 서로 다른 권한 섹션으로 체크합니다. → 메뉴 노출은 막혀 있어도 API를 직접 호출하면 권한 없는 사용자가 쓰기 작업을 할 수 있는 구조적 허점입니다.
2. **서버 페이지네이션이 4개 화면 모두 없음** — 전부 전체 목록을 한 번에 반환하고 클라이언트(ag-grid 등)에서만 필터링합니다. 데이터가 늘어나면 초기 로딩이 느려집니다.
3. **엑셀 대량 업로드가 거의 없음** — 시트 커버 부품은 Export만, Parts & Codes/Vehicles는 Export도 없습니다(Vehicles는 소스 DB 동기화로만 대량 반영).
4. **삭제는 대부분 soft delete** — 하드 삭제/영구 정리 기능이 없어 비활성 레코드가 계속 쌓입니다.
5. **입력 검증이 전반적으로 얕음** — 필수값 존재 여부 정도만 체크하고 형식/패턴 검증은 거의 없습니다.
6. **마스터 데이터 간 연결이 텍스트 매칭 수준** — Vehicles ↔ Part SKU Generator는 FK가 아니라 Make/Model 문자열로만 연결되어 있어, 차종명이 바뀌면 기존 SKU와의 연결 추적이 끊깁니다.

---

## 개선 우선순위 제안

우선순위는 "데이터 정합성/보안 리스크가 큰 것 → 사용성 개선" 순으로 배치했습니다.

| 순위 | 항목 | 이유 |
|---|---|---|
| 1 | 시트 커버 부품·Vehicles API에 `guardPermission` 추가 | 현재 로그인만 되어 있으면 권한 없이도 쓰기 API 호출 가능 — 보안 허점 중 가장 명확함 |
| 2 | Vehicles Sync 결과 응답 필드 수정 | 코드 한두 줄 수준의 수정으로 바로 고칠 수 있는 명백한 버그(§2) — 우선순위 대비 비용이 가장 낮음 |
| 3 | Vehicles ↔ Part SKU Generator를 FK 기반으로 전환 | 지금은 텍스트 매칭이라 차종명 변경 시 추적 불가 — `vehicle_id` 컬럼 추가 검토 |
| 4 | Make Abbr/Model Abbr를 Vehicles 마스터의 정식 필드로 승격 | 현재 자유 텍스트라 같은 차종에 다른 약어가 들어갈 위험 |
| 5 | SKU 조합 로직을 공유 유틸로 통합 | 프론트/백엔드 중복 구현 — 규칙 변경 시 불일치 위험 |
| 6 | `seat_row`/`position`/`category`에 DB 레벨 제약(CHECK 또는 enum) 추가 | 현재 TS 유니온 타입으로만 제약되어 API 직접 호출 시 임의 문자열 저장 가능 |
| 7 | 4개 화면 공통 서버 페이지네이션 도입 | 이미 Price History/SKU Master 등 다른 모듈에 쓰는 패턴 재사용 가능 |
| 8 | 시트 커버 부품 엑셀 Import, Vehicles/Parts & Codes Export 추가 | 대량 데이터 관리 편의성 |
| 9 | soft-delete 레코드 정리/하드 삭제 기능 검토 | 비활성 데이터 누적 방지 |

이 문서를 기준으로 어느 항목부터 손볼지 정해주시면, 해당 부분부터 구체적인 구현 계획을 잡아드리겠습니다.
