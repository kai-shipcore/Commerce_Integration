# Velocity Page Guide

> URL: `http://localhost:3000/velocity`  
> Page file: `src/app/velocity/page.tsx`  
> Last reviewed: 2026-05-18

---

## 1. Purpose

The Velocity page is a SKU-level demand view. It lets a user answer questions such as:

- How many units of a product family sold over the last 90, 60, 30, 15, or 7 days?
- How do `Link`, `Custom`, and `TTM` demand compare for the same business area?
- What does demand look like across selected sales channels?
- What preorder demand exists, separate from regular sales?

The page is built around three choices:

1. **Item**: `Car Cover`, `Seat Cover`, or `Floor Mat`
2. **Channel**: one or more normalized selling channels
3. **Mode**: `Sales`, `TTM`, or `Pre Order`

Until both an item and at least one channel are selected, the table is intentionally hidden.

---

## 2. Main Source Files

```text
Page
└── src/app/velocity/page.tsx

Table definitions
└── src/components/velocity/velocity-table-columns.tsx

Excel export helpers
└── src/lib/velocity-export.ts

API routes
├── src/app/api/velocity/data/route.ts
└── src/app/api/velocity/sync/route.ts

Database schema
└── prisma/schema.prisma
```

---

## 3. What the User Sees

### Header

The top-right area contains:

- **Last synced**: the latest `synced_at` value found in `shipcore.velocity_link_snapshot`
- **Sync** button: refreshes snapshot tables from the Supabase lookup views

The displayed sync timestamp is formatted with the Korean locale (`ko-KR`) as `MM.DD HH:mm`.

### Filter panel

| Control | Behavior |
|---|---|
| **Item** | Exactly one item can be selected: `Car Cover`, `Seat Cover`, or `Floor Mat`. |
| **Channel** | Multiple channels can be selected. `All` toggles every channel on or off. |
| **Mode** | Switches between `Sales`, `TTM`, and `Pre Order`. |
| **Period / Custom** | Chooses rolling-day windows or explicit date ranges. |

Available channels are fixed in the page code:

- `Coverland`
- `Icarcover`
- `Amazon FBA`
- `Amazon FBM`
- `Auto_Armor`
- `Advance_Parts`
- `Walmart`

### Empty states

- No item selected: `아이템을 선택하세요` ("Select an item")
- No channel selected: `채널을 하나 이상 선택하세요` ("Select at least one channel")

### Table tools

- **Search Master SKU...**
- **Export**: exports the currently selected mode
- **Export All**: exports `Sales`, `TTM`, and `Pre Order` side by side
- Pagination starts at `100` rows per page

---

## 4. Date Logic

### Default period mode

The default period chips are:

```text
90D, 60D, 30D, 15D, 7D
```

These are **rolling windows**, and they all end at **today minus 2 days**.

Example:

- If today is `2026-05-18`, then the default windows end on `2026-05-16`.
- The 7D window would be `2026-05-10` through `2026-05-16`, inclusive.

This two-day offset is implemented in both `defaultRanges()` and `periodsToRanges()`.

### Editing rolling periods

The user can:

- Edit an existing day count
- Remove a day count
- Add a new day count

Rules:

- At least one period must remain
- At most five periods can exist
- Periods are sorted descending after edits
- Duplicate period lengths are rejected

### Custom range mode

The user can define up to five explicit date ranges.

Rules:

- `from` must be less than or equal to `to`
- At least one custom range must remain
- Range labels display the number of inclusive days plus `MM-DD~MM-DD`

---

## 5. Mode Behavior

### Sales mode

Uses rows with:

```text
order_type = 'sales'
```

The table shows demand over each selected date window.

### TTM mode

Uses rows with:

```text
order_type = 'ttm'
```

The table structure is similar to Sales mode, but column group labels change from `Sales` to `TTM`.

### Pre Order mode

Uses:

- `order_type = 'preorder'` for regular preorder demand
- `order_type = 'ttm_preorder'` for TTM preorder demand

Unlike Sales and TTM:

- Date ranges are ignored by the API
- The table shows total preorder quantity, not rolling date windows

---

## 6. Item-Specific Table Layouts

### Car Cover

| Section | Meaning |
|---|---|
| `Master SKU` | The stored link master SKU |
| `Total Sales` / `Total` | Quantity from the link snapshot |
| `Final Car Cover Sales` | Same quantity repeated beside a display-only remapped SKU |

For the display-only final SKU, the page converts the style segment:

```text
BKGR -> BKLG
TN -> TNS
```

The quantity is not recalculated for the final SKU column; it is the same value shown in the total column.

### Seat Cover

