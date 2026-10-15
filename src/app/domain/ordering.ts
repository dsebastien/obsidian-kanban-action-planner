/**
 * Fractional float-midpoint ordering (per-column scope).
 *
 * Cards store an `order` number in their note. Dropping a card between two
 * neighbours assigns it the midpoint of their orders, so only the moved card is
 * rewritten. Orders the plugin ASSIGNS (new cards, rebalanced runs, the
 * background normalizer) are spaced by {@link ORDER_STEP}, so later drops find
 * room for a midpoint. When there is none (duplicate or unset orders, or a gap
 * below {@link MIN_ORDER_GAP}), {@link planInsertion} rewrites the smallest run
 * of cards around the drop point — never the whole column: each write is a
 * re-parse for Obsidian and every indexing plugin, and a full renumber of a
 * large column flooded the metadata cache for tens of seconds.
 * {@link planColumnNormalization} repairs a column in the background.
 */

/** Gap between consecutive orders the plugin assigns (seeding, appending, re-spacing). */
export const ORDER_STEP = 1024

/**
 * Smallest gap kept between two adjacent orders. Below it a midpoint is not
 * used (the run is rebalanced instead), so values stay short and readable:
 * ~30 halvings of {@link ORDER_STEP} before a rebalance.
 */
export const MIN_ORDER_GAP = 1e-6

/** Most decimals an assigned order carries (enough to honour {@link MIN_ORDER_GAP}). */
const MAX_ORDER_DECIMALS = 7

/**
 * Most unordered (`null`) cards a drop numbers to land the card among them.
 * Unordered cards sort last, so a card dropped below some of them only lands
 * there once every unordered card above the drop point gets a number. Past
 * this many, the card goes to the top of the unordered group instead (one
 * write); the background normalizer numbers the rest.
 */
export const MAX_NUMBERED_UNORDERED = 20

/**
 * Whether `high` is at least {@link MIN_ORDER_GAP} above `low`. The one
 * comparison every check uses (with a hair of float tolerance: `1.000002 -
 * 1.000001` is not exactly 1e-6), so a value the planner assigns is never
 * flagged again by {@link columnNeedsNormalization} — no write loop.
 */
function hasGap(low: number, high: number): boolean {
    return high - low >= MIN_ORDER_GAP * (1 - 1e-6)
}

/** Whether `order` keeps the minimum gap from both bounds (`null` = unbounded). */
function fits(order: number, low: number | null, high: number | null): boolean {
    return (
        Number.isFinite(order) &&
        (low === null || hasGap(low, order)) &&
        (high === null || hasGap(order, high))
    )
}

/** `value` rounded to `decimals` places. */
function roundTo(value: number, decimals: number): number {
    const factor = 10 ** decimals
    return Math.round(value * factor) / factor
}

/**
 * `count` strictly increasing orders between `low` and `high` (`null` =
 * unbounded on that side), each at least {@link MIN_ORDER_GAP} from its
 * neighbours, rounded to the fewest decimals that keeps them so (readable
 * values, no long float tails). Spaced by {@link ORDER_STEP} on an unbounded
 * side, evenly between two bounds. Null when there is no room.
 */
export function spacedOrders(
    low: number | null,
    high: number | null,
    count: number
): number[] | null {
    if (count <= 0) return []
    const ideal: number[] = []
    for (let k = 0; k < count; k++) {
        if (low === null && high === null) ideal.push((k + 1) * ORDER_STEP)
        else if (low === null) ideal.push((high as number) - (count - k) * ORDER_STEP)
        else if (high === null) ideal.push(low + (k + 1) * ORDER_STEP)
        else ideal.push(low + ((high - low) * (k + 1)) / (count + 1))
    }
    for (let decimals = 0; decimals <= MAX_ORDER_DECIMALS; decimals++) {
        const orders = ideal.map((order) => roundTo(order, decimals))
        let previous = low
        let ok = true
        for (const order of orders) {
            if (!fits(order, previous, null)) {
                ok = false
                break
            }
            previous = order
        }
        if (ok && previous !== null && fits(previous, null, high)) return orders
    }
    return null
}

