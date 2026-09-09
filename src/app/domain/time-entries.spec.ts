import { describe, expect, test } from 'bun:test'
import {
    buildTimeEntry,
    entryMinutes,
    formatEntryDate,
    formatEntryDateTime,
    latestEntryDate,
    parseEntryDateTime,
    parseTimeEntries,
    readTrackedMinutes,
    sumEntryMinutes
} from './time-entries'

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
    test('the entries list wins when it holds any entry', () => {
        expect(
            readTrackedMinutes({
                entries: [{ startTime: '2026-09-09T09:00:00', endTime: '2026-09-09T09:30:00' }],
                spent: 999,
                legacy: 5
            })
        ).toBe(30)
    })

    test('falls back to the spent cache, then to a legacy duration number', () => {
        expect(readTrackedMinutes({ entries: [], spent: 90 })).toBe(90)
        expect(readTrackedMinutes({ entries: undefined, spent: '45' })).toBe(45)
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
