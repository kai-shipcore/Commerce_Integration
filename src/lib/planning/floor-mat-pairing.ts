/**
 * Floor mat set pairing.
 *
 * A floor mat Master Set SKU is sold as one item but stocked as two loose
 * components: one Front (1st Row) and one Rear (2nd Row) make one set. Several
 * masters can share a component, so loose stock has to be shared out. This
 * module decides how many sets each master gets, from which warehouses, now
 * and after each incoming container.
 *
 * It is the planning team's sheet logic ("L tab Formulas" and "HL - Pairing
 * Locations Formulas" in the Floor Mat - Demand Pilot sheet) written as one
 * pure function: no DB, no React. The rules, in the sheet's words:
 *
 *  - Masters are served in descending ADS order.
 *  - Allocation runs in stages: stage 0 is current stock, then one stage per
 *    container in ETA order. The sheet has exactly two containers (FM02, FM03);
 *    here every container is a stage.
 *  - A pair allocated in an earlier stage is never broken up by a later one,
 *    even for a master further down the list ("protected").
 *  - A component's backorder is taken out of its incoming orders, earliest
 *    container first, before any of that order can form a pair. It is not
 *    taken out of on-hand stock.
 *  - Each unit of a component is reserved once across all masters.
 *  - The 3rd Row is not part of pairing. A master with no Rear SKU gets no
 *    pairs.
 *
 * Warehouses: the sheet's three locations are Primary (Fullerton), Dtrans
 * (Dream Trans) and East (TTM Group + TTM Group Jefferson). Stock anywhere
 * else is not passed in and does not pair. Incoming units arrive at Dtrans.
 */

export type PairingLocation = "primary" | "dtrans" | "east";

export const PAIRING_LOCATIONS: readonly PairingLocation[] = ["primary", "dtrans", "east"];

export interface PairingMasterInput {
  masterSku: string;
  frontSku: string | null;
  rearSku: string | null;
  /** Average daily sales; higher is served first. Ties keep input order. */
  ads: number;
}

export interface PairingComponentStock {
  primary: number;
  dtrans: number;
  east: number;
  /** Live backorder as a positive quantity. */
  backorder: number;
}

export interface PairingContainerInput {
  id: string;
  /** Ordered quantity per component SKU in this container. */
  orders: ReadonlyMap<string, number>;
}

export interface FloorMatPairingInput {
  masters: readonly PairingMasterInput[];
  /** Keyed by component SKU. A component missing here has no stock. */
  components: ReadonlyMap<string, PairingComponentStock>;
  /** In ETA order. */
  containers: readonly PairingContainerInput[];
}

/**
 * The nine front-location × rear-location routes, in the fixed order the
 * sheet fills them: same-location pairs first (Primary, Dtrans, East), then
 * the six split routes. A split pair needs consolidating before it can ship.
 */
export const PAIRING_ROUTES: ReadonlyArray<{ front: PairingLocation; rear: PairingLocation }> = [
  { front: "primary", rear: "primary" },
  { front: "dtrans", rear: "dtrans" },
  { front: "east", rear: "east" },
  { front: "primary", rear: "dtrans" },
  { front: "primary", rear: "east" },
  { front: "dtrans", rear: "primary" },
  { front: "dtrans", rear: "east" },
  { front: "east", rear: "primary" },
  { front: "east", rear: "dtrans" },
];

