# Planning Dashboard AG Grid 사용자 설명서

> URL: `http://localhost:3000/planning/dashboard-ag-grid`  
> 대상: 재고, 발주, 컨테이너 입고 계획 담당자  
> 목적: SKU별 재고 상태, 판매 속도, 입고 예정, 품절 예상일을 한 화면에서 확인하고 필요한 값을 빠르게 조정합니다.

## 1. 이 화면에서 할 수 있는 일

이 페이지는 SKU별 재고와 입고 계획을 표 형태로 보는 화면입니다.

- Floor Mat, Car Cover, Seat Cover, Accessories별로 SKU를 조회합니다.
- 현재 재고, 판매량, 일평균 판매량, 입고 수량, SOD를 확인합니다.
- 컨테이너별 입고 수량과 ETA를 보고 부족 SKU를 찾습니다.
- 일부 값은 표에서 바로 수정할 수 있습니다.
- 현재 화면을 Excel 파일로 내보낼 수 있습니다.
- 셀이나 컬럼에 색을 칠해 중요한 SKU를 표시할 수 있습니다.

## 2. 화면 구성

화면은 크게 두 부분입니다.

| 영역 | 설명 |
|---|---|
| 상단 툴바 | 제품군, 타입, 긴급도, 검색, 컬럼 설정, 날짜, Sync, Export 등을 조작합니다. |
| 데이터 그리드 | SKU별 상세 데이터를 표로 보여줍니다. AG Grid라서 스크롤, 정렬, 컬럼 너비 조정, 셀 선택이 빠릅니다. |

## 3. 처음 열었을 때 기본 상태

- 기본 제품군은 `Floor Mat`입니다.
- 컨테이너 상세 컬럼은 처음에는 꺼져 있을 수 있습니다.
- 판매가 없는 SKU는 기본적으로 숨겨질 수 있습니다.
- 설정한 컬럼, 색상, 너비, 시즌 계수 등은 사용자 설정으로 저장됩니다.

## 4. 기본 필터 사용법

### 제품군 선택

상단 첫 번째 드롭다운에서 제품군을 선택합니다.

| 옵션 | 의미 |
|---|---|
| Floor Mat | 플로어 매트 SKU |
| Car Cover | 차량 커버 SKU |
| Seat Cover | 시트 커버 SKU |
| Accessories | 액세서리 SKU |

제품군을 바꾸면 해당 제품군 데이터만 다시 불러옵니다.

### 타입 필터

두 번째 드롭다운에서 SKU 타입을 고릅니다.

| 옵션 | 의미 |
|---|---|
| All Types | 전체 |
| Original | 정규 SKU |
| Custom | 커스텀 SKU |

### 긴급도 필터

세 번째 드롭다운에서 재고 위험도를 골라 빠르게 확인할 수 있습니다.

| 옵션 | 의미 |
|---|---|
| All Status | 전체 |
| Critical | SOD가 가까운 긴급 SKU |
| Warning | 곧 주의가 필요한 SKU |
| BackOrder | 백오더 상태 SKU |

### 검색

검색창에는 SKU 또는 컨테이너명을 입력합니다.

예시:

- `CA-FM`
- `CC-`
- `180`
- `BK`

검색어를 지우려면 검색창 오른쪽의 `X` 버튼을 누릅니다.

## 5. 컬럼 설정

상단의 `Columns` 버튼을 누르면 컬럼 설정 창이 열립니다.

### 빠른 프리셋

| 버튼 | 설명 |
|---|---|
| All | 대부분의 기본 컬럼을 표시합니다. |
| Core | 재고 판단에 필요한 핵심 컬럼만 표시합니다. |
| Compact | 좁은 화면에서 보기 좋게 최소 컬럼만 표시합니다. |
| Container Columns | 컨테이너별 상세 컬럼을 켜거나 끕니다. |

### 컬럼 그룹

컬럼 그룹별로 필요한 정보만 켤 수 있습니다.

