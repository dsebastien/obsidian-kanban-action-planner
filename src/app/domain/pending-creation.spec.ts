import { describe, expect, test } from 'bun:test'
import { settlePendingCreations } from './pending-creation'
import type { PendingCreation } from './pending-creation'

const creation = (path: string, until: number): PendingCreation => ({
    path,
    statusValue: 'Todo',
    order: null,
    laneValue: null,
    until
})

describe('settlePendingCreations (issue #223)', () => {
    test('a note in the results has arrived, whatever the deadline', () => {
        const settled = settlePendingCreations([creation('a.md', 0)], new Set(['a.md']), 10)
        expect(settled.arrived.map((c) => c.path)).toEqual(['a.md'])
        expect(settled.expired).toEqual([])
    })

    test('a missing note keeps waiting until its deadline, then expires', () => {
        const pending = [creation('a.md', 100)]
        expect(settlePendingCreations(pending, new Set(), 99).waiting).toHaveLength(1)
        const late = settlePendingCreations(pending, new Set(), 100)
        expect(late.waiting).toEqual([])
        expect(late.expired.map((c) => c.path)).toEqual(['a.md'])
    })

    test('splits several creations independently', () => {
        const settled = settlePendingCreations(
            [creation('a.md', 50), creation('b.md', 500), creation('c.md', 500)],
            new Set(['c.md']),
            100
        )
        expect(settled.expired.map((c) => c.path)).toEqual(['a.md'])
        expect(settled.waiting.map((c) => c.path)).toEqual(['b.md'])
        expect(settled.arrived.map((c) => c.path)).toEqual(['c.md'])
    })
})
