# Floor Mat Set Rules

How Demand Pilot treats floor mat (`CA-FM-`) SKUs: sales statuses, set links, pairing of
loose 1st / 2nd Row units into sets, and how the result feeds stock, containers, back
orders and auto ordering.

The rules were confirmed with the planning team on 2026-11-12 and follow their sheet
("L tab Formulas" and "HL - Pairing Locations Formulas" in *Floor Mat - Demand Pilot*).
The pairing code was checked against that sheet's own data: 486 masters × 25 columns and
1,009 component rows, no differences.

## 1. Terms

| Term | Meaning |
|---|---|
| Master Set SKU | The SKU that is sold. Stocked as loose components, not as a boxed set. |
| Front / 1st Row | Front-row component SKU. |
| Rear / 2nd Row | Second-row component SKU. |
| 3rd Row | Third-row SKU. Sold on its own; never part of pairing. |
| Pair / loose set | One Front + one Rear = one sellable set of a master. |
| Component | A Front or Rear SKU. Several masters can share the same component. |

## 2. Sales statuses

Five statuses apply to floor mat SKUs only. They share the existing `sales_status` field
(the Type column in SKU Master) with Hold / Discontinued / TBD.

| Status | Used for | Auto order | Back order builds up along containers |
|---|---|---|---|
| `1+2 Set` | Master sold as 1st + 2nd Row | Yes | Yes |
| `1+2+3 Set` | Master sold as 1st + 2nd + 3rd Row | No | Yes |
| `1st Row` | Front component | No | No |
| `2nd Row` | Rear component | No | No |
| `3rd Row` | 3rd Row SKU | Yes | Yes |

- Editable in SKU Master, by the Edit dialog and by CSV / Excel import. Matching ignores
  case and spacing; the sheet's `1+2+3 Set (-C)` is read as `1+2+3 Set`.
- These statuses are rejected on a SKU that does not start with `CA-FM-`.

## 3. Set links (SKU Master)

Stored per master in `shipcore.fc_floor_mat_sets`. Editable in SKU Master (Edit dialog
and import). Entering the data is the operations team's job.

| Field | Rule |
|---|---|
| Front (1st Row) SKU | One SKU. |
| Rear (2nd Row) SKU | One SKU. Needs a Front SKU; cannot equal the Front SKU. |
| 3rd Row SKU(s) | Zero or more. Shown one per line in a single cell. |
| 1~2열 Pre-Order 가능? | Yes / No for the master. |
| 3열 Pre-Order 가능? | Yes / No **per 3rd Row SKU**, on the matching line. |
| Old Master Set SKU | Zero or more; reference only. |

- A master cannot link to itself; a 3rd Row SKU cannot also be its Front or Rear; the same
  3rd Row SKU cannot be listed twice.
- A component SKU must already exist in SKU Master, otherwise the save is rejected.
- Import: several values in one cell are separated by a line break or `|`. Yes / No also
  accepts `Y`, `N`, `None` (= No), `O`, `X`. Only columns present in the file change.
- Import: if the number of 3rd Row Pre-Order values does not match the 3rd Row SKUs, that
  row's Pre-Order values are skipped with a warning; the rest of the file still imports.

## 4. Warehouses

| Pairing location | Dashboard warehouses |
|---|---|
| Primary | Fullerton |
| Dtrans | Dream Trans |
| East | TTM Group + TTM Group Jefferson |
| *(not counted)* | Canary, Linkone |

Incoming container units are treated as arriving at **Dtrans**.

## 5. Pairing rules

Code: `src/lib/planning/floor-mat-pairing.ts` (`computeFloorMatPairing`).

1. **Who takes part.** Masters with both a Front and a Rear SKU, and front-only masters
   (rule 9). The 3rd Row is never paired. A component that is inactive or missing from
   SKU Master counts as zero stock.
2. **Order.** Masters are served in descending ADS (`T.Avg` current). Ties keep list order.
3. **Stages.** Stage 0 is current stock. Then one stage per incoming container, in ETA
   order. Every container is a stage, not only FM02 / FM03.
4. **Earlier pairs are protected.** A pair made in an earlier stage is never taken apart
   by a later stage, even for a higher-ADS master.
5. **Each unit is used once.** A shared component's units are reserved across all masters.
6. **Component back order.** A component's own back order is taken out of its incoming
   orders, earliest container first, before those units can pair. It is not taken out of
   on-hand stock. What is left is the **usable arrival**.
7. **Pairs added in a stage** = min(Front left, Rear left), where left = stock at the three
   locations + usable arrivals up to that stage − units already reserved.
8. **Which warehouses.** Each added pair is drawn in this fixed order: same-location first
   (Primary–Primary, Dtrans–Dtrans, East–East), then split routes Front–Rear:
   P–D, P–E, D–P, D–E, E–P, E–D. A split pair needs consolidating before it can ship.
9. **Front-only masters** (a Front SKU and no Rear SKU; team rule of 2026-11-17).
   - *No other master uses that front:* every front unit is a complete set. Current Pairs
     = front stock; Pairs after a container = front stock + usable arrivals up to it. Each
     unit counts under Full Sets of the warehouse it is in, arrivals under Dtrans. Never
     split. Loose Sets On Hand and Loose Sets Ordered follow as for any other master.
     Example: `CA-FM-80-FM10563`, front `CA-FM-TX-80-C1-CD-XL01` with 7 units → 7.
   - *Another master uses the same front* (as its Front or Rear): the front-only master
     gets no sets, and the pairing columns stay blank for it.

## 6. Dashboard columns