| 그룹 | 내용 |
|---|---|
| Inventory | 창고별 가용재고, West, East, Transit, Total 재고 |
| West Sales | West 판매량 |
| East Sales | East 판매량 |
| W Avg | West 일평균 판매량 |
| E Avg | East 일평균 판매량 |
| FBA Avg | FBA 일평균 |
| 30D Sales | 최근 30일 채널별 판매 |
| Total Avg | 전체 일평균 |
| Inbound/SOD | 입고 수량, 다음 ETA, SOD |
| Container | 컨테이너별 상세 수량과 SOD |

### SKU 세부 필터

Columns 창 안의 `SKU Filters`에서 SKU 구성값으로 더 좁게 볼 수 있습니다.

| 필터 | 설명 |
|---|---|
| Seat | 좌석 구분 |
| No. | 번호 |
| Color | 색상 |
| Tone | 톤 |

예를 들어 Seat Cover에서 특정 좌석이나 색상만 볼 때 유용합니다.

### Freeze Column

가로 스크롤을 해도 왼쪽에 고정할 마지막 컬럼을 선택합니다.  
예를 들어 `SOD`까지 고정하면 SKU와 SOD를 계속 보면서 오른쪽 컨테이너 컬럼을 확인할 수 있습니다.

### Show Zero-Sales SKUs

판매가 없는 SKU까지 보고 싶을 때 켭니다.  
일반 확인 작업에서는 꺼두는 것이 화면이 가볍고 보기 쉽습니다.

## 6. 주요 컬럼 읽는 법

### 기본 정보

| 컬럼 | 의미 |
|---|---|
| Container Info | 가장 가까운 입고 컨테이너 정보 |
| CBM | SKU 박스(케이스) 1개당 부피. 컨테이너 CBM 계산에 사용 |
| Case Qty | 박스(케이스) 1개에 들어가는 낱개 수량 |
| Order Multiple | 최소 발주 단위. 발주 수량은 이 값의 배수여야 함 |
| Back | 백오더 수량 |
| Sales Status | Original, Custom, Hold 등 판매 상태 |
| Master SKU | SKU 코드 |

### 재고

| 컬럼 | 의미 |
|---|---|
| Fullerton Stock | Fullerton 창고 가용재고 |
| Canary Stock | Canary 창고 가용재고 |
| TTM Stock | TTM Group 창고 가용재고 |
| TTM Jeff Stock | TTM Group Jefferson 창고 가용재고 |
| West Stock | Fullerton + Canary 가용재고 |
| East Stock | TTM + TTM Jeff 가용재고 |
| Transit Stock | 운송 중 재고 |
| Total Stock | West 가용재고 + East 가용재고 + Transit Stock |

### 판매 속도

| 컬럼 | 의미 |
|---|---|
| 90D, 60D, 30D, 15D, 7D | 기간별 판매량 |
| Prev Avg | 이전 평균 |
| Real Avg | 실제 평균 |
| Current Avg | 현재 적용 평균 |
| Total Avg | 전체 채널 기준 일평균 |

### 입고와 SOD

| 컬럼 | 의미 |
|---|---|
| Inbound Qty | 전체 입고 예정 수량 |
| Containers | 입고 컨테이너 목록 |
| Next ETA | 다음 입고 예정일 |
| SOD | 예상 품절일 |

## 7. 컨테이너 컬럼 사용법

`Columns`에서 `Container Columns`를 켜면 컨테이너별 컬럼이 오른쪽에 표시됩니다.

컨테이너 그룹 헤더에는 컨테이너명과 ETA가 표시됩니다.

| 컨테이너 하위 컬럼 | 의미 |
|---|---|
| ETA | 해당 컨테이너 입고 예정일 |
| CBM | 해당 SKU의 컨테이너 CBM. `(Con. Qty ÷ Case Qty) × cbm_per_unit` 으로 계산 |
| Con. Qty | 해당 컨테이너에 실린 SKU 낱개 수량 |
| Rem. Qty | Remaining stock 배정 수량 |
| Mistake | Mistake stock 배정 수량 |
| Open Orders | 입고 전 부족 주문 영향 |
| Avail Qty | 누적 가용 수량 |
| Est Sales | ETA 사이 예상 판매량 |
| Backorder | 예상 부족 수량 |
| Inv Life | 재고 지속일 |
| Est SOD | 예상 SOD |
| Plan SOD | 계획 기준 SOD |

