import { describe, expect, it } from 'bun:test'
import {
    MAX_NUMBERED_UNORDERED,
    MIN_ORDER_GAP,
    ORDER_STEP,
    columnNeedsNormalization,
    planColumnNormalization,
    spacedOrders,
    computeInsertOrder,
    needsRenumber,
    orderBetween,
    planInsertion,
    renumberedOrders
} from './ordering'
import type { InsertionPlan } from './ordering'

describe('orderBetween', () => {
    it('seeds an empty column with the step', () => {
        expect(orderBetween(null, null)).toBe(ORDER_STEP)
    })

    it('places before the first card', () => {
        expect(orderBetween(null, 10)).toBe(10 - ORDER_STEP)
    })

    it('appends after the last card', () => {
        expect(orderBetween(10, null)).toBe(10 + ORDER_STEP)
    })

    it('takes the midpoint between two neighbours', () => {
        expect(orderBetween(10, 20)).toBe(15)
        expect(orderBetween(1, 2)).toBe(1.5)
    })

    it('converges toward the lower neighbour on repeated top-of-gap inserts', () => {
        let after = 2
        const before = 1
        for (let i = 0; i < 10; i++) {
            const next = orderBetween(before, after)
            expect(next).toBeGreaterThan(before)
            expect(next).toBeLessThan(after)
            after = next
        }
    })
})

describe('needsRenumber', () => {
    it('is false when a neighbour is missing', () => {
        expect(needsRenumber(null, 5)).toBe(false)
        expect(needsRenumber(5, null)).toBe(false)
    })

    it('is false for a healthy gap', () => {
        expect(needsRenumber(10, 20)).toBe(false)
    })

    it('is true when neighbours are equal or inverted', () => {
        expect(needsRenumber(5, 5)).toBe(true)
        expect(needsRenumber(6, 5)).toBe(true)
    })

    it('is true when the gap is below float precision', () => {
        const before = 1
        const after = before + Number.EPSILON
        expect(needsRenumber(before, after)).toBe(true)
    })
})

describe('renumberedOrders', () => {
    it('produces orders spaced by ORDER_STEP', () => {
        expect(renumberedOrders(3)).toEqual([ORDER_STEP, 2 * ORDER_STEP, 3 * ORDER_STEP])
        expect(renumberedOrders(0)).toEqual([])
    })
})

describe('computeInsertOrder', () => {
    const col = [10, 20, 30]

    it('inserts at the top', () => {
        expect(computeInsertOrder(col, 0)).toBe(10 - ORDER_STEP)
    })

    it('inserts in the middle as a midpoint', () => {
        expect(computeInsertOrder(col, 1)).toBe(15)
        expect(computeInsertOrder(col, 2)).toBe(25)
    })

    it('appends at the bottom', () => {
        expect(computeInsertOrder(col, 3)).toBe(30 + ORDER_STEP)
    })

    it('clamps out-of-range indices', () => {
        expect(computeInsertOrder(col, -5)).toBe(10 - ORDER_STEP)
        expect(computeInsertOrder(col, 99)).toBe(30 + ORDER_STEP)
    })

    it('seeds an empty column', () => {
        expect(computeInsertOrder([], 0)).toBe(ORDER_STEP)
    })
})

/**
 * Apply a plan and return the resulting display sequence, sorted exactly like
 * the board (order ascending, unset last, ties by key), so a test asserts the
 * moved card lands at the drop index whatever the tie-break.
 */
function applyPlan(
    orders: Array<number | null>,
    index: number,
    plan: InsertionPlan
): { sequence: string[]; writes: number } {
    const cards = orders.map((order, k) => ({ key: `n${String(k).padStart(3, '0')}`, order }))
    const at = Math.max(0, Math.min(index, cards.length))
    // The moved card's key sorts FIRST on ties, the worst case for a
    // placement that relied on the tie-break.
    const moved = { key: 'a-moved', order: null as number | null }
    const arrangement = [...cards.slice(0, at), moved, ...cards.slice(at)]
    let writes = 0
    const assign = (k: number, order: number): void => {
        const card = arrangement[k]
        if (!card) throw new Error(`no card at ${String(k)}`)
        if (card === moved || card.order !== order) writes++
        card.order = order
    }
    if (plan.kind === 'single') assign(at, plan.order)
    else plan.orders.forEach((order, k) => assign(plan.start + k, order))
    const sorted = [...arrangement].sort((a, b) => {
        if (a.order === null && b.order === null) return a.key < b.key ? -1 : 1
        if (a.order === null) return 1
        if (b.order === null) return -1
        if (a.order !== b.order) return a.order - b.order
        return a.key < b.key ? -1 : 1
    })
    return { sequence: sorted.map((c) => c.key), writes }
}

