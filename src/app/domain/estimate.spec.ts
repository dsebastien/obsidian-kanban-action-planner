import { describe, expect, test } from 'bun:test'
import { daysToUnit, formatDaysLabel, formatUnitValue, readEstimate } from './estimate'

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
