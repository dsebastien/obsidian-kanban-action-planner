import { describe, expect, test } from 'bun:test'
import {
    columnDays,
    dayIndexOf,
    gridHeight,
    hourMarks,
    inWeekWindow,
    isoWeekNumber,
    minutesAtOffset,
    groupByStatus,
    needsPlanning,
    newBlockSlot,
    slotPieces,
    weekDates,
    weekRangeLabel,
    workBand
} from './week-planner'
import type { WeekEntry, WeekGridConfig } from './week-planner'

const cfg: WeekGridConfig = {
    gridStart: 0,
    gridEnd: 1440,
    pxPerMinute: 1,
    firstDayOfWeek: 1,
    workStart: 540,
    workEnd: 1020,
    workDays: [0, 1, 2, 3, 4]
}

describe('columns and dates (issue #172)', () => {
    test('Monday-first columns by default; a Sunday start rotates', () => {
        expect(columnDays(1)).toEqual([0, 1, 2, 3, 4, 5, 6])
        expect(columnDays(0)).toEqual([6, 0, 1, 2, 3, 4, 5])
        expect(columnDays(6)).toEqual([5, 6, 0, 1, 2, 3, 4])
    })

    test('dayIndexOf is Monday-first', () => {
        expect(dayIndexOf(new Date(2026, 8, 7))).toBe(0) // Monday
        expect(dayIndexOf(new Date(2026, 8, 13))).toBe(6) // Sunday
    })

    test('weekDates spans the week of the anchor in column order', () => {
        const dates = weekDates(new Date(2026, 8, 9, 15), 1)
        expect(dates.map((d) => d.getDate())).toEqual([7, 8, 9, 10, 11, 12, 13])
        expect(weekDates(new Date(2026, 8, 9), 0).map((d) => d.getDate())).toEqual([
            6, 7, 8, 9, 10, 11, 12
        ])
    })

    test('weekRangeLabel and ISO week number', () => {
        expect(weekRangeLabel(weekDates(new Date(2026, 8, 9), 1))).toMatch(/Sep 7 – 13, 2026/)
        expect(weekRangeLabel(weekDates(new Date(2025, 11, 31), 1))).toMatch(
            /Dec 29, 2025 – Jan 4, 2026/
        )
        expect(isoWeekNumber(new Date(2026, 8, 9))).toBe(37)
        expect(isoWeekNumber(new Date(2026, 0, 1))).toBe(1)
    })
})

describe('inWeekWindow (issue #172)', () => {
    const weekStart = new Date(2026, 8, 7)
    const weekEnd = new Date(2026, 8, 13)

    test('open-ended notes are always in', () => {
        expect(inWeekWindow(null, null, weekStart, weekEnd)).toBe(true)
    })

    test('a start after the week or a due before it excludes the note', () => {
        expect(inWeekWindow(new Date(2026, 8, 14), null, weekStart, weekEnd)).toBe(false)
        expect(inWeekWindow(null, new Date(2026, 8, 6), weekStart, weekEnd)).toBe(false)
        expect(inWeekWindow(new Date(2026, 8, 13), null, weekStart, weekEnd)).toBe(true)
        expect(inWeekWindow(null, new Date(2026, 8, 7, 23), weekStart, weekEnd)).toBe(true)
        expect(inWeekWindow(new Date(2026, 8, 1), new Date(2026, 8, 30), weekStart, weekEnd)).toBe(
            true
        )
    })
})

describe('slotPieces (issue #172)', () => {
    test('a plain slot is one piece positioned by minutes', () => {
        expect(slotPieces({ day: 2, start: 540, end: 720 }, cfg)).toEqual([
            {
                day: 2,
                start: 540,
                end: 720,
                top: 540,
                height: 180,
                continuation: false,
                clippedTop: false,
                clippedBottom: false
            }
        ])
    })

    test('a midnight crosser renders as a tail and a continuation on the next day', () => {
        const pieces = slotPieces({ day: 4, start: 1380, end: 1500 }, cfg)
        expect(pieces.map((p) => [p.day, p.start, p.end, p.continuation])).toEqual([
            [4, 1380, 1440, false],
            [5, 0, 60, true]
        ])
        expect(slotPieces({ day: 6, start: 1380, end: 1500 }, cfg)[1]?.day).toBe(0)
    })

    test('pieces are clipped to the grid hours and flagged', () => {
        const narrow = { ...cfg, gridStart: 360, gridEnd: 1320, pxPerMinute: 0.5 }
        const pieces = slotPieces({ day: 0, start: 300, end: 420 }, narrow)
        expect(pieces).toEqual([
            {
                day: 0,
                start: 360,
                end: 420,
                top: 0,
                height: 30,
                continuation: false,
                clippedTop: true,
                clippedBottom: false
            }
        ])
        expect(slotPieces({ day: 0, start: 60, end: 120 }, narrow)).toEqual([])
    })
})

