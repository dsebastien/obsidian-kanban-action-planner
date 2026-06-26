import { describe, expect, it } from 'bun:test'
import { isBlocked, passesFilter } from './filtering'
import { emptyRelationshipSet } from './relationships'
import type { RelationshipSet } from './relationships'

function blocked(): RelationshipSet {
    return { ...emptyRelationshipSet(), blocked_by: ['x.md'] }
}

describe('isBlocked', () => {
    it('is true only when blocked_by is non-empty', () => {
        expect(isBlocked(blocked())).toBe(true)
        expect(isBlocked(emptyRelationshipSet())).toBe(false)
        expect(isBlocked(undefined)).toBe(false)
    })
})

describe('passesFilter', () => {
    it('all → every card passes', () => {
        expect(passesFilter(blocked(), { blocked: 'all' })).toBe(true)
        expect(passesFilter(emptyRelationshipSet(), { blocked: 'all' })).toBe(true)
    })

    it('only → just blocked cards pass', () => {
        expect(passesFilter(blocked(), { blocked: 'only' })).toBe(true)
        expect(passesFilter(emptyRelationshipSet(), { blocked: 'only' })).toBe(false)
    })

    it('hide → blocked cards are excluded', () => {
        expect(passesFilter(blocked(), { blocked: 'hide' })).toBe(false)
        expect(passesFilter(emptyRelationshipSet(), { blocked: 'hide' })).toBe(true)
    })
})