/**
 * Compute an order value placing a card between `before` and `after`
 * (the orders of its new neighbours; `null` = no neighbour on that side):
 * a step past an end, else the (rounded) midpoint. When the gap is below
 * {@link MIN_ORDER_GAP} ({@link needsRenumber}) the raw midpoint is returned.
 */
export function orderBetween(before: number | null, after: number | null): number {
    const spaced = spacedOrders(before, after, 1)?.[0]
    if (spaced !== undefined) return spaced
    return before !== null && after !== null ? (before + after) / 2 : ORDER_STEP
}

/**
 * True when no order fits between `before` and `after` with
 * {@link MIN_ORDER_GAP} on both sides (equal, inverted or too-close
 * neighbours): the run must be rebalanced before inserting.
 */
export function needsRenumber(before: number | null, after: number | null): boolean {
    if (before === null || after === null) return false
    return spacedOrders(before, after, 1) === null
}

/** Evenly-spaced orders for `count` cards: `[ORDER_STEP, 2 * ORDER_STEP, …]`. */
export function renumberedOrders(count: number): number[] {
    const orders: number[] = []
    for (let i = 0; i < count; i++) orders.push((i + 1) * ORDER_STEP)
    return orders
}

/**
 * Compute the order for a card inserted at `targetIndex` within a column, given
 * the ascending-sorted orders of the OTHER cards already in that column.
 * `targetIndex` is the destination slot (0 = top, length = bottom).
 */
export function computeInsertOrder(sortedOrders: number[], targetIndex: number): number {
    const clamped = Math.max(0, Math.min(targetIndex, sortedOrders.length))
    const before = clamped > 0 ? (sortedOrders[clamped - 1] ?? null) : null
    const after = clamped < sortedOrders.length ? (sortedOrders[clamped] ?? null) : null
    return orderBetween(before, after)
}

/**
 * How to order a card inserted at `index` within a destination column.
 *
 * - `single`: write only the moved card's order (the common case).
 * - `window`: rewrite a small run of consecutive cards around the insertion
 *   point: `orders[k]` is the new order of the arrangement's card at
 *   `start + k` (the arrangement is the column with the moved card inserted
 *   at `index`, so the moved card is at `index`). The caller writes only the
 *   orders that changed.
 */
export type InsertionPlan =
    | { kind: 'single'; order: number }
    | { kind: 'window'; start: number; orders: number[] }

/** Cheap pre-check for {@link spacedOrders} between two bounds (no allocation). */
function mayFit(low: number | null, high: number | null, count: number): boolean {
    if (low === null || high === null) return true
    return hasGap(0, (high - low) / (count + 1))
}

/**
 * Plan how to order a card inserted at `index` within a destination column,
 * given the destination cards' current orders (in display order, excluding the
 * moved card; `null` = unset). The display order is order ascending, unset
 * last, ties broken by note path — so duplicate orders are common in old
 * columns and must not force a rewrite of the column.
 *
 * Picks the SMALLEST run of cards to rewrite: the moved card alone when a
 * midpoint (or a step past an end) fits, else the moved card plus its
 * nearest neighbours, widened until their new orders fit between the run's
 * outer neighbours. A run never starts right after an unordered card (a
 * numbered card would sort above it). Every new order is strictly between
 * its neighbours, so placement never depends on the path tie-break.
 */
