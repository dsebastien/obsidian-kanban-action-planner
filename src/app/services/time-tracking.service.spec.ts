import { describe, expect, test } from 'bun:test'
import { TFile } from 'obsidian'
import { KanbanActionPlannerPlugin } from '../plugin'
import { createDefaultSettings } from '../types/plugin-settings.intf'
import {
    elapsedSessionMinutes,
    stopTimeSession,
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

describe('stopTimeSession: adds to the existing duration', () => {
    const START = new Date(2026, 8, 9, 10, 0, 0).getTime()
    const END = START + 20 * 60000

    /** A plugin double around one note's frontmatter; writes land in `fm`. */
    function setup(fm: Record<string, unknown>) {
        const file = Object.assign(new TFile(), { path: 'n.md', basename: 'n' })
        const app = {
            plugins: { plugins: {} },
            vault: { getFileByPath: (p: string) => (p === 'n.md' ? file : null) },
            metadataCache: { getFileCache: () => ({ frontmatter: fm }) },
            fileManager: {
                processFrontMatter: (_f: TFile, fn: (fm: Record<string, unknown>) => void) => {
                    fn(fm)
                    return Promise.resolve()
                }
            }
        }
        // Built without the constructor (as in plugin.spec.ts), so no Obsidian runtime is needed
        const plugin = Object.assign(
            Object.create(KanbanActionPlannerPlugin.prototype) as KanbanActionPlannerPlugin,
            {
                app,
                settings: {
                    ...createDefaultSettings(),
                    activeTimeSession: { path: 'n.md', startedAt: START },
                    noteTypes: [],
                    defaultDurationProperty: 'time_spent',
                    defaultTotalDurationProperty: 'total_time_spent',
                    defaultTimeEntriesProperty: 'time_entries',
                    defaultLastSessionProperty: 'date_last_session',
                    minutesPerDay: 480,
                    askDescriptionOnStop: false
                },
                saveSettings: (): Promise<void> => Promise.resolve()
            }
        )
        return { fm, plugin }
    }
    const old30 = { startTime: '2026-09-08T09:00:00', endTime: '2026-09-08T09:30:00' }

    test('keeps minutes added outside the tracker', async () => {
        const { fm, plugin } = setup({ time_spent: 90, time_entries: [old30] })
        await stopTimeSession(plugin, END)
        expect(fm['time_spent']).toBe(110)
        expect(fm['time_entries']).toHaveLength(2)
        expect(fm['date_last_session']).toBe('2026-09-09')
        expect(plugin.settings.activeTimeSession).toBeNull()
    })

    test('an empty or non-numeric duration falls back to the entries sum', async () => {
        const empty = setup({ time_entries: [old30] })
        await stopTimeSession(empty.plugin, END)
        expect(empty.fm['time_spent']).toBe(50)

        const text = setup({ Time_Spent: 'lots', time_entries: [old30] })
        await stopTimeSession(text.plugin, END)
        expect(text.fm['Time_Spent']).toBe(50)
    })
})
