# Seat Cover Parts 사용자 설명서

> URL: `http://localhost:3000/forecast/planning/seat-cover/parts`  
> 대상: 시트 커버 부품 주문 및 재고 관리 담당자  
> 목적: 고객 주문에서 발생한 부품(Parts) 요청을 등록·추적하고 ShipHero 출고 오더를 생성합니다.

---

## 1. 이 화면에서 할 수 있는 일

- 부품 요청 내역을 탭 상태별로 구분해서 조회합니다.
- 새 부품 요청을 추가하고 ShipHero 오더를 연동해서 생성합니다.
- 기존 행을 수정하거나 삭제합니다.
- Excel 파일로 여러 행을 한 번에 업로드(Import)합니다.
- 현재 화면을 Excel로 내보냅니다(Export).

---

## 2. 화면 구성

화면은 크게 세 부분입니다.

| 영역 | 설명 |
|---|---|
| 상단 툴바 | Export, Import, Delete, Edit, + Add Row 버튼과 로딩 상태 표시 |
| 탭 필터 바 | 상태별 탭(Ready/Not Ready, Shipped, Canceled, Deleted) |
| 데이터 그리드 | 부품 요청 행을 표로 보여줍니다. AG Grid 기반으로 정렬·필터·검색을 지원합니다. |

---

## 3. 처음 열었을 때 기본 상태

- 기본 탭은 `Ready / Not Ready`입니다.
- 행을 선택하지 않은 상태에서는 Edit, Delete 버튼이 비활성화됩니다.
- 행을 한 번 클릭하면 해당 행이 선택되어 Edit, Delete가 활성화됩니다.
- **요청 수신일(Request Received Date)이 90일 이상 지난 행**은 주황색 배경으로 강조 표시됩니다.

---

## 4. 탭 필터

상단 탭에서 현재 보고 싶은 상태를 선택합니다.

| 탭 | 보여주는 행 | 사용 가능한 버튼 |
|---|---|---|
| Ready / Not Ready | Shipping Status가 Ready 또는 Not Ready인 행 | Export, Import, Delete, Edit, + Add Row |
| Shipped | Shipping Status가 Shipped인 행 | Export, Edit |
| Canceled | Shipping Status가 Canceled인 행 | Export, Edit |
| Deleted | 삭제 처리된 행 (deleteYN = Y) | Export |

> 탭을 바꾸면 선택된 행이 초기화됩니다.

---

## 5. 주요 컬럼 읽는 법

| 컬럼 | 의미 |
|---|---|
| Request Received Date | 부품 요청을 받은 날짜. 기본 오름차순 정렬 기준 |
| Order Number | 고객 주문 번호 |
| Part Number | 부품 번호 |
| 해당SKU | 이 부품이 속하는 시트 커버 SKU (사이즈/옵션 코드) |
| QTY | 요청 수량 (고객 요청 낱개 수) |
| Order Request | 실제 발주할 수량. 재고 차감 후 남은 부족분 |
| PART SKU | 시스템 부품 SKU 코드 (`CA-SC-PART-{부품번호}{색상접미사}`) |
| PART SKU(VALUE) | 실제 출고에 사용하는 SKU. 기본값은 PART SKU와 동일 |
| Note | 메모 |
| Order Status | 주문 처리 상태 (자유 입력) |
| Shiphero Order | ShipHero 시스템의 오더 번호 (기본 `RE-{주문번호}`) |
| Shipping Status | 현재 처리 단계. 색상 배지로 표시 |
| Last Updated Date | 마지막 수정 일시 |

### Shipping Status 색상 의미

| 상태 | 색상 | 의미 |
|---|---|---|
| Not Ready | 노란색 | 재고 부족 또는 준비 중 |
| Ready | 초록색 | 출고 준비 완료 |
| Shipped | 파란색 | 출고 완료 |
| Canceled | 빨간색 | 취소됨 |

### 90일 경과 행 강조

요청 수신일(Request Received Date)이 오늘 기준 90일 이상 지난 행은 **주황색 배경**으로 표시됩니다.  
장기 미처리 건을 빠르게 확인할 수 있습니다.

---

## 6. 행 선택, 편집, 삭제

### 행 선택

행을 한 번 클릭하면 파란색으로 강조되며 선택됩니다.  
행이 선택되어야 Edit, Delete 버튼이 활성화됩니다.

