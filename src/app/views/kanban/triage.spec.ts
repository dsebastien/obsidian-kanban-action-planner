import { describe, expect, it } from 'bun:test'
import {
    buildTriageQueue,
    bumpEnumValue,
    classifySwipe,
    isPropUnset,
    pruneProcessedTriageQueue,
    pruneTriageQueue,
    reviewState,
    unsetCount
} from './triage'

describe('isPropUnset (issue #53)', () => {
    const tokens = ['TBD', 'No Target']
    const allowed = ['10 - Top', '20 - High', '99 - TBD']

    it('is unset when empty or absent', () => {
        expect(isPropUnset(null, tokens, allowed)).toBe(true)
        expect(isPropUnset('', tokens, allowed)).toBe(true)
    })

    it('is unset when the value contains a needs-triage token (case-insensitive)', () => {
        expect(isPropUnset('99 - TBD', tokens, allowed)).toBe(true)
        expect(isPropUnset('99 - ⏰ No Target', tokens, ['99 - ⏰ No Target'])).toBe(true)
        expect(isPropUnset('done tbd-ish', ['tbd'], null)).toBe(true)
    })

    it('is unset when the value is not among known allowed values (stale/invalid)', () => {
        expect(isPropUnset('40 - Bogus', [], allowed)).toBe(true)
    })

    it('is set (clarified) for a valid value with no token match', () => {
        expect(isPropUnset('10 - Top', tokens, allowed)).toBe(false)
        expect(isPropUnset(20, [], null)).toBe(false)
    })

    it('skips the allowed-values check when allowed values are unknown', () => {
        expect(isPropUnset('anything', [], null)).toBe(false)
        expect(isPropUnset('anything', [], [])).toBe(false)
    })
})

describe('unsetCount', () => {
    it('counts gating props that are unset', () => {
        const gates = [
            { value: null, allowedValues: ['a'] }, // unset (empty)
            { value: '99 - TBD', allowedValues: ['10 - Top', '99 - TBD'] }, // unset (token)
            { value: '10 - Top', allowedValues: ['10 - Top', '99 - TBD'] } // set
        ]
        expect(unsetCount(gates, ['TBD'])).toBe(2)
    })
})

describe('reviewState (issue #57)', () => {
    const today = new Date(2026, 5, 29)

    it('is due (max weight) when never reviewed', () => {
        const s = reviewState(null, 30, today)
        expect(s.due).toBe(true)
        expect(s.weight).toBe(Number.MAX_SAFE_INTEGER)
    })

    it('is due with positive overdue days when interval has elapsed', () => {
        // reviewed 40 days ago, interval 30 → 10 days overdue.
        const s = reviewState(new Date(2026, 4, 20), 30, today)
        expect(s.due).toBe(true)
        expect(s.weight).toBe(10)
    })

    it('is not due before the interval elapses', () => {
        const s = reviewState(new Date(2026, 5, 25), 30, today) // 4 days ago
        expect(s.due).toBe(false)
        expect(s.weight).toBeLessThan(0)
    })

    it('is due exactly on the interval boundary', () => {
        const s = reviewState(new Date(2026, 4, 30), 30, today) // 30 days ago
        expect(s.due).toBe(true)
        expect(s.weight).toBe(0)
    })
})

describe('buildTriageQueue (issues #53, #57)', () => {
    type Card = { id: string; weight: number; include: boolean; sort: number }
    const cards: Card[] = [
        { id: 'a', weight: 0, include: false, sort: 3 },
        { id: 'b', weight: 2, include: true, sort: 1 },
        { id: 'c', weight: 1, include: true, sort: 2 },
        { id: 'd', weight: 2, include: true, sort: 2 }
    ]
    const rankOf = (c: Card): { include: boolean; weight: number } => ({
        include: c.include,
        weight: c.weight
    })
    const viewCompare = (a: Card, b: Card): number => a.sort - b.sort

    it('keeps included cards, worst-first then view sort', () => {
        const queue = buildTriageQueue(cards, rankOf, viewCompare)
        // weight desc: b(2,sort1), d(2,sort2), c(1); a excluded.
        expect(queue.map((c) => c.id)).toEqual(['b', 'd', 'c'])
    })

    it('falls through to the view sort when weights tie', () => {
        const flat = cards.map((c) => ({ ...c, weight: 0, include: true }))
        const queue = buildTriageQueue(flat, rankOf, viewCompare)
        expect(queue.map((c) => c.id)).toEqual(['b', 'c', 'd', 'a'])
    })
})

