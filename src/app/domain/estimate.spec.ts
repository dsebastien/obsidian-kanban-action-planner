import { describe, expect, test } from 'bun:test'
import {
    daysToUnit,
    formatDaysLabel,
    formatUnitValue,
    parseEstimateInput,
    readEstimate
} from './estimate'

describe('readEstimate', () => {
    test('days keep the historical semantics: ceil, minimum 1', () => {
        expect(readEstimate(3, 'days', 480)).toEqual({
            days: 3,
            spanDays: 3,
            raw: 3,
            label: '3d'
        })
        expect(readEstimate(2.2, 'days', 480)?.days).toBe(3)
        expect(readEstimate('4', 'days', 480)?.days).toBe(4)
        expect(readEstimate(0, 'days', 480)).toBeNull()
        expect(readEstimate('', 'days', 480)).toBeNull()
        expect(readEstimate(undefined, 'days', 480)).toBeNull()
    })

    test('minutes convert to fractional days via minutesPerDay', () => {
        const r = readEstimate(90, 'minutes', 480)
        expect(r?.days).toBeCloseTo(0.1875)
        expect(r?.spanDays).toBe(1)
        expect(r?.raw).toBe(90)
        expect(r?.label).toBe('1h 30m')
    })

    test('minutes exceeding a day span whole days for geometry', () => {
        const r = readEstimate(960, 'minutes', 480)
        expect(r?.days).toBe(2)
        expect(r?.spanDays).toBe(2)
        expect(r?.label).toBe('16h')
    })

    test('minutes below 1 are rejected; strings parse', () => {
        expect(readEstimate(0, 'minutes', 480)).toBeNull()
        expect(readEstimate('45', 'minutes', 480)?.label).toBe('45m')
    })

    test('a zero/negative minutesPerDay never divides by zero', () => {
        expect(readEstimate(90, 'minutes', 0)?.days).toBe(90)
    })
})

describe('formatting', () => {
    test('formatDaysLabel: whole days plain, fractional to one decimal', () => {
        expect(formatDaysLabel(3)).toBe('3d')
        expect(formatDaysLabel(1.1875)).toBe('1.2d')
        expect(formatDaysLabel(0.96)).toBe('1d')
    })

    test('formatUnitValue minutes: m / h / h m', () => {
        expect(formatUnitValue(45, 'minutes')).toBe('45m')
        expect(formatUnitValue(60, 'minutes')).toBe('1h')
        expect(formatUnitValue(150, 'minutes')).toBe('2h 30m')
    })
})

describe('daysToUnit', () => {
    test('days round to whole days, minimum 1', () => {
        expect(daysToUnit(2.4, 'days', 480)).toBe(2)
        expect(daysToUnit(0.2, 'days', 480)).toBe(1)
    })

    test('minutes convert through minutesPerDay, minimum 1', () => {
        expect(daysToUnit(0.5, 'minutes', 480)).toBe(240)
        expect(daysToUnit(2, 'minutes', 480)).toBe(960)
        expect(daysToUnit(0.001, 'minutes', 480)).toBe(1)
    })
})

describe('parseEstimateInput', () => {
    test('bare numbers stay in the target unit (historical rounding)', () => {
        expect(parseEstimateInput('120', 'minutes', 480)).toBe(120)
        expect(parseEstimateInput('3', 'days', 480)).toBe(3)
        expect(parseEstimateInput('2.2', 'days', 480)).toBe(3)
        expect(parseEstimateInput('0', 'days', 480)).toBeNull()
    })

    test('hour/minute suffixes convert to a minutes target', () => {
        expect(parseEstimateInput('2h', 'minutes', 480)).toBe(120)
        expect(parseEstimateInput('120m', 'minutes', 480)).toBe(120)
        expect(parseEstimateInput('1.5h', 'minutes', 480)).toBe(90)
        expect(parseEstimateInput('1,5h', 'minutes', 480)).toBe(90)
    })

    test('day suffix converts via minutesPerDay', () => {
        expect(parseEstimateInput('0.5d', 'minutes', 480)).toBe(240)
        expect(parseEstimateInput('0.5d', 'minutes', 600)).toBe(300)
        expect(parseEstimateInput('2d', 'minutes', 480)).toBe(960)
    })

    test('suffixed input on a days target rounds up to whole days', () => {
        expect(parseEstimateInput('4h', 'days', 480)).toBe(1)
        expect(parseEstimateInput('12h', 'days', 480)).toBe(2)
        expect(parseEstimateInput('0.5d', 'days', 480)).toBe(1)
        expect(parseEstimateInput('3d', 'days', 480)).toBe(3)
    })

    test('tokens combine, with or without spaces', () => {
        expect(parseEstimateInput('1h 30m', 'minutes', 480)).toBe(90)
        expect(parseEstimateInput('1h30m', 'minutes', 480)).toBe(90)
        expect(parseEstimateInput('1d 4h', 'minutes', 480)).toBe(720)
        expect(parseEstimateInput('1D 4H', 'minutes', 480)).toBe(720)
    })

    test('unrecognized input is rejected', () => {
        expect(parseEstimateInput('', 'minutes', 480)).toBeNull()
        expect(parseEstimateInput('abc', 'minutes', 480)).toBeNull()
        expect(parseEstimateInput('2x', 'minutes', 480)).toBeNull()
        expect(parseEstimateInput('h', 'minutes', 480)).toBeNull()
        expect(parseEstimateInput('-2h', 'minutes', 480)).toBeNull()
    })
})
