import { describe, expect, test } from 'bun:test'
import {
    combineTrackedTime,
    entryDescriptionLinkpath,
    linkedDate,
    linkedMinutes,
    linkedMinutesInRange,
    tagsInclude
} from './linked-time'
import type { LinkedNoteTime } from './linked-time'
import type { TimeEntry } from './time-entries'

describe('tagsInclude', () => {
    test('matches the tag exactly or with a leading #', () => {
        expect(tagsInclude(['type/session'], 'type/session')).toBe(true)
        expect(tagsInclude(['#type/session'], 'type/session')).toBe(true)
        expect(tagsInclude(['type/session'], '#type/session')).toBe(true)
    })

    test('matches nested tags (hierarchical), not prefixes of a segment', () => {
        expect(tagsInclude(['type/session/sport/running'], 'type/session')).toBe(true)
        expect(tagsInclude(['type/sessions'], 'type/session')).toBe(false)
        expect(tagsInclude(['type'], 'type/session')).toBe(false)
    })

    test('is case-insensitive', () => {
        expect(tagsInclude(['Type/Session/Music'], 'type/session')).toBe(true)
    })

    test('accepts a single string; ignores other shapes', () => {
        expect(tagsInclude('type/session', 'type/session')).toBe(true)
        expect(tagsInclude('#type/session/board-game', 'type/session')).toBe(true)
        expect(tagsInclude(undefined, 'type/session')).toBe(false)
        expect(tagsInclude(null, 'type/session')).toBe(false)
        expect(tagsInclude([42, null], 'type/session')).toBe(false)
    })

    test('a blank required tag matches nothing', () => {
        expect(tagsInclude(['type/session'], '')).toBe(false)
    })
})

describe('linkedDate', () => {
    test('a date or datetime string gives its first 10 characters', () => {
        expect(linkedDate('2026-11-03')).toBe('2026-11-03')
        expect(linkedDate('2026-11-03T18:30:00')).toBe('2026-11-03')
    })

    test('anything else is no date', () => {
        expect(linkedDate('')).toBeNull()
        expect(linkedDate('03/11/2026')).toBeNull()
        expect(linkedDate('2026-11')).toBeNull()
        expect(linkedDate(20261103)).toBeNull()
        expect(linkedDate(undefined)).toBeNull()
    })
})

describe('linkedMinutes', () => {
    test('Number() of the value when finite and > 0', () => {
        expect(linkedMinutes(45)).toBe(45)
        expect(linkedMinutes('30')).toBe(30)
        expect(linkedMinutes(12.5)).toBe(12.5)
    })

    test('0, empty, negative or non-numeric gives 0', () => {
        expect(linkedMinutes(0)).toBe(0)
        expect(linkedMinutes('')).toBe(0)
        expect(linkedMinutes(null)).toBe(0)
        expect(linkedMinutes(undefined)).toBe(0)
        expect(linkedMinutes(-10)).toBe(0)
        expect(linkedMinutes('an hour')).toBe(0)
        expect(linkedMinutes(Number.POSITIVE_INFINITY)).toBe(0)
    })
})

describe('entryDescriptionLinkpath', () => {
    test('one wikilink, with or without alias or heading, trimmed', () => {
        expect(entryDescriptionLinkpath('[[2026-11-03 Run]]')).toBe('2026-11-03 Run')
        expect(entryDescriptionLinkpath('  [[2026-11-03 Run|Run]] ')).toBe('2026-11-03 Run')
        expect(entryDescriptionLinkpath('[[Sessions/Run#Notes]]')).toBe('Sessions/Run')
    })

    test('anything else is not a link', () => {
        expect(entryDescriptionLinkpath(undefined)).toBeNull()
        expect(entryDescriptionLinkpath('Easy run')).toBeNull()
        expect(entryDescriptionLinkpath('Ran [[X]] today')).toBeNull()
        expect(entryDescriptionLinkpath('[[X]] [[Y]]')).toBeNull()
        expect(entryDescriptionLinkpath('[[#Heading]]')).toBeNull()
    })
})

const entry = (day: string, from: string, to: string, description = ''): TimeEntry => ({
    startTime: `${day}T${from}:00`,
    endTime: `${day}T${to}:00`,
    description
})

describe('combineTrackedTime', () => {
    test('entries + linked minutes; last session = the later day', () => {
        const result = combineTrackedTime(
            [entry('2026-10-01', '10:00', '10:30')],
            [
                { path: 'b.md', minutes: 45, date: '2026-10-20' },
                { path: 'a.md', minutes: 15, date: '2026-09-01' }
            ],
            () => false
        )
        expect(result.entryMinutes).toBe(30)
        expect(result.linkedMinutes).toBe(60)
        expect(result.minutes).toBe(90)
        expect(result.lastSession).toBe('2026-10-20')
        expect(result.linkedNotes.map((n) => n.path)).toEqual(['a.md', 'b.md'])
    })

    test('the latest entry day wins when later', () => {
        const result = combineTrackedTime(
            [entry('2026-11-02', '10:00', '10:30')],
            [{ path: 'a.md', minutes: 15, date: '2026-10-01' }],
            () => false
        )
        expect(result.lastSession).toBe('2026-11-02')
    })

    test('a linked note without minutes still moves the last session', () => {
        const result = combineTrackedTime(
            [],
            [{ path: 'a.md', minutes: 0, date: '2026-11-03' }],
            () => false
        )
        expect(result.minutes).toBe(0)
        expect(result.lastSession).toBe('2026-11-03')
    })

    test('a linked note without a valid date counts minutes, not the last session', () => {
        const result = combineTrackedTime(
            [],
            [{ path: 'a.md', minutes: 20, date: null }],
            () => false
        )
        expect(result.minutes).toBe(20)
        expect(result.lastSession).toBeNull()
    })

    test('entries matched as linked sessions are skipped (minutes and date)', () => {
        const linkedEntry = entry('2026-11-03', '18:00', '19:00', '[[Run 1]]')
        const result = combineTrackedTime(
            [entry('2026-10-01', '10:00', '10:30'), linkedEntry],
            [{ path: 'Run 1.md', minutes: 55, date: '2026-10-02' }],
            (e) => e === linkedEntry
        )
        expect(result.entryMinutes).toBe(30)
        expect(result.minutes).toBe(85)
        expect(result.lastSession).toBe('2026-10-02')
    })

    test('neither entries nor linked notes: zero and no last session', () => {
        const result = combineTrackedTime([], [], () => false)
        expect(result).toEqual({
            minutes: 0,
            entryMinutes: 0,
            linkedMinutes: 0,
            lastSession: null,
            linkedNotes: []
        })
    })
})

describe('linkedMinutesInRange', () => {
    const notes: LinkedNoteTime[] = [
        { path: 'sun.md', minutes: 10, date: '2026-11-01' },
        { path: 'mon.md', minutes: 20, date: '2026-11-02' },
        { path: 'sun2.md', minutes: 40, date: '2026-11-08' },
        { path: 'nextmon.md', minutes: 80, date: '2026-11-09' },
        { path: 'nodate.md', minutes: 160, date: null }
    ]

    test('counts the notes dated inside [from, to) only', () => {
        const from = new Date(2026, 10, 2) // Monday
        const to = new Date(2026, 10, 9) // next Monday
        expect(linkedMinutesInRange(notes, from, to)).toBe(60)
    })
})