| Mode | Sections |
|---|---|
| Sales | `Link Sales` and `Custom Sales` |
| TTM | `Link TTM` and `Custom TTM` |
| Pre Order | `Link Pre Order`, `Custom Pre Order`, and `TTM Pre Order` |

Seat Cover is the only item that queries `velocity_custom_snapshot`.

### Floor Mat

| Mode | Sections |
|---|---|
| Sales / TTM | `Total Sales` |
| Pre Order | `Total` |

Floor Mat does not show custom-side columns.

---

## 7. Row Construction and Interaction Details

### Total row

The first visible row is a synthetic `Total` row built on the client from the API result arrays.

It sums:

- each `link` period quantity
- each `custom` period quantity, when present
- the preorder TTM total, when present

### Visible rows

Rows with no positive quantity anywhere are filtered out before display. The total row is always kept.

### Search

Search behavior depends on item:

- All items: searches the primary `masterSku`
- Car Cover: also searches the display-only final SKU after the style-segment remap (`BKGR -> BKLG`, `TN -> TNS`)
- Seat Cover: also searches `customMasterSku`; in preorder mode it also searches `ttmMasterSku`
- Floor Mat: only the primary `masterSku` is searchable

Search input is debounced by `300ms`.

### Sorting

Supported interactive sorting:

- `Master SKU`
- Link-side period columns such as `90D`, `60D`, etc.

Not sortable:

- Custom-side quantity columns
- Car Cover final-side duplicate quantity columns
- TTM preorder quantity column

The total row is always pinned to the top during client-side sorting.

### Important implementation detail: rows are paired by rank, not by SKU

The page builds visible rows by taking the `link`, `custom`, and `ttm` result arrays and placing entries with the same array index on the same screen row.

That means:

- `link[0]` is displayed beside `custom[0]`
- `link[1]` is displayed beside `custom[1]`
- and so on

The page does **not** join these sections by SKU. This is fine if the intent is side-by-side ranked lists, but it is important not to read one screen row as a guaranteed crosswalk between Link and Custom SKUs.

---

## 8. Data Flow

```text
Supabase lookup views
├── ecommerce_data.vw_sales_order_items_link_new
└── ecommerce_data.vw_sales_order_items_custom_new
          |
          | POST /api/velocity/sync
          v
Internal snapshot tables
├── shipcore.velocity_link_snapshot
└── shipcore.velocity_custom_snapshot
          |
          | GET /api/velocity/data
          v
Velocity page table
```

### Snapshot tables

#### `shipcore.velocity_link_snapshot`

| Field | Purpose |
|---|---|
| `order_date` | Sales date |
| `item_category` | Normalized product family |
| `channel` | Normalized sales channel |
| `order_type` | `sales`, `ttm`, `preorder`, or `ttm_preorder` |
| `link_master_sku` | Link-side master SKU |
| `link_qty` | Aggregated quantity |
| `synced_at` | Snapshot refresh timestamp |

Unique key:

```text
(order_date, item_category, channel, order_type, link_master_sku)
```

#### `shipcore.velocity_custom_snapshot`

Same structure, but with:

- `custom_master_sku`
- `custom_qty`

Unique key:

```text
(order_date, item_category, channel, order_type, custom_master_sku)
```

---

## 9. How Sync Works

`POST /api/velocity/sync` performs the refresh.

### Source views

- `ecommerce_data.vw_sales_order_items_link_new`
- `ecommerce_data.vw_sales_order_items_custom_new`

### Included statuses

Rows are included when `LOWER(item_status)` is one of:

```text
delivered
fulfilled
partially_fulfilled
shipped
shipping
acknowledged
```

### Channel normalization

| Source condition | Stored channel |
|---|---|
| `SHOPIFY_COVERLAND` | `Coverland` |
| `SHOPIFY_ICARCOVER` | `Icarcover` |
| `AMAZON` + `Amazon` fulfillment | `Amazon FBA` |
| `AMAZON` + `Merchant` fulfillment | `Amazon FBM` |
| Other `AMAZON` | `Amazon FBA` |
| `WALMART` | `Walmart` |
| `EBAY_AUTOARMOR` | `Auto_Armor` |
| `EBAY` | `Advance_Parts` |

### Item normalization

| SKU pattern | Stored item category |
|---|---|
| `C-SJ-GR-7` or `CC%` | `Car Cover` |
| `CA-SC%` or `CL-SC%` | `Seat Cover` |
| `CA-FM%` | `Floor Mat` |
| Everything else | `Miscellaneous` |

### Order-type normalization

| `is_ttm` | `is_preorder` | Stored order type |
|---|---|---|
| true | true | `ttm_preorder` |
| true | false | `ttm` |
| false | true | `preorder` |
| false | false | `sales` |

### Master SKU remaps during sync

