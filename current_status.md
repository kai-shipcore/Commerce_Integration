# 현재 작업 상태 정리

## 1. 현재까지 반영된 주요 UI 변경 사항

### 브랜드명 변경
- 기존 `AI Forecasting` / `AI Forecasting Platform` 표기를 `Demand Pilot`으로 변경함.
- 반영 위치:
  - 브라우저 메타 타이틀: `src/app/layout.tsx`
  - 좌측 상단 브랜드 텍스트: `src/components/layout/app-layout.tsx`
  - Inngest 앱 이름/ID: `src/lib/inngest/client.ts`

### 좌측 상단 로고 아이콘 변경
- 기존 단순 `TrendingUp` SVG를 커스텀 SVG 아이콘으로 교체함.
- 반영 위치:
  - `src/components/layout/app-layout.tsx`
- 추가 조정:
  - 다크 모드에서도 잘 보이도록 `currentColor` 기반으로 변경함.

### 상단 네비게이션 바 스타일 변경
- 사용자가 실제로 보는 최상단 줄:
  - `Demand Pilot`
  - `Command Center`
  - `SKUs`
  - `Forecasts`
  - `Demand Signals`
  - `Collections`
  - `Analytics`
  - `Integrations`
  - `Light`
  - `Dark`
- 이 영역의 배경색을 라이트/다크 모드별로 직접 지정하도록 수정함.
- 반영 위치:
  - `src/components/layout/app-layout.tsx`
- 현재 적용 방식:
  - `useTheme()`로 현재 테마를 읽고
  - 최상단 `header`와 내부 `container`에 인라인 스타일로 직접 색 적용
- 현재 색상:
  - 라이트: 실버 블루 계열 `#dde6ee`
  - 다크: 슬레이트 블루 계열 `#607786`

### 다크 모드 메뉴 가독성 개선
- 다크 모드에서 비활성 메뉴가 잘 안 보이던 문제 수정.
- 활성 메뉴는 더 밝고, 비활성 메뉴는 `dark:text-slate-200`으로 조정.
- 반영 위치:
  - `src/components/layout/main-nav.tsx`

### 메뉴명 변경
- `Dashboard` -> `Command Center`
- `Sales` -> `Demand Signals`
- 반영 위치:
  - `src/components/layout/main-nav.tsx`

### 테마 토글 추가
- 우측 상단에 `Light / Dark` 토글 추가.
- `next-themes` 기반.
- 반영 위치:
  - `src/components/layout/theme-toggle.tsx`
  - `src/components/providers.tsx`
  - `src/app/layout.tsx`


## 2. 로컬 서버 상태 관련 정리

### 확인 결과
- 로컬 서버는 실행 가능 상태로 확인됨.
- `127.0.0.1:3000` 응답 정상 확인.

### 수정했던 이슈
- `src/lib/redis.ts`
  - Upstash Redis 환경변수가 없어도 강제로 클라이언트를 만들던 부분 수정.
  - 이제 Redis 환경변수가 없으면 캐시를 건너뜀.
- `src/app/globals.css`
  - Tailwind/Turbopack가 프로젝트 내부 임시 폴더를 잘못 스캔하면서 에러가 나던 문제 완화.

### 참고
- 프로젝트 내부 `.tmp-python/tmptx8ouw12` 경로는 권한 문제가 있었음.
- 이 폴더는 직접 삭제하지 못했고, 현재는 우회해서 개발 서버를 정상 동작시키는 쪽으로 처리함.


## 3. Sales 페이지 현재 구조 분석

현재 메뉴상 이름은 `Demand Signals`이지만, 실제 라우트와 파일 구조는 여전히 `sales` 기준으로 동작함.

### 실제 페이지 파일
- `src/app/sales/page.tsx`

### 현재 페이지 역할
- 최근 판매 데이터 목록 조회
- 플랫폼별 필터링
- 수동 판매 입력
- CSV 업로드 import

즉, 화면 이름은 바뀌었지만 내부 기능은 아직 "Sales 관리 페이지" 구조임.


## 4. Sales 페이지에서 실제 호출하는 API 엔드포인트

이 섹션은 특히 중요함.
아래 엔드포인트들은 "실제로 프론트에서 호출되는 경로" 기준으로 정리함.

### 4-1. 판매 목록 조회

- 호출 페이지:
  - `src/app/sales/page.tsx`
- 호출 위치:
  - `fetchSales()` 내부
- 실제 호출 코드:
  - `fetch(/api/sales?${params})`
- 실제 엔드포인트:
  - `GET /api/sales`

### 전달되는 쿼리 파라미터
- `limit=50`
- `platform=shopify | walmart | ebay | manual` 중 선택값
- 플랫폼이 `all`이면 `platform` 파라미터는 붙지 않음

### 이 API가 실제로 가져오는 데이터
- 예, 실제 DB 데이터임.
- 목업 데이터 아님.
- API 내부에서 Prisma를 통해 PostgreSQL의 `SalesRecord` 테이블을 조회함.

