import { describe, expect, test } from 'bun:test'
import { TFile } from 'obsidian'
import { KanbanActionPlannerPlugin } from '../plugin'
import { createDefaultSettings } from '../types/plugin-settings.intf'
import { createDefaultNoteType } from './note-type.service'
import { fakeVault } from './linked-time.fixture'
import {
    computeTrackedTime,
    elapsedSessionMinutes,
    stopTimeSession,
    formatTrackedMinutes,
    readDurationMinutes,
    recomputeTrackedTime,
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

const START = new Date(2026, 8, 9, 10, 0, 0).getTime()
const END = START + 20 * 60000
const old30 = { startTime: '2026-09-08T09:00:00', endTime: '2026-09-08T09:30:00' }

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
    return { fm, plugin, file }
}

describe('stopTimeSession: adds to the existing duration', () => {
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

describe('stopTimeSession on a template placeholder (issue #218)', () => {
    test('[null] becomes the new entry alone', async () => {
        const { fm, plugin } = setup({ time_entries: [null] })
        await stopTimeSession(plugin, END)
        expect(fm['time_entries']).toEqual([
            { startTime: '2026-09-09T10:00:00', endTime: '2026-09-09T10:20:00', description: '' }
        ])
    })
})

describe('recomputeTrackedTime drops empty items (issue #218)', () => {
    test('[null] becomes an empty list; the duration is left alone', async () => {
        const { fm, plugin, file } = setup({ time_spent: 45, time_entries: [null] })
        expect(await recomputeTrackedTime(plugin, file)).toBeNull()
        expect(fm['time_entries']).toEqual([])
        expect(fm['time_spent']).toBe(45)
    })

    test('[entry, null] keeps the entry and recomputes from it', async () => {
        const { fm, plugin, file } = setup({ time_spent: 999, time_entries: [old30, null] })
        expect(await recomputeTrackedTime(plugin, file)).toBe(30)
        expect(fm['time_entries']).toEqual([old30])
        expect(fm['time_spent']).toBe(30)
        expect(fm['date_last_session']).toBe('2026-09-08')
    })

    test('a clean list is not rewritten', async () => {
        const entries = [old30]
        const { fm, plugin, file } = setup({ time_entries: entries })
        await recomputeTrackedTime(plugin, file)
        expect(fm['time_entries']).toBe(entries)
    })
})

/**
 * A plugin double over a fake vault with one `activity` type (recognized by
 * folder) whose time-tracking block takes time from linked notes when `on`.
 */
function linkedSetup(on: boolean, notes: Record<string, Record<string, unknown>>) {
    const v = fakeVault(notes)
    const app = {
        ...v.app,
        plugins: { plugins: {} },
        fileManager: {
            processFrontMatter: (f: TFile, fn: (fm: Record<string, unknown>) => void) => {
                fn(v.frontmatter.get(f.path) ?? {})
                return Promise.resolve()
            }
        }
    }
    const activity = {
        ...createDefaultNoteType('activity', 'Activity', 'local'),
        typeRecognition: {
            mappings: [{ type: 'folder' as const, value: 'Activities', enabled: true }]
        },
        timeTracking: {
            durationProperty: '',
            totalDurationProperty: '',
            entriesProperty: '',
            lastSessionProperty: '',
            linkedNotes: {
                enabled: on,
                linkProperty: 'related_activities',
                minutesProperty: 'time_spent',
                dateProperty: 'date',
                requiredTag: 'type/session'
            }
        }
    }
    const plugin = Object.assign(
        Object.create(KanbanActionPlannerPlugin.prototype) as KanbanActionPlannerPlugin,
        {
            app,
            settings: {
                ...createDefaultSettings(),
                noteTypes: [activity],
                defaultDurationProperty: 'time_spent',
                defaultTotalDurationProperty: 'total_time_spent',
                defaultTimeEntriesProperty: 'time_entries',
                defaultLastSessionProperty: 'date_last_session'
            },
            saveSettings: (): Promise<void> => Promise.resolve()
        }
    )
    return { v, plugin }
}

describe('recomputeTrackedTime with time from linked notes', () => {
    const RUN = 'Activities/Run (Activity).md'
    const notes = (): Record<string, Record<string, unknown>> => ({
        [RUN]: {
            time_spent: 999,
            date_last_session: '2020-01-01',
            time_entries: [
                old30,
                {
                    startTime: '2026-10-02T07:00:00',
                    endTime: '2026-10-02T08:00:00',
                    description: '[[2026-10-02 Run]]'
                }
            ]
        },
        'Sessions/2026-10-02 Run.md': {
            tags: ['type/session/sport/running'],
            related_activities: ['[[Run (Activity)]]'],
            date: '2026-10-02',
            time_spent: 50
        },
        'Sessions/2026-10-20 Games.md': {
            tags: 'type/session',
            related_activities: '[[Run (Activity)|Run]]',
            date: '2026-10-20T20:00:00',
            time_spent: ''
        }
    })

    test('stores entries + linked minutes and the later last-session date', async () => {
        const { v, plugin } = linkedSetup(true, notes())
        expect(await recomputeTrackedTime(plugin, v.file(RUN))).toBe(80)
        const fm = v.frontmatter.get(RUN) ?? {}
        expect(fm['time_spent']).toBe(80)
        expect(fm['date_last_session']).toBe('2026-10-20')
    })

    test('off for the type: entries only, as before', async () => {
        const { v, plugin } = linkedSetup(false, notes())
        expect(await recomputeTrackedTime(plugin, v.file(RUN))).toBe(90)
        expect(v.frontmatter.get(RUN)?.['date_last_session']).toBe('2026-10-02')
    })

    test('linked notes alone are enough to recompute', async () => {
        const { v, plugin } = linkedSetup(true, {
            [RUN]: { time_spent: 5 },
            's.md': {
                tags: ['type/session'],
                related_activities: ['[[Run (Activity)]]'],
                date: '2026-11-03',
                time_spent: 25
            }
        })
        expect(await recomputeTrackedTime(plugin, v.file(RUN))).toBe(25)
        expect(v.frontmatter.get(RUN)?.['date_last_session']).toBe('2026-11-03')
    })

    test('the public API returns the same numbers without writing', async () => {
        const { v, plugin } = linkedSetup(true, notes())
        const result = await computeTrackedTime(plugin, RUN)
        expect(result).toMatchObject({
            minutes: 80,
            entryMinutes: 30,
            linkedMinutes: 50,
            lastSession: '2026-10-20'
        })
        expect(result?.linkedNotes.map((n) => n.path)).toEqual([
            'Sessions/2026-10-02 Run.md',
            'Sessions/2026-10-20 Games.md'
        ])
        expect(v.frontmatter.get(RUN)?.['time_spent']).toBe(999)
        expect(await computeTrackedTime(plugin, 'missing.md')).toBeNull()
    })
})