/** The expected display sequence: the moved card at `index`. */
function expected(count: number, index: number): string[] {
    const keys = Array.from({ length: count }, (_, k) => `n${String(k).padStart(3, '0')}`)
    keys.splice(index, 0, 'a-moved')
    return keys
}

describe('planInsertion', () => {
    it('writes a single midpoint when the column is fully ordered', () => {
        expect(planInsertion([10, 20, 30], 1)).toEqual({ kind: 'single', order: 15 })
    })

    it('single-writes an append at the bottom', () => {
        expect(planInsertion([10, 20], 2)).toEqual({ kind: 'single', order: 20 + ORDER_STEP })
    })

    it('single-writes at the top', () => {
        expect(planInsertion([10, 20], 0)).toEqual({ kind: 'single', order: 10 - ORDER_STEP })
    })

    it('seeds an empty destination column with a single write', () => {
        expect(planInsertion([], 0)).toEqual({ kind: 'single', order: ORDER_STEP })
    })

    it('single-writes above unordered cards (they sort last)', () => {
        expect(planInsertion([1, 2, null, null], 2)).toEqual({
            kind: 'single',
            order: 2 + ORDER_STEP
        })
        expect(planInsertion([null, null], 0)).toEqual({ kind: 'single', order: ORDER_STEP })
    })

    it('rewrites only one neighbour between duplicate orders', () => {
        const orders = [1, 5, 5, 9]
        const plan = planInsertion(orders, 2)
        expect(plan.kind).toBe('window')
        const { sequence, writes } = applyPlan(orders, 2, plan)
        expect(sequence).toEqual(expected(4, 2))
        expect(writes).toBe(2)
    })

    it('rewrites the short side of a large duplicate cluster, never the column', () => {
        // The live case: a 499-card column with many duplicates.
        const orders: Array<number | null> = Array.from({ length: 499 }, (_, k) =>
            k < 100 ? k + 1 : k < 300 ? 200 : k
        )
        const index = 105 // 5 cards into the 200-card tie
        const plan = planInsertion(orders, index)
        const { sequence, writes } = applyPlan(orders, index, plan)
        expect(sequence).toEqual(expected(499, index))
        expect(writes).toBeLessThanOrEqual(6)
    })

    it('numbers the unordered cards above a drop among them', () => {
        const orders = [1, 2, null, null, null]
        const plan = planInsertion(orders, 4)
        const { sequence, writes } = applyPlan(orders, 4, plan)
        expect(sequence).toEqual(expected(5, 4))
        expect(writes).toBe(3) // two unordered cards + the moved one
    })

    it('puts the card atop the unordered group when too many would need numbers', () => {
        const orders: Array<number | null> = [
            1,
            2,
            ...Array.from({ length: MAX_NUMBERED_UNORDERED + 5 }, () => null)
        ]
        expect(planInsertion(orders, orders.length)).toEqual({
            kind: 'single',
            order: 2 + ORDER_STEP
        })
        const allUnordered = Array.from({ length: 100 }, () => null)
        expect(planInsertion(allUnordered, 100)).toEqual({ kind: 'single', order: ORDER_STEP })
    })

    it('widens around a gap float precision has exhausted', () => {
        const before = 1
        const after = before + Number.EPSILON
        const orders = [0, before, after, 2]
        const plan = planInsertion(orders, 2)
        expect(plan.kind).toBe('window')
        const { sequence, writes } = applyPlan(orders, 2, plan)
        expect(sequence).toEqual(expected(4, 2))
        expect(writes).toBeLessThanOrEqual(3)
    })

    it('places the card at the drop index for every slot of a messy column', () => {
        const orders: Array<number | null> = [1, 1, 1, 2, 3, 3, 4, 4, 4, 4, 7, null, null]
        for (let index = 0; index <= orders.length; index++) {
            const plan = planInsertion(orders, index)
            const { sequence, writes } = applyPlan(orders, index, plan)
            expect(sequence).toEqual(expected(orders.length, index))
            expect(writes).toBeLessThanOrEqual(4)
        }
    })

    it('clamps out-of-range indices', () => {
        expect(planInsertion([10, 20], -3)).toEqual({ kind: 'single', order: 10 - ORDER_STEP })
        expect(planInsertion([10, 20], 99)).toEqual({ kind: 'single', order: 20 + ORDER_STEP })
    })
})

describe('ORDER_STEP spacing', () => {
    it('is wide enough for many midpoints before a rebalance', () => {
        expect(ORDER_STEP).toBe(1024)
        const low = 0
        let high = ORDER_STEP
        let fitted = 0
        while (!needsRenumber(low, high)) {
            high = orderBetween(low, high)
            fitted++
        }
        expect(fitted).toBeGreaterThanOrEqual(25)
    })

    it('appends and prepends one step past the ends', () => {
        expect(orderBetween(2048, null)).toBe(3072)
        expect(orderBetween(null, 2048)).toBe(1024)
    })
})

