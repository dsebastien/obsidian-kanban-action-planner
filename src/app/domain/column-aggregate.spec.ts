import { describe, expect, it } from 'bun:test'
import {
    aggregatePrefix,
    computeAggregate,
    formatAggregateLabel,
    formatAggregateNumber,
    readAggregateKind,
    toAggregateNumber
} from './column-aggregate'

describe('readAggregateKind (issue #23)', () => {
    it('accepts the known kinds', () => {
        expect(readAggregateKind('sum')).toBe('sum')
        expect(readAggregateKind('avg')).toBe('avg')
        expect(readAggregateKind('min')).toBe('min')
        expect(readAggregateKind('max')).toBe('max')
        expect(readAggregateKind('none')).toBe('none')
    })

    it('falls back to none for anything else', () => {
        expect(readAggregateKind(undefined)).toBe('none')
        expect(readAggregateKind(null)).toBe('none')
        expect(readAggregateKind('median')).toBe('none')
        expect(readAggregateKind(3)).toBe('none')
    })
})

describe('toAggregateNumber (issue #23)', () => {
    it('keeps finite numbers, including negatives and fractions', () => {
        expect(toAggregateNumber(13)).toBe(13)
        expect(toAggregateNumber(-2)).toBe(-2)
        expect(toAggregateNumber(1.5)).toBe(1.5)
        expect(toAggregateNumber(0)).toBe(0)
    })

    it('parses numeric strings', () => {
        expect(toAggregateNumber('13')).toBe(13)
        expect(toAggregateNumber(' 4.5 ')).toBe(4.5)
    })

    it('ignores everything non-numeric', () => {
        expect(toAggregateNumber('high')).toBeNull()
        expect(toAggregateNumber('')).toBeNull()
        expect(toAggregateNumber('   ')).toBeNull()
        expect(toAggregateNumber(null)).toBeNull()
        expect(toAggregateNumber(undefined)).toBeNull()
        expect(toAggregateNumber(Number.NaN)).toBeNull()
        expect(toAggregateNumber(Number.POSITIVE_INFINITY)).toBeNull()
        expect(toAggregateNumber([1, 2])).toBeNull()
    })

    it('does not treat booleans as numbers', () => {
        expect(toAggregateNumber(true)).toBeNull()
        expect(toAggregateNumber(false)).toBeNull()
    })
})

describe('computeAggregate (issue #23)', () => {
    const values = [3, null, 5, 8, null]

    it('sums, averages, mins and maxes over the numeric values only', () => {
        expect(computeAggregate(values, 'sum')).toBe(16)
        expect(computeAggregate(values, 'avg')).toBe(16 / 3)
        expect(computeAggregate(values, 'min')).toBe(3)
        expect(computeAggregate(values, 'max')).toBe(8)
    })

    it('returns null for the none kind', () => {
        expect(computeAggregate(values, 'none')).toBeNull()
    })

    it('returns null when nothing numeric remains', () => {
        expect(computeAggregate([], 'sum')).toBeNull()
        expect(computeAggregate([null, null], 'sum')).toBeNull()
        expect(computeAggregate([null], 'avg')).toBeNull()
    })

    it('counts zeros as values rather than nothing', () => {
        expect(computeAggregate([0, 0], 'sum')).toBe(0)
        expect(computeAggregate([0, 4], 'avg')).toBe(2)
        expect(computeAggregate([0, 4], 'min')).toBe(0)
    })

    it('handles negatives', () => {
        expect(computeAggregate([-5, 3], 'sum')).toBe(-2)
        expect(computeAggregate([-5, 3], 'min')).toBe(-5)
        expect(computeAggregate([-5, 3], 'max')).toBe(3)
    })

    it('does not blow the stack on a large column', () => {
        const many = Array.from({ length: 200_000 }, (_, i) => i)
        expect(computeAggregate(many, 'max')).toBe(199_999)
        expect(computeAggregate(many, 'min')).toBe(0)
    })
})

describe('formatAggregateNumber (issue #23)', () => {
    it('keeps integers bare', () => {
        expect(formatAggregateNumber(13)).toBe('13')
        expect(formatAggregateNumber(0)).toBe('0')
        expect(formatAggregateNumber(-4)).toBe('-4')
    })

    it('rounds fractions to at most two decimals without trailing zeros', () => {
        expect(formatAggregateNumber(4.5)).toBe('4.5')
        expect(formatAggregateNumber(16 / 3)).toBe('5.33')
        expect(formatAggregateNumber(2.999)).toBe('3')
    })

    it('rounds half-way values as binary floats do (display-only precision)', () => {
        // 1.005 is really 1.00499...; the badge is a scannable roll-up, not an
        // accounting figure, so this is documented rather than corrected.
        expect(formatAggregateNumber(1.005)).toBe('1')
        expect(formatAggregateNumber(1.015)).toBe('1.01')
    })
})

describe('aggregatePrefix (issue #23)', () => {
    it('uses the sum sign and spells the rest out', () => {
        expect(aggregatePrefix('sum')).toBe('Σ')
        expect(aggregatePrefix('avg')).toBe('avg')
        expect(aggregatePrefix('min')).toBe('min')
        expect(aggregatePrefix('max')).toBe('max')
        expect(aggregatePrefix('none')).toBe('')
    })
})

describe('formatAggregateLabel (issue #23)', () => {
    it('joins the prefix and the formatted value', () => {
        expect(formatAggregateLabel('sum', 13)).toBe('Σ 13')
        expect(formatAggregateLabel('avg', 16 / 3)).toBe('avg 5.33')
    })

    it('returns null when there is nothing to show', () => {
        expect(formatAggregateLabel('sum', null)).toBeNull()
        expect(formatAggregateLabel('none', 13)).toBeNull()
    })

    it('renders through an injected formatter (estimate durations)', () => {
        const asDuration = (days: number): string => `${String(days)}d`
        expect(formatAggregateLabel('sum', 3, asDuration)).toBe('Σ 3d')
    })
})