export interface MasterPairing {
  masterSku: string;
  frontSku: string | null;
  rearSku: string | null;
  /** False for a master without both components: it takes no part in pairing. */
  pairable: boolean;
  /** Component stock at the three pairing locations; null when not linked. */
  frontStock: number | null;
  rearStock: number | null;
  /**
   * Per container: the component's order left after its backorder, i.e. what
   * enters the shared pairing pool (not what this master gets). Null when the
   * container has no order for it. Sheet columns "FM02 1st", "FM03 1st", ...
   */
  frontArrivals: Array<number | null>;
  rearArrivals: Array<number | null>;
  /**
   * Cumulative pairs after each stage; index 0 is current stock. Sheet columns
   * "Current pairs allocated", "Pairs after FM02", "Pairs after FM03".
   * pairs[0] is Loose Sets On Hand.
   */
  pairs: number[];
  /** Pairs added in each stage. added[k] for k >= 1 is Loose Sets Ordered in container k - 1. */
  added: number[];
  /** Per stage, the pairs added on each of PAIRING_ROUTES. */
  routes: number[][];
  /** Per stage, how many of the added pairs are split between warehouses. */
  splitAdded: number[];
  /** Pairs with both pieces at the same location, all stages. */
  fullSets: Record<PairingLocation, number>;
  /** Pieces at each location that belong to split pairs, all stages. */
  split: Record<PairingLocation, { front: number; rear: number }>;
  /** Units used by other masters sharing the component. */
  lostFront: number;
  lostRear: number;
  /** Stock plus usable arrivals minus what other masters took. Includes this master's own pairs. */
  freeFront: number;
  freeRear: number;
  /**
   * Fronts to order so leftover rears can pair, shown on the highest-ADS
   * master using that rear only; rearNeeded likewise. Null when not shown.
   */
  frontNeeded: number | null;
  rearNeeded: number | null;
  /** frontNeeded + rearNeeded, null when zero. */
  gap: number | null;
}

export interface ComponentPairing {
  sku: string;
  /** Usable arrival per container, null when the container has no order for it. */
  arrivals: Array<number | null>;
  /**
   * Per container, the masters whose new pairs in that stage use this
   * component, in ADS order. Listed whether or not this component itself is on
   * the container; `arrivals` says whether it has an order there.
   */
  pairings: Array<Array<{ masterSku: string; qty: number }>>;
}

export interface FloorMatPairingResult {
  /** Master SKUs in the order they were served. */
  order: string[];
  masters: Map<string, MasterPairing>;
  components: Map<string, ComponentPairing>;
}

const qty = (value: number | undefined | null) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
};

const zeroLocations = () => ({ primary: 0, dtrans: 0, east: 0 });

