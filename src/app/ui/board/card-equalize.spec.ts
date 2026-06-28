import { test, expect, describe } from 'bun:test'
import { uniformCardHeight } from './card-equalize'

describe('uniformCardHeight', () => {
    test('returns the tallest height', () => {
        expect(uniformCardHeight([44, 120, 72])).toBe(120)
    })

    test('returns null for an empty set (nothing to size)', () => {
        expect(uniformCardHeight([])).toBeNull()
    })

    test('returns null when every card measures zero (all hidden)', () => {
        expect(uniformCardHeight([0, 0, 0])).toBeNull()
    })

    test('ignores zero-height (collapsed/hidden) cards when picking the max', () => {
        expect(uniformCardHeight([0, 88, 0])).toBe(88)
    })

    test('handles a single card', () => {
        expect(uniformCardHeight([56])).toBe(56)
    })
})