export function planInsertion(
    neighborOrders: ReadonlyArray<number | null>,
    index: number
): InsertionPlan {
    const n = neighborOrders.length
    const at = Math.max(0, Math.min(index, n))
    const orderAt = (k: number): number | null => neighborOrders[k] ?? null

    // Dropped below unordered cards: numbering them is the only exact
    // placement; past the cap, settle for the top of the unordered group.
    let firstUnordered = at
    while (firstUnordered > 0 && orderAt(firstUnordered - 1) === null) firstUnordered--
    if (at - firstUnordered > MAX_NUMBERED_UNORDERED) {
        let lastOrdered: number | null = null
        for (let k = firstUnordered - 1; k >= 0 && lastOrdered === null; k--) {
            lastOrdered = orderAt(k)
        }
        return { kind: 'single', order: orderBetween(lastOrdered, null) }
    }

    // Run = neighbours [lo, hi) plus the moved card, `size` = hi - lo.
    for (let size = 0; size <= n; size++) {
        for (let lo = at; lo >= Math.max(0, at - size); lo--) {
            const hi = lo + size
            if (hi < at || hi > n) continue
            if (lo > 0 && orderAt(lo - 1) === null) continue
            const low = lo > 0 ? orderAt(lo - 1) : null
            const high = hi < n ? orderAt(hi) : null
            if (!mayFit(low, high, size + 1)) continue
            const orders = spacedOrders(low, high, size + 1)
            if (!orders) continue
            if (size === 0 && orders[0] !== undefined) return { kind: 'single', order: orders[0] }
            return { kind: 'window', start: lo, orders }
        }
    }
    // Unreachable: the whole column (lo = 0, hi = n) is unbounded on both sides.
    return { kind: 'window', start: 0, orders: renumberedOrders(n + 1) }
}

/**
 * Whether a column's orders (display order) need the background normalizer:
 * a card without an order, or two adjacent orders closer than
 * {@link MIN_ORDER_GAP} (ties included) — places a drop cannot fit a midpoint.
 */
export function columnNeedsNormalization(orders: ReadonlyArray<number | null>): boolean {
    for (let k = 0; k < orders.length; k++) {
        const order = orders[k] ?? null
        if (order === null) return true
        const previous = k > 0 ? (orders[k - 1] ?? null) : null
        if (previous !== null && !hasGap(previous, order)) return true
    }
    return false
}

/** One order write the normalizer plans: the card at `index` (display order) gets `order`. */
export interface OrderWrite {
    index: number
    order: number
}

/**
 * Plan the background repair of a column, given its orders in DISPLAY order
 * (order ascending, unset last, ties by path). The result preserves that
 * sequence exactly and changes as few cards as possible:
 *
 * - every card whose order is at least {@link MIN_ORDER_GAP} above the last
 *   kept one keeps it (an anchor);
 * - the others (unset, tied, too close) get {@link spacedOrders} between the
 *   anchors around them; unset cards at the end are appended after the last
 *   ordered card, {@link ORDER_STEP} apart;
 * - when a run has no room before its next anchor, that anchor joins the run.
 *
 * Unchanged cards are not listed. Idempotent: planning over the result is
 * empty ({@link columnNeedsNormalization} is false for it).
 */
export function planColumnNormalization(orders: ReadonlyArray<number | null>): OrderWrite[] {
    const n = orders.length
    const orderAt = (k: number): number | null => orders[k] ?? null
    const writes: OrderWrite[] = []
    let last: number | null = null
    let i = 0
    while (i < n) {
        const order = orderAt(i)
        if (order !== null && (last === null || hasGap(last, order))) {
            last = order
            i++
            continue
        }
        // A run of cards needing a value starts at i; grow it past every card
        // that does not clear `last`, then past anchors until the run fits.
        let j = i + 1
        const clears = (k: number): boolean => {
            const o = orderAt(k)
            return o !== null && (last === null || hasGap(last, o))
        }
        while (j < n && !clears(j)) j++
        let spaced = spacedOrders(last, j < n ? orderAt(j) : null, j - i)
        while (!spaced) {
            j++
            spaced = spacedOrders(last, j < n ? orderAt(j) : null, j - i)
        }
        spaced.forEach((value, k) => {
            if (orderAt(i + k) !== value) writes.push({ index: i + k, order: value })
        })
        last = spaced[spaced.length - 1] ?? last
        i = j
    }
    return writes
}