describe('spacedOrders (readable values)', () => {
    it('rounds to the fewest decimals that keep the gap', () => {
        expect(spacedOrders(7, 8, 2)).toEqual([7.3, 7.7])
        expect(spacedOrders(0, 1024, 3)).toEqual([256, 512, 768])
        expect(orderBetween(1, 2)).toBe(1.5)
        expect(orderBetween(1, 1.1)).toBe(1.05)
    })

    it('never produces long float tails', () => {
        for (const value of spacedOrders(0.1, 0.7, 5) ?? []) {
            expect(String(value).length).toBeLessThanOrEqual(6)
        }
    })

    it('keeps MIN_ORDER_GAP between values and bounds, else has no room', () => {
        const orders = spacedOrders(1, 1 + 4 * MIN_ORDER_GAP, 3)
        expect(orders).not.toBeNull()
        expect(spacedOrders(1, 1 + MIN_ORDER_GAP, 1)).toBeNull()
        expect(spacedOrders(5, 5, 1)).toBeNull()
    })

    it('spaces by ORDER_STEP on an unbounded side', () => {
        expect(spacedOrders(7.3, null, 2)).toEqual([1031, 2055])
        expect(spacedOrders(null, null, 2)).toEqual([ORDER_STEP, 2 * ORDER_STEP])
    })
})

describe('columnNeedsNormalization', () => {
    it('is false for a clean column', () => {
        expect(columnNeedsNormalization([])).toBe(false)
        expect(columnNeedsNormalization([1, 2, 3])).toBe(false)
    })

    it('detects unset orders, ties and gaps too small for a midpoint', () => {
        expect(columnNeedsNormalization([1, 2, null])).toBe(true)
        expect(columnNeedsNormalization([1, 7, 7, 8])).toBe(true)
        expect(columnNeedsNormalization([1, 1 + MIN_ORDER_GAP / 2])).toBe(true)
    })
})

/** Apply normalization writes to a copy of the orders. */
function normalized(orders: Array<number | null>): Array<number | null> {
    const result = [...orders]
    for (const { index, order } of planColumnNormalization(orders)) result[index] = order
    return result
}

/** Strictly increasing with the minimum gap, no nulls. */
function isClean(orders: Array<number | null>): boolean {
    return !columnNeedsNormalization(orders)
}

describe('planColumnNormalization', () => {
    it('plans nothing for a clean column', () => {
        expect(planColumnNormalization([1, 2, 3])).toEqual([])
        expect(planColumnNormalization([])).toEqual([])
    })

    it('appends unset cards after the last ordered one, ORDER_STEP apart', () => {
        expect(planColumnNormalization([1, 2, null, null])).toEqual([
            { index: 2, order: 2 + ORDER_STEP },
            { index: 3, order: 2 + 2 * ORDER_STEP }
        ])
    })

    it('numbers an all-unset column from ORDER_STEP', () => {
        expect(normalized([null, null, null])).toEqual([ORDER_STEP, 2 * ORDER_STEP, 3 * ORDER_STEP])
    })

    it('re-spaces a tied run between its neighbours, keeping the first', () => {
        expect(planColumnNormalization([1, 7, 7, 7, 8])).toEqual([
            { index: 2, order: 7.3 },
            { index: 3, order: 7.7 }
        ])
    })

    it('pulls in the next anchor when a run has no room', () => {
        const orders = [1, 1, 1 + MIN_ORDER_GAP, 5]
        const result = normalized(orders)
        expect(isClean(result)).toBe(true)
        expect(result[0]).toBe(1)
        expect(result[3]).toBe(5)
    })

    it('preserves the displayed sequence and is idempotent on messy live data', () => {
        // The live shape: dense integers, triple ties, unset tail.
        const orders: Array<number | null> = [
            1,
            1,
            1,
            2,
            3,
            4,
            5,
            6,
            7,
            7,
            7,
            8,
            8,
            8,
            9,
            10,
            11,
            12,
            13,
            14,
            15,
            32,
            32,
            32,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null
        ]
        const result = normalized(orders)
        expect(isClean(result)).toBe(true)
        // Sorted by value, the cards keep their positions (display order kept).
        const byValue = result
            .map((order, index) => ({ order: order as number, index }))
            .sort((a, b) => a.order - b.order)
            .map((entry) => entry.index)
        expect(byValue).toEqual(result.map((_, index) => index))
        // Only the cards that needed a value changed.
        expect(planColumnNormalization(orders)).toHaveLength(8 + 8)
        // A second pass finds nothing left to do (no write loop).
        expect(planColumnNormalization(result)).toEqual([])
    })
})