### Edit (수정)

1. 수정할 행을 클릭합니다.
2. 상단 `Edit` 버튼을 누릅니다.
3. 팝업이 열리면 원하는 필드를 수정합니다.
4. `Save`를 눌러 저장합니다.

> Deleted 탭에서는 Edit 버튼이 표시되지 않습니다.

### Delete (삭제)

1. 삭제할 행을 클릭합니다.
2. 상단 `Delete` 버튼을 누릅니다.
3. 확인 팝업에서 내용을 확인하고 삭제를 누릅니다.

> 삭제는 물리 삭제가 아니라 `deleteYN = Y` 처리입니다.  
> 삭제된 행은 `Deleted` 탭에서 확인할 수 있습니다.

---

## 7. + Add Row (행 추가)

`Ready / Not Ready` 탭에서만 사용할 수 있습니다.

`+ Add Row` 버튼을 누르면 팝업이 열립니다.  
팝업은 **왼쪽 조회 패널**과 **오른쪽 입력 폼**으로 나뉩니다.

---

### 7-1. 왼쪽: 조회 패널

주문 번호로 SKU와 부품을 자동으로 찾아 채워줍니다.

#### ① Order Number 입력 후 조회

1. `Order Number` 입력창에 주문 번호를 입력합니다.
2. `조회` 버튼을 누릅니다.
3. 해당 주문의 SC 관련 SKU 목록이 나타납니다.

#### ② SKU / 상품 선택

조회 결과에서 해당하는 SKU 또는 상품명을 클릭합니다.

> SC(Seat Cover)가 포함된 SKU만 목록에 표시됩니다.

#### ③ 해당SKU 선택

SKU를 선택하면 사이즈/옵션 버튼 목록이 나타납니다.  
해당하는 사이즈를 클릭합니다.

- 사이즈를 선택하면 오른쪽 폼의 `해당SKU` 필드가 자동으로 채워집니다.
- component가 없는 SKU는 `해당 SKU의 component 없음` 메시지가 표시됩니다.

#### ④ Part 선택

사이즈를 선택하면 해당 좌석 위치에 맞는 부품 목록이 나타납니다.

| 사이즈 첫 글자 | 표시되는 부품 |
|---|---|
| F | Front 계열 부품 (헤드레스트, 탑바디, 바텀, 암레스트 등) |
| B 또는 R | Rear 계열 부품 |
| E | Third Row 계열 부품 |

검색창에 부품 이름 일부를 입력하면 목록을 필터링할 수 있습니다.

부품을 선택하면:
- 데이터베이스에서 부품 번호를 자동으로 조회합니다.
- 오른쪽 폼의 `Part Number`, `PART SKU`, `PART SKU(VALUE)`가 자동으로 채워집니다.
- 해당 부품 번호를 찾지 못하면 `"해당 되는 Part Number 없음"` 안내가 표시됩니다.

---

### 7-2. 오른쪽: 입력 폼

| 필드 | 필수 | 자동 입력 | 설명 |
|---|---|---|---|
| Request Received Date | ✓ | — | 요청 수신 날짜 |
| Part Number | ✓ | 조회 패널에서 자동 | 부품 번호 |
| 해당SKU | — | 사이즈 선택 시 자동 | 시트 커버 SKU |
| QTY | — | — | 요청 낱개 수량 |
| Order Request | — | 재고 확인 후 자동 | 실제 발주 수량 |
| PART SKU | — | 부품 선택 시 자동 | `CA-SC-PART-{번호}{색상접미사}` |
| PART SKU (VALUE) | — | PART SKU와 동일 | 출고 사용 SKU |
| Shiphero Inventory | — | 재고 확인 버튼 클릭 | 창고별 가용 재고 조회 |
| Note | — | — | 메모 |
| Order Status | — | — | 주문 처리 상태 메모 |
| Shiphero Order | — | `RE-{주문번호}` 자동 | ShipHero 오더 번호 |
| Shipping Status | — | Not Ready 기본 | 처리 상태 선택 |

#### Shiphero 재고 확인

