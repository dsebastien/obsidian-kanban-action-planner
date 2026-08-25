/**
 * Fractional float-midpoint ordering (per-column scope).
 *
 * Cards store an `order` number in their note. Dropping a card between two
 * neighbours assigns it the midpoint of their orders, so only the moved card is
 * rewritten. Repeated inserts in the same gap eventually exhaust float
 * precision; {@link needsRenumber} detects that so the caller can renumber the
 * whole column with {@link renumberedOrders}.
 */

/** Default gap between consecutive orders when seeding / appending. */
export const ORDER_STEP = 1

/**
 * Compute an order value placing a card between `before` and `after`
 * (the orders of its new neighbours; `null` = no neighbour on that side).
 */
export function orderBetween(before: number | null, after: number | null): number {
    if (before === null && after === null) return ORDER_STEP
    if (before === null) return (after as number) - ORDER_STEP
    if (after === null) return before + ORDER_STEP
    return (before + after) / 2
}

/**
 * True when there is no representable float strictly between `before` and
 * `after` (the midpoint collapses onto a neighbour) — the column must be
 * renumbered before inserting.
 */
export function needsRenumber(before: number | null, after: number | null): boolean {
    if (before === null || after === null) return false
    if (after <= before) return true
    const mid = (before + after) / 2
    return mid <= before || mid >= after
}

/**
 * Evenly-spaced orders for renumbering a column of `count` cards: `[1, 2, …]`.
 */
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
 * Plan how to order a card inserted at `index` within a destination column,
 * given the destination cards' current orders (in display order, excluding the
 * moved card; `null` = unset).
 *
 * - `single`: the column is fully ordered and a midpoint exists — write only the
 *   moved card's order (the common, cheap case).
 * - `renumber`: the column has unset/colliding orders — assign sequential orders
 *   to the whole new arrangement (`orders[i]` for the i-th card after inserting
 *   the moved card at `index`). The caller writes only those that changed.
 */
export type InsertionPlan =
    | { kind: 'single'; order: number }
    | { kind: 'renumber'; orders: number[] }

export function planInsertion(
    neighborOrders: ReadonlyArray<number | null>,
    index: number
): InsertionPlan {
    const clamped = Math.max(0, Math.min(index, neighborOrders.length))
    if (neighborOrders.every((o): o is number => o !== null)) {
        const before = clamped > 0 ? (neighborOrders[clamped - 1] as number) : null
        const after = clamped < neighborOrders.length ? (neighborOrders[clamped] as number) : null
        if (!needsRenumber(before, after)) {
            return { kind: 'single', order: orderBetween(before, after) }
        }
    }
    return { kind: 'renumber', orders: renumberedOrders(neighborOrders.length + 1) }
}