Floor Mat Sets group (Floor Mat category only; by default after S.O.D.):

| Column | Meaning |
|---|---|
| 1~2열 / 3열 Pre-Order | From the set links. |
| Front, Rear, 3rd Row + Stock | Linked SKUs and their stock. Front / Rear stock = the three pairing locations; 3rd Row stock = that SKU's Total Stock. |
| Old Set SKU | From the set links. |
| FM02 1st / 2nd, FM03 1st / 2nd | Usable arrival of the Front / Rear in that container (rule 6). This is what enters the shared pool, not what this master gets. Blank when nothing is ordered or the container is no longer incoming. |
| Current Pairs | Pairs from current stock (stage 0). |
| Pairs after FM02 / FM03 | Cumulative pairs after that container. |
| Full Sets Primary / Dtrans / East | Pairs with both pieces at the same location, all stages. |
| Set Split Primary / Dtrans / East | `Front: n \| Rear: n` — pieces at that location belonging to split pairs. |
| Front / Rear units needed | Units to order so leftover pieces can pair. Shown once per component, on its highest-ADS master. |
| Gap | Front units needed + Rear units needed. |
| Lost 1st / 2nd | Units of the component used by other masters sharing it. |
| Free 1st / 2nd | Stock + usable arrivals − Lost. Includes this master's own pairs. |

Inside each container block (Floor Mat only): `Loose Sets Ordered`, `1st Usable`,
`2nd Usable`, `Pairs After`. A component row with an order in that container lists the
masters its units pair into (e.g. `FM15116 × 15`).

Not shown, by the team's decision: `Sets Allocated`, `Order (FM03)`.

## 7. Effect on stock, containers and back orders

- **Loose Sets On Hand** = Current Pairs. It is added to the master's **Total Stock**, and
  S.O.D. is recalculated from that.
- **Loose Sets Ordered** (per container) = pairs the master gains in that container's
  stage. It is added to that container's inflow, so it feeds **Avail Qty**.
- **Split highlight.** The Loose Sets Ordered cell is highlighted when that container's
  stage created at least one split pair for the master. Splits from current stock or from
  an earlier container do not highlight it.
- **Back orders** build up along the container chain for full sets (`1+2 Set`,
  `1+2+3 Set`), `3rd Row`, and all non-floor-mat SKUs. `1st Row` and `2nd Row` show only
  their live back order, because their shortfall is already counted on the set.
- Pairing reruns in the grid when a container quantity is edited on screen.

### Con. Qty and Rem. Qty (Floor Mat rows only)

A container item's quantity is new production plus the remaining / mistake stock used in
that container. Remaining stock is used first, automatically. For Floor Mat rows the two
are shown apart (team decision of 2026-11-17); other categories are unchanged.

| Column | Floor Mat | Other categories |
|---|---|---|
| Con. Qty | New production only. Blank when the whole quantity is remaining stock. | New production + remaining stock used |
| Rem. Qty (each container) | Remaining stock used in that container | Remaining stock not used anywhere, same in every container |
| Rem. Qty (Base) | Blank. Unused remaining stock is on Available Stock Management. | Remaining stock not used anywhere |

- Con. Qty + Rem. Qty = the item quantity. CBM, Avail Qty and everything after them use
  that total, so they do not change. Example: 30 in a container, 5 from remaining stock →
  Con. Qty 25, Rem. Qty 5.
- A number typed into Con. Qty is new production; the remaining stock already used in the
  container stays. Clearing Con. Qty leaves the remaining stock in the container.
- Remaining stock is still taken first: with 7 unused and an empty cell, typing 10 gives
  Con. Qty 3 and Rem. Qty 7. Rem. Qty is not editable.

## 8. Auto order

- Runs for `1+2 Set` and `3rd Row` only (plus the existing Original / Custom).
- Each has its own target inventory life group (`fm_set`, `fm_third`); the calculation is
  the same as for other SKUs.
- Loose sets are not subtracted again: they are already in Total Stock and Avail Qty.

## 9. Known limits

- **As of (historical) view:** no pairing. Per-warehouse stock is not known for a past date.
- **Container timeline page and the legacy grid** (`/planning/dashboard`): Loose Sets
  Ordered is not added to Avail Qty there. The AG Grid dashboard is the reference.
- **Legacy grid** (`/planning/dashboard`): shows the Con. Qty / Rem. Qty split but still
  takes a typed Con. Qty as the item total. Edit Floor Mat quantities in the AG Grid.
- **Column settings list** shows the four floor mat container sub-columns for other
  categories too; the grid itself does not.

## 10. Open items (as of 2026-11-17)

- Remaining List entries can be edited and deleted from the list opened in Container
  Planning as well as on Available Stock Management (2026-11-18). An entry with units
  in a container still cannot be deleted, on either page.
- Final logic sign-off by the team after they finish entering all SKUs.

## 11. Where the code is

| What | File |
|---|---|
| Statuses, set record, input parsing | `src/lib/planning/floor-mat-sets.ts` |
| Pairing | `src/lib/planning/floor-mat-pairing.ts` |
| Dashboard rows → pairing, column accessors | `src/lib/planning/floor-mat-dashboard.ts` |
| Auto-order groups | `src/lib/planning/auto-order-groups.ts` |
| Set storage | `src/lib/sku-master/floor-mat-set-repository.ts`, table `shipcore.fc_floor_mat_sets` |
| Server: Loose Sets On Hand into Total Stock | `src/lib/demand-planning/service.ts` |
| Columns | `src/components/planning/dashboard/columns.ts` |
| Tests | `tests/lib/planning/floor-mat-*.test.ts` |
