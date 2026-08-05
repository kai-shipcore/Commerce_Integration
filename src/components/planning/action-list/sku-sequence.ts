/**
 * Code Guide:
 * The SKU order the user is actually looking at, handed from the list to the
 * detail page.
 *
 * The detail page steps between SKUs and offers a selector, and both used the
 * server's worklist order over every forecastable SKU. So filtering to 128 rows
 * and sorting by stockout date, then clicking in and pressing Next, landed on a
 * SKU that was neither in the filter nor next in the sort.
 *
 * Passed through sessionStorage rather than the URL or the API, because of what
 * has to survive. Filters could travel as parameters, but sort order could not:
 * reproducing it server-side would mean a second implementation of the sort
 * beside the one in action-list-table.ts, and the two would drift. The list has
 * already computed the exact sequence on screen, so that sequence is what moves.
 *
 * The cost is that a shared link does not reproduce the subset, which is the
 * right trade: a working sequence is a property of one person's session, while
 * the planning parameters that must reproduce still travel in the URL.
 *
 * Read through useSyncExternalStore rather than an effect, so there is no
 * synchronous setState in an effect body and no hydration mismatch from reading
 * browser storage during render.
 */

const KEY = "planning:action-list:sequence";

/** Cached so `snapshot` returns a stable reference for identical storage.
 *  useSyncExternalStore re-renders whenever the snapshot changes identity, so
 *  parsing fresh on every call would loop forever. */
let cachedRaw: string | null = null;
let cachedList: string[] | null = null;

/** Record the sequence currently on screen. Failures are ignored: storage is
 *  unavailable in private modes and over quota in others, and losing the
 *  sequence degrades to the worklist order rather than breaking the page. */
export function rememberSkuSequence(skus: string[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(skus));
  } catch {
    /* not worth reporting: the fallback is correct, just less specific */
  }
}

function snapshot(): string[] | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw === cachedRaw) return cachedList;
  cachedRaw = raw;
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    cachedList =
      Array.isArray(parsed) && parsed.every((s) => typeof s === "string")
        ? (parsed as string[])
        : null;
  } catch {
    cachedList = null;
  }
  return cachedList;
}

/** Nothing writes to storage while the detail page is open, so there is no
 *  change to subscribe to. The unsubscribe is required by the API. */
const subscribe = () => () => {};
const serverSnapshot = () => null;

export const skuSequenceStore = { subscribe, snapshot, serverSnapshot };
