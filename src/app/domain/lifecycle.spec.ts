import { describe, expect, test } from 'bun:test'
import { daysBetween, formatDays, lifecycleDays, parseDay } from './lifecycle'

const day = (y: number, m: number, d: number): Date => new Date(y, m - 1, d)

describe('parseDay', () => {
    test('a bare date is a local calendar day', () => {
        expect(parseDay('2026-09-09')).toEqual(day(2026, 9, 9))
    })

    test('a datetime keeps its local day', () => {
        expect(parseDay('2026-09-09T23:30:00')).toEqual(day(2026, 9, 9))
        expect(parseDay('2026-09-09T08:10:03.000+02:00')?.getFullYear()).toBe(2026)
    })

    test('blanks and junk are null', () => {
        expect(parseDay('')).toBeNull()
        expect(parseDay(null)).toBeNull()
        expect(parseDay('soon')).toBeNull()
        expect(parseDay(42)).toBeNull()
    })

    test('a Date passes through, truncated to its day', () => {
        expect(parseDay(new Date(2026, 8, 9, 15, 0))).toEqual(day(2026, 9, 9))
    })
})

describe('daysBetween', () => {
    test('whole days, signed', () => {
        expect(daysBetween(day(2026, 9, 1), day(2026, 9, 9))).toBe(8)
        expect(daysBetween(day(2026, 9, 9), day(2026, 9, 1))).toBe(-8)
        expect(daysBetween(day(2026, 9, 9), day(2026, 9, 9))).toBe(0)
    })

    test('null when a side is missing', () => {
        expect(daysBetween(null, day(2026, 9, 9))).toBeNull()
        expect(daysBetween(day(2026, 9, 9), null)).toBeNull()
    })

    test('a DST change does not shift the count', () => {
        // Europe: clocks change on the last Sunday of March.
        expect(daysBetween(day(2026, 3, 28), day(2026, 3, 30))).toBe(2)
    })
})

describe('lifecycleDays', () => {
    const today = day(2026, 9, 9)

    test('a done item: cycle, lead, lateness; no active count', () => {
        const days = lifecycleDays(
            {
                committed: day(2026, 8, 1),
                started: day(2026, 8, 11),
                due: day(2026, 9, 1),
                done: day(2026, 9, 3)
            },
            today
        )
        expect(days).toEqual({ cycle: 23, lead: 10, lateness: 2, active: null })
    })

    test('an open item: lead and days active only', () => {
        const days = lifecycleDays(
            {
                committed: day(2026, 8, 1),
                started: day(2026, 8, 30),
                due: day(2026, 9, 20),
                done: null
            },
            today
        )
        expect(days).toEqual({ cycle: null, lead: 29, lateness: null, active: 10 })
    })

    test('missing dates stay blank, never guessed', () => {
        const done = lifecycleDays(
            { committed: null, started: null, due: null, done: day(2026, 9, 3) },
            today
        )
        expect(done).toEqual({ cycle: null, lead: null, lateness: null, active: null })
        const open = lifecycleDays({ committed: null, started: null, due: null, done: null }, today)
        expect(open).toEqual({ cycle: null, lead: null, lateness: null, active: null })
    })

    test('an early finish has a negative lateness', () => {
        const days = lifecycleDays(
            {
                committed: null,
                started: day(2026, 9, 1),
                due: day(2026, 9, 10),
                done: day(2026, 9, 5)
            },
            today
        )
        expect(days.lateness).toBe(-5)
        expect(days.cycle).toBe(4)
    })
})

describe('formatDays', () => {
    test('suffixes days, blank for null', () => {
        expect(formatDays(12)).toBe('12d')
        expect(formatDays(-3)).toBe('-3d')
        expect(formatDays(0)).toBe('0d')
        expect(formatDays(null)).toBe('')
    })
})
