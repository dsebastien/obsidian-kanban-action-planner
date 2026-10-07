import { describe, expect, test } from 'bun:test'
import {
    buildTimeEntry,
    clipEntryMinutes,
    minutesInRange,
    entryMinutes,
    formatEntryDate,
    formatEntryDateTime,
    latestEntryDate,
    parseEntryDateTime,
    parseTimeEntries,
    durationAfterEntryChange,
    numericDuration,
    readTrackedMinutes,
    sumEntryMinutes,
    withEntryDescription
} from './time-entries'
import type { TimeEntry } from './time-entries'

const local = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Date =>
    new Date(y, mo - 1, d, h, mi, s)

describe('formatEntryDateTime / parseEntryDateTime (issue #172)', () => {
    test('writes a local ISO datetime without offset, TaskNotes-style', () => {
        expect(formatEntryDateTime(local(2026, 9, 9, 14, 5, 7))).toBe('2026-09-09T14:05:07')
        expect(formatEntryDate(local(2026, 1, 3))).toBe('2026-01-03')
    })

    test('round-trips through parse as local time', () => {
        const date = local(2026, 9, 9, 23, 58, 0)
        expect(parseEntryDateTime(formatEntryDateTime(date))?.getTime()).toBe(date.getTime())
    })

    test('rejects blanks and garbage', () => {
        expect(parseEntryDateTime('')).toBeNull()
        expect(parseEntryDateTime('soon')).toBeNull()
        expect(parseEntryDateTime(42)).toBeNull()
        expect(parseEntryDateTime(undefined)).toBeNull()
    })
})

describe('parseTimeEntries (issue #172)', () => {
    test('keeps well-formed entries and drops malformed ones', () => {
        const entries = parseTimeEntries([
            { startTime: '2026-09-09T09:00:00', endTime: '2026-09-09T09:30:00', description: 'x' },
            { startTime: '2026-09-09T10:00:00' }, // open entry
            { endTime: '2026-09-09T11:00:00' }, // no start
            'nope',
            null,
            { startTime: '' }
        ])
        expect(entries).toEqual([
            { startTime: '2026-09-09T09:00:00', endTime: '2026-09-09T09:30:00', description: 'x' },
            { startTime: '2026-09-09T10:00:00' }
        ])
    })

    test('a non-list (unset, null, scalar) is no entries', () => {
        expect(parseTimeEntries(undefined)).toEqual([])
        expect(parseTimeEntries(null)).toEqual([])
        expect(parseTimeEntries(90)).toEqual([])
    })
})

describe('entryMinutes / sumEntryMinutes (issue #172)', () => {
    test('rounds a closed entry to whole minutes, at least one', () => {
        expect(
            entryMinutes({ startTime: '2026-09-09T09:00:00', endTime: '2026-09-09T09:30:00' })
        ).toBe(30)
        expect(
            entryMinutes({ startTime: '2026-09-09T09:00:00', endTime: '2026-09-09T09:00:20' })
        ).toBe(1)
        expect(
            entryMinutes({ startTime: '2026-09-09T09:00:00', endTime: '2026-09-09T09:01:40' })
        ).toBe(2)
    })

    test('a session crossing midnight is plain subtraction', () => {
        expect(
            entryMinutes({ startTime: '2026-09-09T23:30:00', endTime: '2026-09-10T00:45:00' })
        ).toBe(75)
    })

    test('open, reversed, and unparsable entries contribute nothing', () => {
        expect(entryMinutes({ startTime: '2026-09-09T09:00:00' })).toBeNull()
        expect(
            entryMinutes({ startTime: '2026-09-09T09:30:00', endTime: '2026-09-09T09:00:00' })
        ).toBeNull()
        expect(entryMinutes({ startTime: 'x', endTime: 'y' })).toBeNull()
        expect(
            sumEntryMinutes([
                { startTime: '2026-09-09T09:00:00', endTime: '2026-09-09T09:30:00' },
                { startTime: '2026-09-09T10:00:00' },
                { startTime: '2026-09-09T11:00:00', endTime: '2026-09-09T11:15:00' }
            ])
        ).toBe(45)
    })
})

describe('latestEntryDate (issue #172)', () => {
    test('is the local day of the latest end time, whatever the list order', () => {
        expect(
            latestEntryDate([
                { startTime: '2026-09-10T09:00:00', endTime: '2026-09-10T09:30:00' },
                { startTime: '2026-09-03T09:00:00', endTime: '2026-09-03T09:30:00' }
            ])
        ).toBe('2026-09-10')
    })

    test('an open entry counts by its start; a midnight crosser by its end day', () => {
        expect(latestEntryDate([{ startTime: '2026-09-12T22:00:00' }])).toBe('2026-09-12')
        expect(
            latestEntryDate([{ startTime: '2026-09-09T23:30:00', endTime: '2026-09-10T00:45:00' }])
        ).toBe('2026-09-10')
    })

    test('null without entries', () => {
        expect(latestEntryDate([])).toBeNull()
    })
})