export function computeFloorMatPairing(input: FloorMatPairingInput): FloorMatPairingResult {
  const stageCount = input.containers.length + 1;

  // Served in descending ADS; Array.prototype.sort is stable, so ties keep input order.
  const seen = new Set<string>();
  const masters = input.masters
    .filter((master) => (seen.has(master.masterSku) ? false : (seen.add(master.masterSku), true)))
    .map((master) => ({
      ...master,
      frontSku: master.frontSku || null,
      rearSku: master.rearSku || null,
    }))
    .sort((a, b) => (Number(b.ads) || 0) - (Number(a.ads) || 0));

  const componentSkus = new Set<string>();
  for (const master of masters) {
    if (master.frontSku) componentSkus.add(master.frontSku);
    if (master.rearSku) componentSkus.add(master.rearSku);
  }

  // ── Per component: stock, and each container's order net of backorder ─────
  const stock = new Map<string, Record<PairingLocation, number>>();
  const usable = new Map<string, Array<number | null>>();
  for (const sku of componentSkus) {
    const component = input.components.get(sku);
    stock.set(sku, { primary: qty(component?.primary), dtrans: qty(component?.dtrans), east: qty(component?.east) });

    // The backorder is filled from the earliest orders first; only what is
    // left of an order can pair.
    let backorderLeft = qty(component?.backorder);
    usable.set(
      sku,
      input.containers.map((container) => {
        const ordered = qty(container.orders.get(sku));
        if (ordered <= 0) return null;
        const available = Math.max(0, ordered - backorderLeft);
        backorderLeft = Math.max(0, backorderLeft - ordered);
        return available;
      })
    );
  }
  const totalStock = (sku: string) => {
    const s = stock.get(sku)!;
    return s.primary + s.dtrans + s.east;
  };
  const usableThrough = (sku: string, stage: number) =>
    usable.get(sku)!.slice(0, stage).reduce<number>((sum, value) => sum + (value ?? 0), 0);

  // ── Stage by stage: how many pairs each master has ────────────────────────
  const pairsByMaster = masters.map(() => new Array<number>(stageCount).fill(0));
  // Units of each component already reserved: every master's pairs from the
  // previous stage (protected, including masters further down the list), plus
  // what earlier masters added in the current stage.
  const reserved = new Map<string, number>();

  for (let stage = 0; stage < stageCount; stage += 1) {
    reserved.clear();
    if (stage > 0) {
      masters.forEach((master, index) => {
        if (!master.frontSku || !master.rearSku) return;
        const previous = pairsByMaster[index][stage - 1];
        reserved.set(master.frontSku, (reserved.get(master.frontSku) ?? 0) + previous);
        reserved.set(master.rearSku, (reserved.get(master.rearSku) ?? 0) + previous);
      });
    }

    masters.forEach((master, index) => {
      if (!master.frontSku || !master.rearSku) return;
      const previous = stage > 0 ? pairsByMaster[index][stage - 1] : 0;
      const frontLeft = totalStock(master.frontSku) + usableThrough(master.frontSku, stage) - (reserved.get(master.frontSku) ?? 0);
      const rearLeft = totalStock(master.rearSku) + usableThrough(master.rearSku, stage) - (reserved.get(master.rearSku) ?? 0);
      const added = Math.max(0, Math.min(frontLeft, rearLeft));
      pairsByMaster[index][stage] = previous + added;
      reserved.set(master.frontSku, (reserved.get(master.frontSku) ?? 0) + added);
      reserved.set(master.rearSku, (reserved.get(master.rearSku) ?? 0) + added);
    });
  }

  // ── Stage by stage: which warehouses each added pair comes from ───────────
  // The pool is what is physically left at each location. It only ever goes
  // down, apart from each container's usable units landing at Dtrans.
  const pool = new Map<string, Record<PairingLocation, number>>();
  for (const sku of componentSkus) pool.set(sku, { ...stock.get(sku)! });
  const routesByMaster = masters.map(() => Array.from({ length: stageCount }, () => new Array<number>(PAIRING_ROUTES.length).fill(0)));

  for (let stage = 0; stage < stageCount; stage += 1) {
    if (stage > 0) {
      for (const sku of componentSkus) pool.get(sku)!.dtrans += usable.get(sku)![stage - 1] ?? 0;
    }
    masters.forEach((master, index) => {
      if (!master.frontSku || !master.rearSku) return;
      let target = pairsByMaster[index][stage] - (stage > 0 ? pairsByMaster[index][stage - 1] : 0);
      const front = pool.get(master.frontSku)!;
      const rear = pool.get(master.rearSku)!;
      PAIRING_ROUTES.forEach((route, routeIndex) => {
        if (target <= 0) return;
        const taken = Math.max(0, Math.min(target, front[route.front], rear[route.rear]));
        if (taken <= 0) return;
        routesByMaster[index][stage][routeIndex] = taken;
        front[route.front] -= taken;
        rear[route.rear] -= taken;
        target -= taken;
      });
    });
  }

  // ── Per master summary ────────────────────────────────────────────────────
  const finalStage = stageCount - 1;
  const finalByComponent = new Map<string, number>();
  masters.forEach((master, index) => {
    if (!master.frontSku || !master.rearSku) return;
    const final = pairsByMaster[index][finalStage];
    finalByComponent.set(master.frontSku, (finalByComponent.get(master.frontSku) ?? 0) + final);
    finalByComponent.set(master.rearSku, (finalByComponent.get(master.rearSku) ?? 0) + final);
  });

  const result: FloorMatPairingResult = { order: masters.map((master) => master.masterSku), masters: new Map(), components: new Map() };
  const firstWithFront = new Set<string>();
  const firstWithRear = new Set<string>();

  masters.forEach((master, index) => {
    const pairable = Boolean(master.frontSku && master.rearSku);
    const pairs = pairsByMaster[index];
    const routes = routesByMaster[index];
    const fullSets = zeroLocations();
    const split: MasterPairing["split"] = {
      primary: { front: 0, rear: 0 },
      dtrans: { front: 0, rear: 0 },
      east: { front: 0, rear: 0 },
    };
    const splitAdded = new Array<number>(stageCount).fill(0);
    routes.forEach((stageRoutes, stage) => {
      stageRoutes.forEach((count, routeIndex) => {
        if (count <= 0) return;
        const route = PAIRING_ROUTES[routeIndex];
        if (route.front === route.rear) {
          fullSets[route.front] += count;
        } else {
          split[route.front].front += count;
          split[route.rear].rear += count;
          splitAdded[stage] += count;
        }
      });
    });

    let lostFront = 0;
    let lostRear = 0;
    let freeFront = 0;
    let freeRear = 0;
    let frontNeeded: number | null = null;
    let rearNeeded: number | null = null;
    if (pairable) {
      const final = pairs[finalStage];
      lostFront = Math.max(0, (finalByComponent.get(master.frontSku!) ?? 0) - final);
      lostRear = Math.max(0, (finalByComponent.get(master.rearSku!) ?? 0) - final);
      freeFront = Math.max(0, totalStock(master.frontSku!) + usableThrough(master.frontSku!, finalStage) - lostFront);
      freeRear = Math.max(0, totalStock(master.rearSku!) + usableThrough(master.rearSku!, finalStage) - lostRear);

      // A shortage is shown once per leftover component: on the first
      // (highest-ADS) master that uses it, so the same request is not
      // repeated down the list.
      const isFirstWithRear = !firstWithRear.has(master.rearSku!);
      const isFirstWithFront = !firstWithFront.has(master.frontSku!);
      firstWithRear.add(master.rearSku!);
      firstWithFront.add(master.frontSku!);
      const missingFronts = Math.max(0, freeRear - freeFront);
      const missingRears = Math.max(0, freeFront - freeRear);
      if (missingFronts > 0 && isFirstWithRear) frontNeeded = missingFronts;
      if (missingRears > 0 && isFirstWithFront) rearNeeded = missingRears;
    }
    const gap = (frontNeeded ?? 0) + (rearNeeded ?? 0);

    result.masters.set(master.masterSku, {
      masterSku: master.masterSku,
      frontSku: master.frontSku,
      rearSku: master.rearSku,
      pairable,
      frontStock: master.frontSku ? totalStock(master.frontSku) : null,
      rearStock: master.rearSku ? totalStock(master.rearSku) : null,
      frontArrivals: master.frontSku ? [...usable.get(master.frontSku)!] : input.containers.map(() => null),
      rearArrivals: master.rearSku ? [...usable.get(master.rearSku)!] : input.containers.map(() => null),
      pairs,
      added: pairs.map((value, stage) => value - (stage > 0 ? pairs[stage - 1] : 0)),
      routes,
      splitAdded,
      fullSets,
      split,
      lostFront,
      lostRear,
      freeFront,
      freeRear,
      frontNeeded,
      rearNeeded,
      gap: gap > 0 ? gap : null,
    });
  });

  // ── Per component: which masters its incoming units pair into ─────────────
  for (const sku of componentSkus) {
    result.components.set(sku, {
      sku,
      arrivals: [...usable.get(sku)!],
      pairings: input.containers.map(() => []),
    });
  }
  masters.forEach((master, index) => {
    if (!master.frontSku || !master.rearSku) return;
    for (let stage = 1; stage < stageCount; stage += 1) {
      const added = pairsByMaster[index][stage] - pairsByMaster[index][stage - 1];
      if (added <= 0) continue;
      for (const sku of new Set([master.frontSku, master.rearSku])) {
        result.components.get(sku)!.pairings[stage - 1].push({ masterSku: master.masterSku, qty: added });
      }
    }
  });

  return result;
}

/**
 * Short master label for pairing text ("FM15116 × 15"): the SKU from its
 * "FM<digits>" segment on, e.g. CA-FM-80-FM13534-C reads FM13534-C.
 */
export function floorMatMasterLabel(masterSku: string): string {
  const match = masterSku.toUpperCase().match(/(?:^|-)(FM\d.*)$/);
  return match ? match[1] : masterSku;
}

/** "Front: 3 | Rear: 0", or null when the location holds no split pieces. */
export function formatSplit(split: { front: number; rear: number }): string | null {
  return split.front + split.rear === 0 ? null : `Front: ${split.front} | Rear: ${split.rear}`;
}
