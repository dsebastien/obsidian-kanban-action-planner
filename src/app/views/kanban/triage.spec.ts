import { describe, expect, it } from 'bun:test'
import { buildTriageQueue, isPropUnset, unsetCount } from './triage'

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

describe('buildTriageQueue (issue #53)', () => {
    type Card = { id: string; unset: number; sort: number }
    const cards: Card[] = [
        { id: 'a', unset: 0, sort: 3 },
        { id: 'b', unset: 2, sort: 1 },
        { id: 'c', unset: 1, sort: 2 },
        { id: 'd', unset: 2, sort: 2 }
    ]
    const unsetOf = (c: Card): number => c.unset
    const viewCompare = (a: Card, b: Card): number => a.sort - b.sort

    it('clarify scope keeps only unclarified cards, worst-first then view sort', () => {
        const queue = buildTriageQueue(cards, 'clarify', unsetOf, viewCompare)
        // unset desc: b(2,sort1), d(2,sort2), c(1); a(0) dropped.
        expect(queue.map((c) => c.id)).toEqual(['b', 'd', 'c'])
    })

    it('all scope keeps every card, worst-first then view sort', () => {
        const queue = buildTriageQueue(cards, 'all', unsetOf, viewCompare)
        // unset desc then sort asc: b(2,1), d(2,2), c(1,2), a(0,3)
        expect(queue.map((c) => c.id)).toEqual(['b', 'd', 'c', 'a'])
    })

    it('falls through to the view sort when nothing is unset (all scope)', () => {
        const flat = cards.map((c) => ({ ...c, unset: 0 }))
        const queue = buildTriageQueue(flat, 'all', unsetOf, viewCompare)
        expect(queue.map((c) => c.id)).toEqual(['b', 'c', 'd', 'a'])
    })
})