`PART SKU`가 입력된 상태에서 `재고 확인` 버튼을 누르면:
- ShipHero 창고별 가용 재고를 조회합니다.
- 재고가 있으면 창고명과 수량을 초록색으로 표시합니다.
- 재고가 0이면 빨간색 `0개`로 표시합니다.
- 찾지 못하면 `찾을 수 없음`으로 표시합니다.
- `QTY - 총재고`를 계산해 `Order Request`를 자동으로 채웁니다.

---

### 7-3. 저장 버튼

| 버튼 | 동작 |
|---|---|
| Save | 입력한 내용만 저장합니다. ShipHero 오더는 생성하지 않습니다. |
| Save and Create Order | 저장 후 ShipHero에 오더를 자동으로 생성합니다. |
| Cancel | 저장하지 않고 팝업을 닫습니다. |

> **Save and Create Order** 사용 조건:
> - `PART SKU` 필드가 입력되어 있어야 합니다.
> - `Shiphero Order` 번호가 입력되어 있어야 합니다.
> - `Order Request` 수량이 1 이상의 정수여야 합니다.

---

## 8. Import (일괄 업로드)

`Ready / Not Ready` 탭에서만 사용할 수 있습니다.

상단 `Import` 버튼을 누르면 업로드 팝업이 열립니다.

### 8-1. 템플릿 다운로드

1. `Download Template` 버튼을 눌러 Excel 템플릿을 내려받습니다.
2. 템플릿의 헤더를 그대로 유지하면서 데이터를 입력합니다.

템플릿 컬럼:

| 컬럼 | 필수 | 비고 |
|---|---|---|
| Request Received Date | ✓ | 날짜 형식 |
| Order Number | ✓ | |
| Part Number | ✓ | |
| 해당SKU | — | |
| QTY | — | 숫자 |
| Order Request | — | 숫자 |
| PART SKU | — | |
| PART SKU(VALUE) | — | |
| Note | — | |
| Order Status | — | |
| Shiphero Order | — | |
| Shipping Status | — | Ready / Not Ready / Shipped / Canceled 중 하나 또는 빈칸 |

### 8-2. 파일 업로드 및 검증

1. 팝업에서 `.xlsx`, `.xls`, `.csv` 파일을 선택합니다.
2. 파일을 선택하면 자동으로 유효성 검사를 합니다.
3. 오류가 있으면 행 번호와 오류 내용을 목록으로 보여줍니다.
4. 오류를 모두 수정한 파일을 다시 선택합니다.
5. 오류가 없으면 `Upload` 버튼이 활성화됩니다.

### 8-3. 유효성 검사 항목

| 항목 | 조건 |
|---|---|
| Request Received Date | 필수, 유효한 날짜 형식 |
| Order Number | 필수 |
| Part Number | 필수 |
| Shipping Status | Ready / Not Ready / Shipped / Canceled / 빈칸만 허용 |
| QTY | 숫자 형식 |
| 중복 행 | 같은 Request Received Date + Order Number + Part Number 조합 중복 불가 |

### 8-4. 업로드

`Upload` 버튼을 누르면 데이터가 서버에 저장됩니다.  
완료되면 몇 개가 저장되었는지 안내 메시지가 표시됩니다.

---

## 9. Export (내보내기)

상단 `Export` 버튼을 누르면 현재 탭의 데이터를 Excel 파일로 내려받습니다.

파일명:

```text
parts_{상태}_{YYYY-MM-DD}.xlsx
```

예시:

```text
parts_ready_not_ready_2026-06-11.xlsx
parts_shipped_2026-06-11.xlsx
```

포함되는 내용:
- 현재 탭에서 보이는 모든 행
- 날짜 컬럼은 M/D/YYYY 형식으로 저장

---

## 10. 자동 입력 로직

Add 팝업에서 특정 값을 입력하면 연관 필드가 자동으로 채워집니다.

| 입력 항목 | 자동으로 채워지는 필드 | 규칙 |
|---|---|---|
| Order Number | Shiphero Order | `RE-{주문번호}` (Shiphero Order가 비어 있거나 이전 자동값인 경우) |
| 해당SKU (사이즈 선택) | 해당SKU | 선택한 사이즈 코드 |
| Part 선택 | Part Number, PART SKU, PART SKU(VALUE) | DB 조회 후 자동 |
| Part Number (직접 입력) | PART SKU | `CA-SC-PART-{번호}{색상접미사}` |
| PART SKU | PART SKU(VALUE) | 동일한 값으로 동기화 (직접 수정 전까지) |
| 재고 확인 클릭 | Order Request | `max(0, QTY - 총재고)` |
| QTY 변경 (재고 확인 후) | Order Request | `max(0, QTY - 총재고)` 재계산 |