### 컨테이너 수량 수정

`Con. Qty` 셀은 클릭해서 수량을 수정할 수 있습니다.

1. 수정할 `Con. Qty` 셀을 클릭합니다.
2. 숫자를 입력합니다.
3. Enter를 누르거나 다른 곳을 클릭하면 저장됩니다.
4. 저장 후 같은 SKU의 이후 컨테이너 계산값이 다시 계산됩니다.

### 컨테이너 ETA 수정

컨테이너 헤더의 날짜 입력칸에서 ETA를 바꿀 수 있습니다.

ETA를 바꾸면 해당 컨테이너 이후의 예상 판매, SOD 계산이 다시 반영됩니다.

### Qty > 0만 보기

컨테이너의 `Con. Qty` 헤더에서 우클릭하면 메뉴가 열립니다.

- `Qty > 0만 표시`: 해당 컨테이너에 수량이 있는 SKU만 봅니다.
- `필터 해제`: 다시 전체를 봅니다.

## 8. 표에서 바로 수정 가능한 값

| 항목 | 방법 | 저장 위치 |
|---|---|---|
| CBM | `CBM` 셀 클릭 후 숫자 입력 | SKU Master (`cbm_per_unit`) |
| Case Qty | SKU Master 페이지에서 수정 | SKU Master (`case_qty`) |
| Order Multiple | SKU Master 페이지에서 수정 | SKU Master (`order_multiple`) |
| Transit | `Transit` 셀 클릭 후 숫자 입력 | Planning stats |
| Con. Qty | 컨테이너 `Con. Qty` 셀 클릭 후 숫자 입력 | Container item |
| ETA | 컨테이너 헤더 날짜 변경 | 화면 계산값 및 ETA override |

> **CBM 계산 방식**: 컨테이너 CBM = `(Con. Qty ÷ Case Qty) × cbm_per_unit`  
> `cbm_per_unit`은 박스(케이스) 1개의 부피이며, 낱개 단위가 아닙니다.  
> `Case Qty`와 `cbm_per_unit`은 SKU Master 페이지(`/planning/sku-master`)에서 수정합니다.

입력 중 취소하려면 `Esc`를 누릅니다.  
저장하려면 `Enter`를 누르거나 입력칸 밖을 클릭합니다.

## 9. 셀 선택과 색상 표시

AG Grid 화면에서는 셀을 선택해 색상을 표시할 수 있습니다.

### 한 셀 선택

셀을 한 번 클릭합니다.

### 여러 셀 선택

- 드래그: 사각형 영역을 선택합니다.
- Ctrl 또는 Cmd 클릭: 선택 셀을 추가하거나 제거합니다.
- Shift 클릭: 같은 컬럼에서 범위 선택합니다.

### 색상 적용

선택한 셀 또는 선택한 컬럼에 색상을 적용할 수 있습니다.  
색상은 사용자 설정으로 저장되어 다음에 열어도 유지됩니다.

### 색상 초기화

색상을 잘못 칠했으면 컬럼/셀 색상 설정에서 초기화합니다.

## 10. 정렬과 컬럼 너비

### 정렬

컬럼 헤더를 클릭하면 정렬됩니다.

- 한 번 클릭: 오름차순 또는 내림차순
- 다시 클릭: 반대 방향 정렬

### 컬럼 너비 조정

컬럼 헤더 경계선을 드래그하면 너비가 바뀝니다.  
조정한 너비는 저장되어 다음에도 유지됩니다.

## 11. Export 사용법

상단의 Export 버튼을 누르면 현재 필터와 정렬 상태가 반영된 Excel 파일이 내려받아집니다.

파일명:

```text
planning_YYYY-MM-DD.xlsx
```

포함되는 내용:

- 현재 보이는 행
- 현재 보이는 컬럼
- 현재 정렬/필터 상태
- 날짜 컬럼은 Excel 날짜 형식으로 저장

## 12. Sync 사용법