### 실제 백엔드 처리 파일
- `src/app/api/sales/route.ts`

### 조회 로직
- `prisma.salesRecord.findMany(...)`
- SKU 관계 데이터도 함께 포함

### 포함되는 주요 필드
- `id`
- `platform`
- `orderId`
- `saleDate`
- `quantity`
- `unitPrice`
- `totalAmount`
- `fulfilled`
- `sku.id`
- `sku.skuCode`
- `sku.name`

### 실제 데이터 여부 결론
- `GET /api/sales`는 로컬 PostgreSQL에 있는 실데이터를 가져옴.


## 5. Sales 입력/등록 관련 API

### 5-1. 수동 등록

- 호출 컴포넌트:
  - `src/components/sales/sales-form-dialog.tsx`
- 실제 엔드포인트:
  - `POST /api/sales`
- 처리 파일:
  - `src/app/api/sales/route.ts`

### 동작 방식
- 다이얼로그에서 SKU, 플랫폼, 주문번호, 날짜, 수량, 단가 등을 입력
- 저장 시 `/api/sales`로 POST
- 백엔드에서 SKU 존재 여부 확인 후 `salesRecord.create(...)` 실행

### 실제 데이터 여부
- 예, 실제 DB에 저장됨.


## 6. Sales import 관련 API

### 6-1. CSV 업로드

- 호출 컴포넌트:
  - `src/components/sales/import-dialog.tsx`
- 실제 엔드포인트:
  - `POST /api/sales/import`
- 처리 파일:
  - `src/app/api/sales/import/route.ts`

### 동작 방식
- CSV 파싱 후 `rows` 배열을 서버로 전송
- 서버에서 행 단위 validation 수행
- 없는 SKU는 자동 생성
- 이후 `prisma.salesRecord.createMany(...)`로 실제 데이터 저장

### 실제 데이터 여부
- 예, 업로드된 내용은 실제 DB에 저장됨.
- 즉 샘플 미리보기만 하는 구조가 아니라, import 완료 시 실제 `SalesRecord` 레코드가 생성됨.

### 추가 참고
- import 중 없는 SKU는 자동 생성될 수 있음.
- 이 SKU는 `src/app/api/sales/import/route.ts`에서 `prisma.sKU.createManyAndReturn(...)`를 통해 생성됨.


## 7. CSV 템플릿 다운로드 엔드포인트

- 호출 컴포넌트:
  - `src/components/sales/import-dialog.tsx`
- 실제 엔드포인트:
  - `GET /api/sales/import`
- 처리 파일:
  - `src/app/api/sales/import/route.ts`

### 주의
- 이 `GET /api/sales/import`는 실데이터를 가져오는 API가 아님.
- 단순히 CSV 템플릿 문자열을 내려주는 용도임.


## 8. Add Sale 다이얼로그에서 추가로 호출하는 API

### SKU 목록 조회

- 호출 컴포넌트:
  - `src/components/sales/sales-form-dialog.tsx`
- 실제 엔드포인트:
  - `GET /api/skus?limit=100`

### 용도
- 수동 판매 입력 시 SKU 선택 드롭다운 목록을 채우기 위함

### 실데이터 여부
- 예, 이것도 실제 DB의 SKU 데이터를 가져오는 API임.


## 9. DB 연결 구조

### Prisma 사용 위치
- `src/lib/db/prisma.ts`

### 실제 연결 대상
- `.env.local`의 `DATABASE_URL`

현재 값:

```env
DATABASE_URL="postgresql://wms:1234@localhost:5433/forecasting_db"
```

즉 현재 프로젝트는:
- 로컬 PostgreSQL
- 포트 `5433`
- DB 이름 `forecasting_db`

를 실제 데이터 저장소로 사용 중임.


## 10. Sales 관련 결론

### 결론 1
- `Demand Signals` 페이지는 현재 실데이터 기반 페이지다.
- 내부 구현은 여전히 `/sales` 라우트와 `SalesRecord` 테이블 중심이다.

### 결론 2
- 가장 중요한 실데이터 조회 엔드포인트는:
  - `GET /api/sales`

### 결론 3
- 실제 데이터 저장 엔드포인트는:
  - `POST /api/sales`
  - `POST /api/sales/import`

### 결론 4
- 실데이터가 아닌 것은:
  - `GET /api/sales/import`
  - 이건 CSV 템플릿 다운로드용


## 11. 다음에 확인하면 좋은 항목

향후 추가 점검 추천:

- `Demand Signals` 페이지 제목/설명도 내부 의미에 맞게 더 정리할지
- `/sales` 라우트명을 실제 브랜드 용어에 맞게 바꿀지
- 날짜 필터, 기간 집계, 차트가 프론트에 아직 연결되지 않았으므로 UI 확장 필요 여부
- `GET /api/sales`의 `groupBy`, `startDate`, `endDate` 기능을 프론트에서 실제로 붙일지

