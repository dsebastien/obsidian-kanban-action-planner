import { describe, expect, it } from 'bun:test'
import {
    PALETTE,
    autoAssignColor,
    columnShade,
    isValidHex,
    paletteTokens,
    resolveColor
} from './colors.service'

describe('resolveColor', () => {
    it('resolves a palette token to its color', () => {
        expect(resolveColor({ kind: 'palette', token: 'blue' })).toBe('#4c78dd')
        expect(PALETTE['blue']).toBe('#4c78dd')
    })

    it('passes through a hex color', () => {
        expect(resolveColor({ kind: 'hex', value: '#abcdef' })).toBe('#abcdef')
    })

    it('falls back to a neutral for unknown tokens', () => {
        expect(resolveColor({ kind: 'palette', token: 'nope' })).toBe('var(--text-muted)')
    })
})

describe('autoAssignColor', () => {
    it('is deterministic for a given value', () => {
        expect(autoAssignColor('Doing')).toEqual(autoAssignColor('Doing'))
    })

    it('only ever assigns valid palette tokens', () => {
        const tokens = new Set(paletteTokens())
        for (const v of ['a', 'Todo', '10 Todo', 'long status value', 'X']) {
            const spec = autoAssignColor(v)
            expect(spec.kind).toBe('palette')
            if (spec.kind === 'palette') expect(tokens.has(spec.token)).toBe(true)
        }
    })
})

describe('columnShade', () => {
    it('builds a color-mix over the theme background', () => {
        expect(columnShade('#4c78dd')).toBe(
            'color-mix(in srgb, #4c78dd 14%, var(--background-primary))'
        )
    })
})

describe('isValidHex', () => {
    it('accepts 3- and 6-digit hex', () => {
        expect(isValidHex('#abc')).toBe(true)
        expect(isValidHex('#aabbcc')).toBe(true)
    })

    it('rejects malformed values', () => {
        expect(isValidHex('abc')).toBe(false)
        expect(isValidHex('#xyz')).toBe(false)
        expect(isValidHex('#aabb')).toBe(false)
    })
})