describe('bumpEnumValue (issue #122)', () => {
    const values = ['10 - Top', '20 - High', '30 - Medium']

    it('steps toward the start with −1 and the end with +1', () => {
        expect(bumpEnumValue(values, '20 - High', -1)).toBe('10 - Top')
        expect(bumpEnumValue(values, '20 - High', 1)).toBe('30 - Medium')
    })

    it('clamps at the edges (returns the same value)', () => {
        expect(bumpEnumValue(values, '10 - Top', -1)).toBe('10 - Top')
        expect(bumpEnumValue(values, '30 - Medium', 1)).toBe('30 - Medium')
    })

    it('an unset or unknown current picks the first value', () => {
        expect(bumpEnumValue(values, null, 1)).toBe('10 - Top')
        expect(bumpEnumValue(values, 'stale', -1)).toBe('10 - Top')
    })

    it('null when there is nothing to select', () => {
        expect(bumpEnumValue([], null, 1)).toBeNull()
    })
})

describe('classifySwipe (issue #122)', () => {
    it('classifies by the dominant axis past the threshold', () => {
        expect(classifySwipe(150, 20, 110)).toBe('right')
        expect(classifySwipe(-150, 20, 110)).toBe('left')
        expect(classifySwipe(30, -140, 110)).toBe('up')
        expect(classifySwipe(30, 140, 110)).toBe('down')
    })

    it('null below the threshold', () => {
        expect(classifySwipe(50, 40, 110)).toBeNull()
        expect(classifySwipe(0, 0, 110)).toBeNull()
    })

    it('a tie goes to the horizontal axis', () => {
        expect(classifySwipe(120, 120, 110)).toBe('right')
    })
})

describe('pruneProcessedTriageQueue (processed cards leave the queue)', () => {
    const all = () => true
    const needs = (kept: string[]) => (key: string) => kept.includes(key)

    it('drops cards that no longer need triage, keeping the cursor on its card', () => {
        // a was processed and we moved on to b: a leaves, cursor still on b.
        const result = pruneProcessedTriageQueue(['a', 'b', 'c'], 1, all, needs(['b', 'c']))
        expect(result.queue).toEqual(['b', 'c'])
        expect(result.queue[result.index]).toBe('b')
    })

    it('never drops the card under the cursor, even once it is handled', () => {
        // The current card got its last value set — it stays until Next.
        const result = pruneProcessedTriageQueue(['a', 'b', 'c'], 1, all, needs(['a', 'c']))
        expect(result.queue).toEqual(['a', 'b', 'c'])
        expect(result.queue[result.index]).toBe('b')
    })

    it('drops processed cards behind AND ahead of the cursor', () => {
        const result = pruneProcessedTriageQueue(['a', 'b', 'c', 'd'], 2, all, needs(['c']))
        expect(result.queue).toEqual(['c'])
        expect(result.index).toBe(0)
    })

    it('still drops vanished cards, cursor card included', () => {
        const result = pruneProcessedTriageQueue(
            ['a', 'b', 'c'],
            1,
            (k) => k !== 'b',
            needs(['a', 'b', 'c'])
        )
        expect(result.queue).toEqual(['a', 'c'])
        expect(result.queue[result.index]).toBe('c')
    })

    it('past the end (all done) there is no cursor card to protect', () => {
        const result = pruneProcessedTriageQueue(['a', 'b'], 2, all, needs([]))
        expect(result.queue).toEqual([])
        expect(result.index).toBe(0)
    })
})

describe('pruneTriageQueue (issue #170 v2)', () => {
    const exists = (kept: string[]) => (key: string) => kept.includes(key)

    it('keeps the cursor on the same card when earlier cards vanish', () => {
        const result = pruneTriageQueue(['a', 'b', 'c', 'd'], 2, exists(['b', 'c', 'd']))
        expect(result.queue).toEqual(['b', 'c', 'd'])
        expect(result.queue[result.index]).toBe('c')
    })

    it('points at the follower when the current card vanishes', () => {
        const result = pruneTriageQueue(['a', 'b', 'c'], 1, exists(['a', 'c']))
        expect(result.queue).toEqual(['a', 'c'])
        expect(result.queue[result.index]).toBe('c')
    })

    it('handles everything vanishing (pass completes, never negative)', () => {
        const result = pruneTriageQueue(['a', 'b'], 1, () => false)
        expect(result.queue).toEqual([])
        expect(result.index).toBe(0)
    })

    it('is a no-op when nothing vanished', () => {
        const result = pruneTriageQueue(['a', 'b'], 1, exists(['a', 'b']))
        expect(result.queue).toEqual(['a', 'b'])
        expect(result.index).toBe(1)
    })

    it('removals after the cursor never move it', () => {
        const result = pruneTriageQueue(['a', 'b', 'c'], 0, exists(['a', 'b']))
        expect(result.index).toBe(0)
        expect(result.queue[result.index]).toBe('a')
    })
})
