import { describe, expect, it } from 'bun:test'
import {
    colorKey,
    cssColorLiteral,
    firstColorText,
    HEAT_COLORS,
    PALETTE_HUES,
    paletteColor,
    resolveValueColor
} from './card-color'

describe('cssColorLiteral', () => {
    it('accepts hex colors', () => {
        expect(cssColorLiteral('#f00')).toBe('#f00')
        expect(cssColorLiteral(' #FF8800 ')).toBe('#FF8800')
        expect(cssColorLiteral('#ff880080')).toBe('#ff880080')
        expect(cssColorLiteral('#ff88')).toBe('#ff88')
    })
    it('accepts functional notations', () => {
        expect(cssColorLiteral('rgb(255, 0, 0)')).toBe('rgb(255, 0, 0)')
        expect(cssColorLiteral('rgba(0 0 0 / 50%)')).toBe('rgba(0 0 0 / 50%)')
        expect(cssColorLiteral('hsl(120deg 50% 40%)')).toBe('hsl(120deg 50% 40%)')
        expect(cssColorLiteral('oklch(0.7 0.1 200)')).toBe('oklch(0.7 0.1 200)')
    })
    it('maps the basic hue names to theme variables, keeps other named colors', () => {
        expect(cssColorLiteral('Red')).toBe('var(--color-red)')
        expect(cssColorLiteral('purple')).toBe('var(--color-purple)')
        expect(cssColorLiteral('teal')).toBe('teal')
        expect(cssColorLiteral('RebeccaPurple')).toBe('rebeccapurple')
    })
    it('rejects anything else', () => {
        expect(cssColorLiteral('#ggg')).toBeNull()
        expect(cssColorLiteral('#12345')).toBeNull()
        expect(cssColorLiteral('High')).toBeNull()
        expect(cssColorLiteral('transparent')).toBeNull()
        expect(cssColorLiteral('rgb(var(--x))')).toBeNull()
        expect(cssColorLiteral('rgb(1,2,3); background: red')).toBeNull()
        expect(cssColorLiteral('url(x.png)')).toBeNull()
    })
})

describe('firstColorText', () => {
    it('trims strings and drops empties / "null"', () => {
        expect(firstColorText(' High ')).toBe('High')
        expect(firstColorText('')).toBeNull()
        expect(firstColorText('null')).toBeNull()
        expect(firstColorText(undefined)).toBeNull()
        expect(firstColorText(null)).toBeNull()
        expect(firstColorText({})).toBeNull()
    })
    it('stringifies numbers and booleans', () => {
        expect(firstColorText(3)).toBe('3')
        expect(firstColorText(false)).toBe('false')
    })
    it('takes the first usable list item', () => {
        expect(firstColorText(['', null, '[[Project A]]', '[[Project B]]'])).toBe('[[Project A]]')
        expect(firstColorText([])).toBeNull()
    })
})

describe('colorKey', () => {
    it('keys wikilinks by their target, case-insensitively', () => {
        expect(colorKey('[[Project X]]')).toBe('project x')
        expect(colorKey('[[Project X|PX]]')).toBe('project x')
        expect(colorKey('![[Project X#Goals]]')).toBe('project x')
        expect(colorKey(' Work ')).toBe('work')
    })
})

describe('paletteColor', () => {
    it('is stable and uses theme hue variables', () => {
        const color = paletteColor('Project A')
        expect(paletteColor('Project A')).toBe(color)
        expect(paletteColor('project a')).toBe(color)
        expect(paletteColor('[[Project A|A]]')).toBe(color)
        expect(PALETTE_HUES.map((h) => `var(--color-${h})`)).toContain(color)
    })
    it('spreads distinct values over several hues', () => {
        const values = ['home', 'work', 'errands', 'phone', 'computer', 'office', 'garden', 'car']
        expect(new Set(values.map(paletteColor)).size).toBeGreaterThan(3)
    })
})

describe('resolveValueColor', () => {
    const heat = (text: string): number | null =>
        ({ '10 - High': 0, '20 - Medium': 2, '30 - Low': 4 })[text] ?? null

    it('has no color for an empty value', () => {
        expect(resolveValueColor(null, heat)).toBeNull()
        expect(resolveValueColor('', heat)).toBeNull()
        expect(resolveValueColor([], heat)).toBeNull()
    })
    it('uses a CSS color value first (a formula can compute colors)', () => {
        expect(resolveValueColor('#22aa55', heat)).toBe('#22aa55')
        expect(resolveValueColor('green', heat)).toBe('var(--color-green)')
    })
    it('ranks enum values on the heat scale', () => {
        expect(resolveValueColor('10 - High', heat)).toBe(HEAT_COLORS[0] ?? '')
        expect(resolveValueColor('20 - Medium', heat)).toBe(HEAT_COLORS[2] ?? '')
        expect(resolveValueColor('30 - Low', heat)).toBe(HEAT_COLORS[4] ?? '')
    })
    it('falls back to a hashed palette color', () => {
        expect(resolveValueColor('Project A', heat)).toBe(paletteColor('Project A'))
        expect(resolveValueColor('Project A')).toBe(paletteColor('Project A'))
    })
    it('uses the first usable list item', () => {
        expect(resolveValueColor([null, '10 - High', '30 - Low'], heat)).toBe(HEAT_COLORS[0] ?? '')
    })
})
