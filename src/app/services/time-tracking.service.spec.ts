import { describe, expect, test } from 'bun:test'
import {
    elapsedSessionMinutes,
    formatTrackedMinutes,
    readDurationMinutes,
    trackingPropertiesForType
} from './time-tracking.service'

describe('elapsedSessionMinutes (issue #119)', () => {
    test('rounds elapsed milliseconds to whole minutes', () => {
        const start = 1_000_000
        expect(elapsedSessionMinutes(start, start + 25 * 60000)).toBe(25)
        expect(elapsedSessionMinutes(start, start + 90_000)).toBe(2) // 1.5 min rounds up
        expect(elapsedSessionMinutes(start, start + 80_000)).toBe(1) // 1.33 min rounds down
    })

    test('a tracked tap still counts at least one minute', () => {
        expect(elapsedSessionMinutes(1000, 1000)).toBe(1)
        expect(elapsedSessionMinutes(1000, 1500)).toBe(1)
    })
})

describe('readDurationMinutes (issue #119)', () => {
    test('accepts positive numbers and numeric strings', () => {
        expect(readDurationMinutes(90)).toBe(90)
        expect(readDurationMinutes('45')).toBe(45)
    })

    test('rejects unset, zero, negative, and non-numeric values', () => {
        expect(readDurationMinutes(null)).toBeNull()
        expect(readDurationMinutes(undefined)).toBeNull()
        expect(readDurationMinutes(0)).toBeNull()
        expect(readDurationMinutes(-5)).toBeNull()
        expect(readDurationMinutes('soon')).toBeNull()
    })
})

describe('formatTrackedMinutes (issue #119)', () => {
    test('formats through the estimate display grammar', () => {
        expect(formatTrackedMinutes(90, 480)).toBe('1h 30m')
        expect(formatTrackedMinutes(480, 480)).toBe('1d')
        expect(formatTrackedMinutes(45, 480)).toBe('45m')
    })
})

describe('trackingPropertiesForType (issue #172)', () => {
    const globals = {
        defaultDurationProperty: 'time_spent',
        defaultTotalDurationProperty: 'total_time_spent',
        defaultTimeEntriesProperty: 'time_entries',
        defaultLastSessionProperty: 'date_last_session'
    }

    test('an untyped note (or a type without override) uses the globals', () => {
        expect(trackingPropertiesForType(globals, undefined)).toEqual({
            duration: 'time_spent',
            totalDuration: 'total_time_spent',
            entries: 'time_entries',
            lastSession: 'date_last_session'
        })
        expect(trackingPropertiesForType(globals, { timeTracking: undefined })).toEqual(
            trackingPropertiesForType(globals, undefined)
        )
    })

    test('a per-type override wins field by field; blanks fall back', () => {
        expect(
            trackingPropertiesForType(globals, {
                timeTracking: {
                    durationProperty: ' spent ',
                    totalDurationProperty: '',
                    entriesProperty: 'sessions',
                    lastSessionProperty: ''
                }
            })
        ).toEqual({
            duration: 'spent',
            totalDuration: 'total_time_spent',
            entries: 'sessions',
            lastSession: 'date_last_session'
        })
    })
})
