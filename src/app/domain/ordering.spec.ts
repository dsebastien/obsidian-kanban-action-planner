import { describe, expect, it } from 'bun:test'
import {
    ORDER_STEP,
    computeInsertOrder,
    needsRenumber,
    orderBetween,
    planInsertion,
    renumberedOrders
} from './ordering'

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
    it('produces evenly spaced 1-based orders', () => {
        expect(renumberedOrders(3)).toEqual([1, 2, 3])
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

describe('planInsertion', () => {
    it('writes a single midpoint when the column is fully ordered', () => {
        expect(planInsertion([10, 20, 30], 1)).toEqual({ kind: 'single', order: 15 })
    })

    it('single-writes an append at the bottom', () => {
        expect(planInsertion([10, 20], 2)).toEqual({ kind: 'single', order: 20 + ORDER_STEP })
    })

    it('renumbers when any neighbour order is unset', () => {
        const plan = planInsertion([null, 5], 1)
        expect(plan.kind).toBe('renumber')
        if (plan.kind === 'renumber') expect(plan.orders).toEqual([1, 2, 3])
    })

    it('renumbers when the gap collapses', () => {
        const before = 1
        const after = before + Number.EPSILON
        const plan = planInsertion([before, after], 1)
        expect(plan.kind).toBe('renumber')
    })

    it('seeds an empty destination column with a single write', () => {
        expect(planInsertion([], 0)).toEqual({ kind: 'single', order: ORDER_STEP })
    })
})