Before storage, these source master SKUs are remapped:

| From | To |
|---|---|
| `CC-CP-07-N-GR` | `CC-CP-03-M-GR-1TO` |
| `CC-CSP-03-M-GR-1TO` | `CC-CS-03-M-GR-1TO` |
| `C-SJ-GR-7` | `CC-CS-03-J-GR-1TO` |

### Refresh strategy

The sync route:

1. Queries both source views
2. Aggregates quantities in SQL
3. Truncates both snapshot tables
4. Batch-upserts fresh rows in groups of `500`

One small but important note: the route comment says it pulls "400 days" of data, but the current SQL shown in the implementation has no date filter. As written, it loads all qualifying rows returned by the source views.

---

## 10. How `/api/velocity/data` Works

### Request parameters

| Parameter | Example | Meaning |
|---|---|---|
| `items` | `Seat Cover` | Comma-separated item categories |
| `channels` | `Coverland,Amazon FBA` | Comma-separated normalized channels |
| `mode` | `sales` | `sales`, `ttm`, or `preorder` |
| `ranges` | `2026-02-17:2026-05-16,...` | Comma-separated inclusive date ranges |

### Sales and TTM responses

For each selected range, the API creates a conditional aggregate such as:

```sql
SUM(CASE WHEN order_date >= :from AND order_date <= :to THEN qty ELSE 0 END)
```

Returned shape:

```json
{
  "success": true,
  "link": [
    { "masterSku": "SKU-A", "qtys": [120, 80, 40] }
  ],
  "custom": [
    { "masterSku": "SKU-B", "qtys": [90, 60, 25] }
  ]
}
```

`custom` is only queried when the selected items include `Seat Cover`.

### Preorder responses

Returned shape:

```json
{
  "success": true,
  "link": [
    { "masterSku": "SKU-A", "qtys": [12] }
  ],
  "custom": [
    { "masterSku": "SKU-B", "qtys": [7] }
  ],
  "ttm": [
    { "masterSku": "SKU-C", "count": 4 }
  ]
}
```

---

## 11. Export Behavior

### Export

Creates one workbook sheet for the current mode:

- `Sales`
- `TTM`
- `Pre Order`

Filename pattern:

```text
velocity_<item_and_channels>_<YYYY-MM-DD>.xlsx
```

### Export All

Creates one sheet named `Velocity` with three sections placed side by side:

```text
SALES | TTM | PRE ORDER
```

Filename pattern:

```text
velocity_all_<item_and_channels>_<YYYY-MM-DD>.xlsx
```

The exported shape follows the same item-specific layouts used on screen.

---

## 12. Practical Reading Guide

### To read the page correctly

1. Pick the product family first.
2. Select the channel set you actually want to compare.
3. Confirm whether you are looking at:
   - regular sales
   - TTM demand
   - preorder demand
4. Check the date basis:
   - rolling periods end two days before today
   - custom ranges are inclusive
5. Treat side-by-side Link and Custom rows as ranked lists unless you have separately verified a SKU relationship.

### Good use cases

- Fast velocity checks by product family
- Comparing current demand across several rolling windows
- Looking at preorder demand separately from shipped demand
- Exporting a filtered view for offline analysis

### Things this page does not currently do

- It does not automatically load data before an item and channel are selected.
- It does not merge Link and Custom records by SKU.
- It does not expose arbitrary channels from the database; the channel buttons are hard-coded in the page.
- It does not show raw orders; it shows aggregated snapshot quantities.

---

## 13. Troubleshooting Notes

| Symptom | Likely cause |
|---|---|
| No table appears | No item or no channel is selected yet |
| Table is empty | No positive quantity matched the selected filters, or the snapshot tables are stale/empty |
| Last synced looks old | `/api/velocity/sync` has not been run recently |
| Expected custom columns are missing | Only `Seat Cover` uses the custom snapshot query |
| A row seems to pair unrelated Link and Custom SKUs | The screen aligns arrays by rank/index, not by SKU |
| Recent days appear absent from default windows | Default windows intentionally end at today minus 2 days |

---

## 14. Quick Developer Checklist

When changing the Velocity page, verify:

1. `src/app/velocity/page.tsx`
   - item/channel/mode state transitions
   - period range generation
   - search, sorting, pagination, export actions
2. `src/components/velocity/velocity-table-columns.tsx`
   - item-specific table shapes
   - grouping labels
3. `src/app/api/velocity/data/route.ts`
   - filter semantics
   - inclusive date aggregation
   - preorder response shape
4. `src/app/api/velocity/sync/route.ts`
   - status filter
   - channel/category/order-type normalization
   - snapshot refresh behavior
5. `src/lib/velocity-export.ts`
   - export layout still matches the visible page model
