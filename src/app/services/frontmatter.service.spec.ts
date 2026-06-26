import { describe, expect, it } from 'bun:test'
import { coerceOrder, findKeyCaseInsensitive } from './frontmatter.service'

describe('findKeyCaseInsensitive', () => {
    it('returns the exact key when present', () => {
        expect(findKeyCaseInsensitive({ status: 'x' }, 'status')).toBe('status')
    })

    it('matches a differently-cased key', () => {
        expect(findKeyCaseInsensitive({ Status: 'x' }, 'status')).toBe('Status')
        expect(findKeyCaseInsensitive({ MANUAL_ORDER: 1 }, 'manual_order')).toBe('MANUAL_ORDER')
    })

    it('returns null when absent or object is nullish', () => {
        expect(findKeyCaseInsensitive({ a: 1 }, 'status')).toBeNull()
        expect(findKeyCaseInsensitive(null, 'status')).toBeNull()
        expect(findKeyCaseInsensitive(undefined, 'status')).toBeNull()
    })
})

describe('coerceOrder', () => {
    it('passes through finite numbers', () => {
        expect(coerceOrder(1.5)).toBe(1.5)
        expect(coerceOrder(0)).toBe(0)
    })

    it('parses numeric strings', () => {
        expect(coerceOrder('12')).toBe(12)
        expect(coerceOrder('3.25')).toBe(3.25)
    })

    it('rejects non-numeric / nullish / infinite', () => {
        expect(coerceOrder('abc')).toBeNull()
        expect(coerceOrder('')).toBeNull()
        expect(coerceOrder(null)).toBeNull()
        expect(coerceOrder(undefined)).toBeNull()
        expect(coerceOrder(Infinity)).toBeNull()
    })
})
