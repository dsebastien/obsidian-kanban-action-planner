import { describe, expect, it } from 'bun:test'
import {
    computeDueState,
    heatLevel,
    parseEnumPrefix,
    parseProgressField,
    stripEnumPrefix
} from './card-display.service'

const TODAY = new Date(2026, 5, 28)

describe('computeDueState (issue #22)', () => {
    it('is "none" with no due date', () => {
        expect(computeDueState(null, TODAY)).toBe('none')
    })

    it('is "overdue" strictly before today', () => {
        expect(computeDueState(new Date(2026, 5, 27), TODAY)).toBe('overdue')
        expect(computeDueState(new Date(2026, 4, 1), TODAY)).toBe('overdue')
    })

    it('is "today" on the same day (ignores time of day)', () => {
        expect(computeDueState(new Date(2026, 5, 28), TODAY)).toBe('today')
        expect(computeDueState(new Date(2026, 5, 28, 23, 59), TODAY)).toBe('today')
    })

    it('is "none" in the future', () => {
        expect(computeDueState(new Date(2026, 5, 29), TODAY)).toBe('none')
    })
})

describe('parseProgressField', () => {
    it('detects percentage-like labels and clamps to 0–100', () => {
        expect(parseProgressField('Progress %', '0')).toBe(0)
        expect(parseProgressField('Progress %', '45')).toBe(45)
        expect(parseProgressField('Progress', '100')).toBe(100)
        expect(parseProgressField('Progress %', '45%')).toBe(45)
        expect(parseProgressField('Progress %', '150')).toBe(100)
        expect(parseProgressField('Progress %', '-10')).toBe(0)
    })

    it('returns null when the label is not progress/percentage', () => {
        expect(parseProgressField('Priority Score', '13')).toBeNull()
        expect(parseProgressField('Urgency', '20 - Soon')).toBeNull()
        expect(parseProgressField(null, '50')).toBeNull()
    })

    it('returns null when the value is not numeric', () => {
        expect(parseProgressField('Progress %', 'n/a')).toBeNull()
        expect(parseProgressField('Progress %', '')).toBeNull()
    })
})

describe('stripEnumPrefix', () => {
    it('strips a leading NN - prefix, keeps the label', () => {
        expect(stripEnumPrefix('30 - High')).toBe('High')
        expect(stripEnumPrefix('99 - ⏰ No Target')).toBe('⏰ No Target')
        expect(stripEnumPrefix('10 - Now')).toBe('Now')
    })

    it('leaves non-prefixed values untouched', () => {
        expect(stripEnumPrefix('High')).toBe('High')
        expect(stripEnumPrefix('2026-01-15')).toBe('2026-01-15')
        expect(stripEnumPrefix('13')).toBe('13')
    })
})

describe('parseEnumPrefix', () => {
    it('reads the leading integer of an NN - value', () => {
        expect(parseEnumPrefix('30 - High')).toBe(30)
        expect(parseEnumPrefix('99 - TBD')).toBe(99)
    })
    it('is null without a prefix', () => {
        expect(parseEnumPrefix('High')).toBeNull()
        expect(parseEnumPrefix('2026-01-15')).toBeNull()
    })
})

describe('heatLevel', () => {
    const priority = [
        '99 - TBD',
        '10 - Top',
        '20 - Very High',
        '30 - High',
        '40 - Medium',
        '50 - Low',
        '60 - Very Low'
    ]

    it('ranks by prefix regardless of allowed-list order (warm=low, cool=high)', () => {
        expect(heatLevel('10 - Top', priority)).toBe(0) // lowest prefix → warmest
        expect(heatLevel('99 - TBD', priority)).toBe(4) // highest prefix → coolest
        const high = heatLevel('30 - High', priority)
        expect(high).not.toBeNull()
        expect(high).toBeGreaterThan(0)
        expect(high).toBeLessThan(4)
    })

    it('is null when the value has no prefix or the scale is too small', () => {
        expect(heatLevel('High', priority)).toBeNull()
        expect(heatLevel('10 - Top', ['10 - Top'])).toBeNull()
        expect(heatLevel('10 - Top', [])).toBeNull()
    })
})