### PART SKU 색상 접미사 규칙

해당SKU에 포함된 색상 코드에 따라 PART SKU 접미사가 결정됩니다.

| 색상 코드 | 접미사 | 예시 |
|---|---|---|
| BKRD, BKWH | `-{색상}-STI` | `-BKRD-STI` |
| 그 외 색상 | `-{색상}` | `-BK` |

---

## 11. 추천 업무 흐름

### 신규 부품 요청 처리

1. `Ready / Not Ready` 탭을 엽니다.
2. `+ Add Row`를 누릅니다.
3. 왼쪽 패널에서 Order Number를 입력하고 `조회`를 누릅니다.
4. 해당 SKU → 사이즈 → 부품 순서로 선택합니다.
5. `재고 확인`을 눌러 현재 ShipHero 재고를 확인합니다.
6. `Order Request` 값이 맞는지 검토합니다.
7. 재고가 있으면 `Save`, 출고 오더 생성이 필요하면 `Save and Create Order`를 누릅니다.

### 오래된 미처리 건 확인

1. `Ready / Not Ready` 탭을 엽니다.
2. **주황색 배경** 행(90일 이상 경과)을 확인합니다.
3. Request Received Date 기준으로 정렬해 가장 오래된 건부터 처리합니다.

### 여러 건 일괄 등록

1. `Import` 버튼을 눌러 템플릿을 다운로드합니다.
2. Excel에 데이터를 입력합니다.
3. 파일을 업로드하고 유효성 검사를 통과하면 `Upload`를 누릅니다.

### 출고 완료 처리

1. 해당 행을 선택합니다.
2. `Edit`을 눌러 팝업을 엽니다.
3. `Shipping Status`를 `Shipped`로 변경합니다.
4. `Save`를 누릅니다.
5. 행이 `Shipped` 탭으로 이동합니다.

---

## 12. 자주 하는 실수

| 상황 | 확인할 것 |
|---|---|
| 조회 버튼을 눌렀는데 SKU 목록이 안 나옴 | 주문 번호가 맞는지 확인. SC 계열 SKU가 없는 주문일 수 있음 |
| 부품 선택 후 Part Number가 안 채워짐 | 해당 부품에 매핑된 부품 번호가 DB에 없을 수 있음. 직접 입력 |
| Save and Create Order가 비활성화됨 | PART SKU, Shiphero Order 입력 여부 및 Order Request ≥ 1 확인 |
| Import 업로드 후 데이터가 안 보임 | 현재 탭 필터를 확인. Shipping Status가 Ready 또는 Not Ready인지 확인 |
| 행이 주황색으로 표시됨 | Request Received Date가 90일 이상 지난 장기 미처리 건임 |
| Edit 버튼이 안 보임 | Deleted 탭에서는 수정 불가 |
| Delete 버튼이 비활성화됨 | 행을 먼저 클릭해서 선택해야 함 |

---

## 13. 용어 정리

| 용어 | 뜻 |
|---|---|
| Part Number | 시트 커버 교체용 부품의 고유 번호 |
| 해당SKU | 이 부품이 사용되는 시트 커버 SKU 코드 (사이즈/색상 포함) |
| PART SKU | 시스템 내 부품 SKU. `CA-SC-PART-{번호}{색상접미사}` 형식 |
| PART SKU(VALUE) | 실제 출고 처리에 사용하는 SKU. 기본값은 PART SKU와 동일 |
| Order Request | 실제 발주 필요 수량. `QTY - 재고`로 계산 |
| Shiphero Order | ShipHero 물류 시스템의 오더 번호 |
| Shipping Status | 부품 처리 단계 (Not Ready / Ready / Shipped / Canceled) |
| Request Received Date | 고객으로부터 부품 요청을 받은 날짜 |
| QTY | 고객이 요청한 낱개 수량 |
| Save and Create Order | 부품 행 저장과 동시에 ShipHero 출고 오더를 생성하는 기능 |
| Import | Excel 파일로 여러 행을 한 번에 등록하는 기능 |