describe('grid math (issue #172)', () => {
    test('minutesAtOffset snaps and clamps', () => {
        expect(minutesAtOffset(547, cfg)).toBe(540)
        expect(minutesAtOffset(-30, cfg)).toBe(0)
        expect(minutesAtOffset(9999, cfg)).toBe(1440)
        expect(minutesAtOffset(100, { ...cfg, gridStart: 360, pxPerMinute: 2 })).toBe(405)
    })

    test('gridHeight, hourMarks, workBand', () => {
        expect(gridHeight(cfg)).toBe(1440)
        expect(hourMarks({ ...cfg, gridStart: 90, gridEnd: 300 })).toEqual([120, 180, 240])
        expect(workBand(0, cfg)).toEqual({ top: 540, height: 480 })
        expect(workBand(5, cfg)).toBeNull()
        expect(workBand(0, { ...cfg, workEnd: 0 })).toBeNull()
    })

    test('newBlockSlot uses the default length and stays inside the grid', () => {
        expect(newBlockSlot(1, 547, 60, cfg)).toEqual({ day: 1, start: 540, end: 600 })
        expect(newBlockSlot(1, 1420, 60, cfg)).toEqual({ day: 1, start: 1425, end: 1440 })
        expect(newBlockSlot(1, 1400, 60, cfg)).toEqual({ day: 1, start: 1395, end: 1440 })
    })
})

describe('needsPlanning (issue #172)', () => {
    const entry = (over: Partial<WeekEntry>): WeekEntry => ({
        path: 'A.md',
        title: 'A',
        contexts: [],
        areas: [],
        blocks: [],
        errors: [],
        targetMinutes: null,
        typeName: null,
        active: true,
        onGrid: true,
        statusLabel: 'Active',
        statusRank: 0,
        ...over
    })

    test('lists notes with a target and no block only', () => {
        const rail = needsPlanning([
            entry({ path: 'A.md', targetMinutes: 120 }),
            entry({ path: 'B.md', targetMinutes: 120, blocks: [{ days: [0], start: 0, end: 60 }] }),
            entry({ path: 'C.md', targetMinutes: 0 }),
            entry({ path: 'D.md' })
        ])
        expect(rail.map((e) => e.path)).toEqual(['A.md'])
    })
})

describe('groupByStatus (issue #172)', () => {
    const entry = (over: Partial<WeekEntry>): WeekEntry => ({
        path: 'A.md',
        title: 'A',
        contexts: [],
        areas: [],
        blocks: [],
        errors: [],
        targetMinutes: null,
        typeName: null,
        active: true,
        onGrid: true,
        statusLabel: 'Active',
        statusRank: 0,
        ...over
    })

    test('groups by status label in column order, titles sorted inside', () => {
        const groups = groupByStatus([
            entry({ path: 'z.md', title: 'Zed', statusLabel: 'Back Burner', statusRank: 3 }),
            entry({ path: 'b.md', title: 'Bee', statusLabel: 'Active', statusRank: 2 }),
            entry({ path: 'a.md', title: 'Ay', statusLabel: 'Active', statusRank: 2 }),
            entry({ path: 'u.md', title: 'Unmapped', statusLabel: 'No status', statusRank: 99 })
        ])
        expect(groups.map((g) => [g.label, g.entries.map((e) => e.title)])).toEqual([
            ['Active', ['Ay', 'Bee']],
            ['Back Burner', ['Zed']],
            ['No status', ['Unmapped']]
        ])
    })
})