상단의 Sync 버튼은 최신 데이터를 다시 계산하고 불러오는 기능입니다.

사용하면 좋은 경우:

- 재고/판매 동기화 후 최신 planning 값을 보고 싶을 때
- 컨테이너 또는 SKU Master 수정 후 대시보드를 다시 계산하고 싶을 때
- 다른 사용자가 변경한 값을 반영하고 싶을 때

주의:

- Sync는 시간이 걸릴 수 있습니다.
- 로딩 중에는 버튼이 비활성화되거나 Loading 상태로 보입니다.

## 13. As Of 날짜

날짜 선택에서 기준일을 바꾸면 해당 날짜 기준의 판매 속도를 다시 계산해서 볼 수 있습니다.

사용 예:

- 지난주 기준으로 어떤 SKU가 위험했는지 확인
- 특정 날짜에 재고 판단이 왜 그렇게 나왔는지 검토
- 오늘 값과 과거 기준 값을 비교

오늘 날짜로 돌아가려면 `Today` 버튼을 사용합니다.

## 14. 추천 업무 흐름

### 매일 아침 확인

1. 제품군을 `Floor Mat`부터 확인합니다.
2. `Critical` 필터를 선택합니다.
3. SOD가 가까운 SKU를 봅니다.
4. `Container Columns`를 켜서 입고 예정 수량을 확인합니다.
5. 부족하면 Container Planning 또는 Purchase Order에서 조정합니다.
6. Car Cover, Seat Cover도 같은 방식으로 확인합니다.

### 특정 컨테이너 확인

1. `Container Columns`를 켭니다.
2. 확인할 컨테이너의 `Con. Qty` 헤더를 우클릭합니다.
3. `Qty > 0만 표시`를 선택합니다.
4. 해당 컨테이너에 들어 있는 SKU와 수량, CBM, SOD 변화를 확인합니다.

### 발주 필요 SKU 찾기

1. `Critical` 또는 `Warning` 필터를 선택합니다.
2. `Inbound Qty`, `Next ETA`, `SOD`를 확인합니다.
3. 컨테이너 컬럼에서 이후 입고가 충분한지 봅니다.
4. 부족하면 PO 또는 컨테이너 계획에 반영합니다.

## 15. 자주 하는 실수

| 상황 | 확인할 것 |
|---|---|
| SKU가 안 보임 | 제품군, 타입, 긴급도, 검색어, SKU 세부 필터를 확인하세요. |
| 판매 없는 SKU가 안 보임 | Columns 안의 `Show Zero-Sales SKUs`를 켜세요. |
| 컨테이너 컬럼이 안 보임 | Columns에서 `Container Columns`를 켜세요. |
| 수량이 수정되지 않음 | 입력값이 숫자인지, 저장 중 오류가 없는지 확인하세요. |
| 화면이 너무 넓음 | `Compact` 프리셋을 사용하거나 Freeze Column을 조정하세요. |
| 계산값이 이상함 | Sync 후 다시 확인하고, ETA와 Con. Qty가 맞는지 확인하세요. |

## 16. 용어 정리

| 용어 | 뜻 |
|---|---|
| SOD | Sold Out Date, 예상 품절일 |
| ETA | Estimated Time of Arrival, 입고 예정일 |
| CBM | 박스(케이스) 1개의 부피. SKU Master의 `cbm_per_unit` 값. 컨테이너 CBM = `(수량 ÷ Case Qty) × CBM` |
| Case Qty | 박스(케이스) 1개에 들어가는 낱개 수량. CBM 계산에 사용 |
| Order Multiple | 최소 발주 배수. 발주 수량은 이 값의 배수여야 함 |
| Backorder | 재고보다 주문이 많아 부족한 상태 |
| Inbound | 앞으로 입고될 예정 수량 |
| Transit | 운송 중 재고 |
| Onhand | 실제 보유 재고 기준 |
| Available | 가용 재고 기준 |
| Current Avg | 현재 계산에 적용되는 일평균 판매량 |
| Con. Qty | 특정 컨테이너에 실린 SKU 낱개 수량 |
