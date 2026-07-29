import { describe, expect, test } from 'bun:test'
import { formatNaturalDatePreview, parseNaturalDate } from './natural-date'
import { toDateKey } from './calendar'

// Wednesday, mid-month, no DST edge. getDay() === 3.
const TODAY = new Date(2026, 6, 29)

function key(raw: string, firstDayOfWeek?: number): string | null {
    const parsed = parseNaturalDate(raw, TODAY, firstDayOfWeek)
    return parsed ? toDateKey(parsed) : null
}

describe('parseNaturalDate', () => {
    test('keywords', () => {
        expect(key('today')).toBe('2026-07-29')
        expect(key('tod')).toBe('2026-07-29')
        expect(key('Tomorrow')).toBe('2026-07-30')
        expect(key('tom')).toBe('2026-07-30')
        expect(key('tmr')).toBe('2026-07-30')
        expect(key('yesterday')).toBe('2026-07-28')
    })

    test('trims and collapses whitespace, case-insensitive', () => {
        expect(key('  TOMORROW  ')).toBe('2026-07-30')
        expect(key('in   3   days')).toBe('2026-08-01')
        expect(key('NEXT  MON')).toBe('2026-08-03')
    })

    test('bare weekday resolves to the next occurrence strictly after today', () => {
        expect(key('fri')).toBe('2026-07-31')
        expect(key('friday')).toBe('2026-07-31')
        expect(key('thu')).toBe('2026-07-30')
        expect(key('thurs')).toBe('2026-07-30')
        // Same weekday as today → next week, never day 0 ("today" covers that).
        expect(key('wed')).toBe('2026-08-05')
        // Weekday earlier in the week wraps forward.
        expect(key('mon')).toBe('2026-08-03')
        expect(key('sun')).toBe('2026-08-02')
    })

    test('next <weekday> lands in the week after the current week', () => {
        // Week starts Monday (default): current week is Jul 27–Aug 2.
        expect(key('next mon')).toBe('2026-08-03')
        expect(key('next fri')).toBe('2026-08-07')
        // Sunday belongs to the END of a Monday-first week.
        expect(key('next sun')).toBe('2026-08-09')
    })

    test('next <weekday> respects first day of week', () => {
        // Sunday-first: current week is Jul 26–Aug 1, next week starts Aug 2.
        expect(key('next sun', 0)).toBe('2026-08-02')
        expect(key('next mon', 0)).toBe('2026-08-03')
        expect(key('next sat', 0)).toBe('2026-08-08')
    })

    test('next week resolves to the first day of next week', () => {
        expect(key('next week')).toBe('2026-08-03')
        expect(key('next week', 0)).toBe('2026-08-02')
    })

    test('relative amounts: in N d/w/mo, +N, N<unit>', () => {
        expect(key('in 3 days')).toBe('2026-08-01')
        expect(key('in 3d')).toBe('2026-08-01')
        expect(key('in 3')).toBe('2026-08-01')
        expect(key('+3')).toBe('2026-08-01')
        expect(key('+2w')).toBe('2026-08-12')
        expect(key('3d')).toBe('2026-08-01')
        expect(key('2 weeks')).toBe('2026-08-12')
        expect(key('1wk')).toBe('2026-08-05')
        expect(key('in 1 mo')).toBe('2026-08-29')
        expect(key('2 months')).toBe('2026-09-29')
        expect(key('in 0 days')).toBe('2026-07-29')
    })

    test('month arithmetic clamps the day of month', () => {
        const jan31 = new Date(2026, 0, 31)
        const parsed = parseNaturalDate('in 1 mo', jan31)
        expect(parsed ? toDateKey(parsed) : null).toBe('2026-02-28')
    })

    test('explicit ISO dates pass through, invalid ones rejected', () => {
        expect(key('2026-12-24')).toBe('2026-12-24')
        expect(key('2026-02-31')).toBeNull()
        expect(key('2026-13-01')).toBeNull()
    })

    test('bare numbers and junk are rejected', () => {
        expect(key('')).toBeNull()
        expect(key('   ')).toBeNull()
        expect(key('15')).toBeNull()
        expect(key('next')).toBeNull()
        expect(key('next weekend')).toBeNull()
        expect(key('in x days')).toBeNull()
        expect(key('mo')).toBeNull()
        expect(key('soonish')).toBeNull()
        expect(key('in 3 hours')).toBeNull()
    })
})

describe('formatNaturalDatePreview', () => {
    test('shows weekday, date key and relative distance', () => {
        expect(formatNaturalDatePreview(new Date(2026, 7, 7), TODAY)).toBe(
            'Fri 2026-08-07 · in 9 days'
        )
        expect(formatNaturalDatePreview(new Date(2026, 6, 29), TODAY)).toBe(
            'Wed 2026-07-29 · today'
        )
        expect(formatNaturalDatePreview(new Date(2026, 6, 30), TODAY)).toBe(
            'Thu 2026-07-30 · tomorrow'
        )
        expect(formatNaturalDatePreview(new Date(2026, 6, 28), TODAY)).toBe(
            'Tue 2026-07-28 · yesterday'
        )
        expect(formatNaturalDatePreview(new Date(2026, 6, 20), TODAY)).toBe(
            'Mon 2026-07-20 · 9 days ago'
        )
    })
})