describe('buildTimeEntry (issue #172)', () => {
    test('formats both ends locally with an empty description by default', () => {
        const start = local(2026, 9, 9, 9, 0, 0).getTime()
        const end = local(2026, 9, 9, 9, 25, 0).getTime()
        expect(buildTimeEntry(start, end)).toEqual({
            startTime: '2026-09-09T09:00:00',
            endTime: '2026-09-09T09:25:00',
            description: ''
        })
        expect(buildTimeEntry(start, end, 'deep work').description).toBe('deep work')
    })
})

describe('readTrackedMinutes (issue #172)', () => {
    const halfHour = [{ startTime: '2026-09-09T09:00:00', endTime: '2026-09-09T09:30:00' }]

    test('the duration property wins when positive (it is the total)', () => {
        expect(readTrackedMinutes({ entries: halfHour, spent: 999, legacy: 5 })).toBe(999)
        expect(readTrackedMinutes({ entries: [], spent: 90 })).toBe(90)
        expect(readTrackedMinutes({ entries: undefined, spent: '45' })).toBe(45)
    })

    test('falls back to the entries sum, then to a legacy duration number', () => {
        expect(readTrackedMinutes({ entries: halfHour, spent: undefined, legacy: 5 })).toBe(30)
        expect(readTrackedMinutes({ entries: halfHour, spent: 'n/a' })).toBe(30)
        expect(readTrackedMinutes({ entries: halfHour, spent: 0 })).toBe(30)
        expect(readTrackedMinutes({ entries: undefined, spent: undefined, legacy: 20 })).toBe(20)
        expect(readTrackedMinutes({ entries: undefined, spent: 0, legacy: 20 })).toBe(20)
    })

    test('null when nothing is tracked', () => {
        expect(readTrackedMinutes({ entries: undefined, spent: undefined })).toBeNull()
        expect(readTrackedMinutes({ entries: [], spent: 0, legacy: -1 })).toBeNull()
        expect(
            readTrackedMinutes({ entries: [{ startTime: '2026-09-09T09:00:00' }], spent: 0 })
        ).toBeNull()
    })
})

describe('numericDuration', () => {
    test('accepts finite non-negative numbers and numeric strings', () => {
        expect(numericDuration(0)).toBe(0)
        expect(numericDuration(42)).toBe(42)
        expect(numericDuration(' 15 ')).toBe(15)
    })
    test('rejects empty, text, negative and non-finite values', () => {
        expect(numericDuration(undefined)).toBeNull()
        expect(numericDuration(null)).toBeNull()
        expect(numericDuration('')).toBeNull()
        expect(numericDuration('1h')).toBeNull()
        expect(numericDuration(-3)).toBeNull()
        expect(numericDuration(Number.NaN)).toBeNull()
        expect(numericDuration([10])).toBeNull()
    })
})

describe('durationAfterEntryChange', () => {
    const e = (from: string, to: string | undefined): TimeEntry =>
        to === undefined
            ? { startTime: `2026-09-09T${from}:00` }
            : { startTime: `2026-09-09T${from}:00`, endTime: `2026-09-09T${to}:00` }
    const old30 = e('09:00', '09:30')
    const new20 = e('10:00', '10:20')

    test('stop: adds the new entry to an existing numeric duration (manual minutes kept)', () => {
        // 30 tracked + 60 added by hand = 90; a 20-minute session → 110, not 50.
        expect(durationAfterEntryChange(90, null, new20, [old30, new20])).toBe(110)
        expect(durationAfterEntryChange('90', null, new20, [old30, new20])).toBe(110)
        expect(durationAfterEntryChange(0, null, new20, [old30, new20])).toBe(20)
    })

    test('stop: empty or non-numeric duration falls back to the list sum', () => {
        expect(durationAfterEntryChange(undefined, null, new20, [old30, new20])).toBe(50)
        expect(durationAfterEntryChange('', null, new20, [old30, new20])).toBe(50)
        expect(durationAfterEntryChange('lots', null, new20, [old30, new20])).toBe(50)
        expect(durationAfterEntryChange(-5, null, new20, [new20])).toBe(20)
    })

    test('edit: applies the delta, not a recompute', () => {
        const edited = e('09:00', '09:45') // 30 → 45
        expect(durationAfterEntryChange(100, old30, edited, [edited])).toBe(115)
        const shorter = e('09:00', '09:10') // 30 → 10
        expect(durationAfterEntryChange(100, old30, shorter, [shorter])).toBe(80)
    })

    test('delete: subtracts the entry, never below zero', () => {
        expect(durationAfterEntryChange(100, old30, null, [])).toBe(70)
        expect(durationAfterEntryChange(10, old30, null, [])).toBe(0)
        expect(durationAfterEntryChange(undefined, old30, null, [new20])).toBe(20)
    })

    test('open or malformed entries count zero minutes', () => {
        expect(durationAfterEntryChange(40, null, e('11:00', undefined), [])).toBe(40)
        expect(durationAfterEntryChange(40, e('11:00', undefined), new20, [new20])).toBe(60)
    })
})

