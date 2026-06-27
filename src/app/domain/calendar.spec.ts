import { describe, expect, test } from 'bun:test'
import {
    addDays,
    bucketByDay,
    buildCalendar,
    formatLongDate,
    monthBlock,
    parseFrontmatterDate,
    shiftAnchor,
    startOfWeek,
    toDateKey,
    weekBlock,
    weekdayLabels
} from './calendar'

const TODAY = new Date(2026, 5, 26) // Fri 2026-06-26

describe('toDateKey', () => {
    test('local YYYY-MM-DD, zero-padded', () => {
        expect(toDateKey(new Date(2026, 0, 3))).toBe('2026-01-03')
        expect(toDateKey(new Date(2026, 11, 31))).toBe('2026-12-31')
    })
})

describe('startOfWeek', () => {
    test('defaults to the Monday on/before the date', () => {
        expect(toDateKey(startOfWeek(new Date(2026, 5, 26)))).toBe('2026-06-22') // Fri → Mon
        expect(toDateKey(startOfWeek(new Date(2026, 5, 22)))).toBe('2026-06-22') // Mon → itself
        expect(toDateKey(startOfWeek(new Date(2026, 5, 28)))).toBe('2026-06-22') // Sun → prev Mon
    })
    test('honours a configurable first day (Sunday = 0)', () => {
        expect(toDateKey(startOfWeek(new Date(2026, 5, 26), 0))).toBe('2026-06-21') // Fri → Sun
        expect(toDateKey(startOfWeek(new Date(2026, 5, 21), 0))).toBe('2026-06-21') // Sun → itself
        expect(toDateKey(startOfWeek(new Date(2026, 5, 27), 0))).toBe('2026-06-21') // Sat → prev Sun
    })
    test('honours Saturday (6) as first day', () => {
        expect(toDateKey(startOfWeek(new Date(2026, 5, 26), 6))).toBe('2026-06-20') // Fri → Sat
    })
})

describe('weekdayLabels', () => {
    test('orders weekday headers from the first day', () => {
        expect(weekdayLabels(1)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
        expect(weekdayLabels(0)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
        expect(weekdayLabels(6)).toEqual(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
    })
})

describe('parseFrontmatterDate', () => {
    test('parses YYYY-MM-DD as a local date (no UTC shift)', () => {
        const d = parseFrontmatterDate('2026-07-01')
        expect(d && toDateKey(d)).toBe('2026-07-01')
    })
    test('uses the date part of a datetime string', () => {
        const d = parseFrontmatterDate('2026-07-01T13:45:00')
        expect(d && toDateKey(d)).toBe('2026-07-01')
    })
    test('accepts a Date and strips time', () => {
        const d = parseFrontmatterDate(new Date(2026, 6, 1, 9, 30))
        expect(d && toDateKey(d)).toBe('2026-07-01')
    })
    test('rejects blank / non-date values', () => {
        expect(parseFrontmatterDate('')).toBeNull()
        expect(parseFrontmatterDate('  ')).toBeNull()
        expect(parseFrontmatterDate(42)).toBeNull()
        expect(parseFrontmatterDate(null)).toBeNull()
        expect(parseFrontmatterDate('not a date')).toBeNull()
    })
})

describe('monthBlock', () => {
    const block = monthBlock(2026, 5, TODAY) // June 2026
    test('labels the month and is 6×7', () => {
        expect(block.label).toBe('June 2026')
        expect(block.weeks).toHaveLength(6)
        expect(block.weeks.every((w) => w.length === 7)).toBe(true)
    })
    test('starts on the Monday of the first week and marks spill days', () => {
        const first = block.weeks[0]?.[0]
        expect(first?.key).toBe('2026-06-01') // June 1 2026 is a Monday
        expect(first?.inCurrentMonth).toBe(true)
        const lastWeek = block.weeks[5]
        expect(lastWeek?.some((d) => !d.inCurrentMonth)).toBe(true) // July spill
    })
    test('marks today', () => {
        const todays = block.weeks.flat().filter((d) => d.isToday)
        expect(todays).toHaveLength(1)
        expect(todays[0]?.key).toBe('2026-06-26')
    })
})

describe('weekBlock', () => {
    test('one Monday→Sunday week containing the anchor (default)', () => {
        const block = weekBlock(TODAY, TODAY)
        expect(block.weeks).toHaveLength(1)
        const days = block.weeks[0] ?? []
        expect(days[0]?.key).toBe('2026-06-22')
        expect(days[6]?.key).toBe('2026-06-28')
    })
    test('Sunday-first week shifts the bounds', () => {
        const days = weekBlock(TODAY, TODAY, 0).weeks[0] ?? []
        expect(days[0]?.key).toBe('2026-06-21') // Sunday
        expect(days[6]?.key).toBe('2026-06-27') // Saturday
    })
})

describe('buildCalendar', () => {
    test('week → 1 block, month → 1, quarter → 3, year → 12', () => {
        expect(buildCalendar(TODAY, 'week', TODAY)).toHaveLength(1)
        expect(buildCalendar(TODAY, 'month', TODAY)).toHaveLength(1)
        expect(buildCalendar(TODAY, 'quarter', TODAY)).toHaveLength(3)
        expect(buildCalendar(TODAY, 'year', TODAY)).toHaveLength(12)
    })
    test('quarter blocks are the anchor quarter (Apr–Jun for June)', () => {
        const blocks = buildCalendar(TODAY, 'quarter', TODAY)
        expect(blocks.map((b) => b.label)).toEqual(['April 2026', 'May 2026', 'June 2026'])
    })
})

describe('shiftAnchor', () => {
    test('steps by the range unit', () => {
        expect(toDateKey(shiftAnchor(TODAY, 'week', 1))).toBe('2026-07-03')
        expect(toDateKey(shiftAnchor(TODAY, 'week', -1))).toBe('2026-06-19')
        expect(toDateKey(shiftAnchor(TODAY, 'month', 1))).toBe('2026-07-26')
        expect(toDateKey(shiftAnchor(TODAY, 'quarter', 1))).toBe('2026-09-26')
        expect(toDateKey(shiftAnchor(TODAY, 'year', -1))).toBe('2025-06-26')
    })
})

describe('formatLongDate', () => {
    test('weekday, month day, year', () => {
        expect(formatLongDate(new Date(2026, 5, 18))).toBe('Thursday, June 18, 2026')
        expect(formatLongDate(new Date(2026, 0, 1))).toBe('Thursday, January 1, 2026')
    })
})

describe('addDays', () => {
    test('shifts by n days and strips time', () => {
        expect(toDateKey(addDays(new Date(2026, 5, 18, 9, 30), 1))).toBe('2026-06-19')
        expect(toDateKey(addDays(new Date(2026, 5, 1), -1))).toBe('2026-05-31')
    })
})

describe('bucketByDay', () => {
    test('groups items by local day key, skipping null dates', () => {
        const items = [
            { id: 'a', d: new Date(2026, 6, 1) },
            { id: 'b', d: new Date(2026, 6, 1) },
            { id: 'c', d: null },
            { id: 'e', d: new Date(2026, 6, 2) }
        ]
        const map = bucketByDay(items, (i) => i.d)
        expect(map.get('2026-07-01')?.map((i) => i.id)).toEqual(['a', 'b'])
        expect(map.get('2026-07-02')?.map((i) => i.id)).toEqual(['e'])
        expect(map.has('null')).toBe(false)
        expect([...map.keys()]).toHaveLength(2)
    })
})