describe('clipEntryMinutes / minutesInRange (issue #172, phase C)', () => {
    const from = new Date(2026, 8, 7, 0, 0, 0) // Monday 2026-09-07 00:00 local
    const to = new Date(2026, 8, 14, 0, 0, 0) // next Monday
    const entry = (startTime: string, endTime?: string): TimeEntry => ({ startTime, endTime })

    test('an entry inside the range counts whole', () => {
        expect(
            clipEntryMinutes(entry('2026-09-08T10:00:00', '2026-09-08T11:30:00'), from, to)
        ).toBe(90)
    })

    test('an entry crossing the start counts its inside part only', () => {
        expect(
            clipEntryMinutes(entry('2026-09-06T23:30:00', '2026-09-07T00:45:00'), from, to)
        ).toBe(45)
    })

    test('an entry crossing the end counts its inside part only', () => {
        expect(
            clipEntryMinutes(entry('2026-09-13T23:00:00', '2026-09-14T02:00:00'), from, to)
        ).toBe(60)
    })

    test('an entry outside, an open entry, and a reversed entry count 0', () => {
        expect(
            clipEntryMinutes(entry('2026-09-01T10:00:00', '2026-09-01T11:00:00'), from, to)
        ).toBe(0)
        expect(clipEntryMinutes(entry('2026-09-08T10:00:00'), from, to)).toBe(0)
        expect(
            clipEntryMinutes(entry('2026-09-08T11:00:00', '2026-09-08T10:00:00'), from, to)
        ).toBe(0)
    })

    test('a tap inside the range still counts one minute', () => {
        expect(
            clipEntryMinutes(entry('2026-09-08T10:00:00', '2026-09-08T10:00:10'), from, to)
        ).toBe(1)
    })

    test('minutesInRange sums the clipped minutes', () => {
        expect(
            minutesInRange(
                [
                    entry('2026-09-08T10:00:00', '2026-09-08T11:00:00'),
                    entry('2026-09-06T23:30:00', '2026-09-07T00:30:00'),
                    entry('2026-09-20T10:00:00', '2026-09-20T11:00:00')
                ],
                from,
                to
            )
        ).toBe(90)
    })
})

describe('withEntryDescription (issue #197)', () => {
    const list = [
        { startTime: '2026-09-09T09:00:00', endTime: '2026-09-09T09:30:00', description: '' },
        'garbage',
        { startTime: '2026-09-09T10:00:00', endTime: '2026-09-09T10:20:00', description: '' }
    ]

    test('fills in the matching entry and keeps everything else verbatim', () => {
        const next = withEntryDescription(list, '2026-09-09T10:00:00', 'Review')
        expect(next[2]).toEqual({
            startTime: '2026-09-09T10:00:00',
            endTime: '2026-09-09T10:20:00',
            description: 'Review'
        })
        expect(next[0]).toBe(list[0])
        expect(next[1]).toBe('garbage')
        expect(list[2]).toEqual({
            startTime: '2026-09-09T10:00:00',
            endTime: '2026-09-09T10:20:00',
            description: ''
        })
    })

    test('targets the LAST entry sharing the start time', () => {
        const dup = [...list, { startTime: '2026-09-09T10:00:00', endTime: '2026-09-09T10:25:00' }]
        const next = withEntryDescription(dup, '2026-09-09T10:00:00', 'Later')
        expect((next[3] as { description?: string }).description).toBe('Later')
        expect((next[2] as { description?: string }).description).toBe('')
    })

    test('returns the same list when nothing matches, and [] for a non-list', () => {
        expect(withEntryDescription(list, 'nope', 'x')).toBe(list)
        expect(withEntryDescription(null, 'x', 'y')).toEqual([])
    })
})
