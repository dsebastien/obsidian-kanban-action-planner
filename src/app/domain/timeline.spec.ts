import { describe, expect, it } from 'bun:test'
import {
    NO_TYPE_ID,
    ZOOM_ORDER,
    axisTicks,
    barGeometry,
    dayOffsetAtPct,
    daysBetween,
    derivedEnd,
    groupByTypeAndStatus,
    inclusiveDays,
    parseEstimate,
    parseMilestoneEntry,
    parseMilestones,
    pointPct,
    resizeEstimate,
    resizeFromStart,
    totalDays,
    zoomRange
} from './timeline'
import type { TimelineRange } from './timeline'

// A 10-day window keeps the percentage math easy to eyeball (1 day = 10%).
const TEN_DAYS: TimelineRange = {
    start: new Date(2026, 5, 1), // 2026-06-01
    end: new Date(2026, 5, 10)
}

describe('day math', () => {
    it('daysBetween counts whole local days, signed', () => {
        expect(daysBetween(new Date(2026, 5, 1), new Date(2026, 5, 4))).toBe(3)
        expect(daysBetween(new Date(2026, 5, 4), new Date(2026, 5, 1))).toBe(-3)
        expect(daysBetween(new Date(2026, 5, 1, 23, 59), new Date(2026, 5, 2, 0, 1))).toBe(1)
    })

    it('totalDays is inclusive', () => {
        expect(totalDays(TEN_DAYS)).toBe(10)
    })

    it('inclusiveDays counts both endpoints; same-day is 1; reversed is 1', () => {
        expect(inclusiveDays(new Date(2026, 5, 1), new Date(2026, 5, 12))).toBe(12)
        expect(inclusiveDays(new Date(2026, 5, 3), new Date(2026, 5, 3))).toBe(1)
        expect(inclusiveDays(new Date(2026, 5, 10), new Date(2026, 5, 5))).toBe(1)
    })

    it('totalDays delegates to inclusiveDays', () => {
        expect(totalDays(TEN_DAYS)).toBe(inclusiveDays(TEN_DAYS.start, TEN_DAYS.end))
        // A degenerate reversed range still yields the 1-day minimum.
        expect(totalDays({ start: TEN_DAYS.end, end: TEN_DAYS.start })).toBe(1)
    })
})

describe('zoomRange (issue #80)', () => {
    it('zooming in steps toward week, one kind at a time', () => {
        expect(zoomRange('year', 1)).toBe('quarter')
        expect(zoomRange('quarter', 1)).toBe('month')
        expect(zoomRange('month', 1)).toBe('week')
    })

    it('zooming out steps toward year, one kind at a time', () => {
        expect(zoomRange('week', -1)).toBe('month')
        expect(zoomRange('month', -1)).toBe('quarter')
        expect(zoomRange('quarter', -1)).toBe('year')
    })

    it('is null at both ends (no-op for the caller)', () => {
        expect(zoomRange('week', 1)).toBeNull()
        expect(zoomRange('year', -1)).toBeNull()
    })

    it('ZOOM_ORDER runs from most zoomed-in to most zoomed-out', () => {
        expect(ZOOM_ORDER).toEqual(['week', 'month', 'quarter', 'year'])
    })
})

describe('parseEstimate', () => {
    it('accepts numbers and numeric strings, rounding fractions UP', () => {
        expect(parseEstimate(5)).toBe(5)
        expect(parseEstimate(0.4)).toBe(1)
        expect(parseEstimate(0.5)).toBe(1)
        expect(parseEstimate('2.6')).toBe(3)
        expect(parseEstimate('12')).toBe(12)
    })

    it('rejects zero, negatives, and anything non-numeric', () => {
        expect(parseEstimate(0)).toBeNull()
        expect(parseEstimate(-1)).toBeNull()
        expect(parseEstimate('abc')).toBeNull()
        expect(parseEstimate('')).toBeNull()
        expect(parseEstimate(null)).toBeNull()
        expect(parseEstimate(undefined)).toBeNull()
        expect(parseEstimate(true)).toBeNull()
        expect(parseEstimate('3d')).toBeNull()
        expect(parseEstimate(Infinity)).toBeNull()
    })
})

describe('derivedEnd', () => {
    it('is start + estimate − 1 (inclusive span)', () => {
        expect(derivedEnd(new Date(2026, 5, 1), 5)).toEqual(new Date(2026, 5, 5))
        // A 1-day estimate ends on the start day itself.
        expect(derivedEnd(new Date(2026, 5, 1), 1)).toEqual(new Date(2026, 5, 1))
    })
})

describe('resizeFromStart / resizeEstimate', () => {
    it('trades the shared delta between start and estimate (end anchored)', () => {
        expect(resizeFromStart(5, 2)).toEqual({ startDelta: 2, estimate: 3 })
        // Negative delta = grow: the start moves left, the estimate absorbs it.
        expect(resizeFromStart(5, -3)).toEqual({ startDelta: -3, estimate: 8 })
    })

    it('shrinking clamps at estimate − 1 so the estimate never drops below 1', () => {
        // Landing exactly on the anchored end day is the 1-day minimum…
        expect(resizeFromStart(5, 4)).toEqual({ startDelta: 4, estimate: 1 })
        // …and any overshoot (delta ≥ estimate) clamps to the same point.
        expect(resizeFromStart(5, 5)).toEqual({ startDelta: 4, estimate: 1 })
        expect(resizeFromStart(5, 50)).toEqual({ startDelta: 4, estimate: 1 })
        expect(resizeFromStart(1, 1)).toEqual({ startDelta: 0, estimate: 1 })
    })

    it('resizeEstimate grows/shrinks the estimate with a 1-day floor', () => {
        expect(resizeEstimate(5, 3)).toBe(8)
        expect(resizeEstimate(5, -2)).toBe(3)
        expect(resizeEstimate(5, -4)).toBe(1)
        expect(resizeEstimate(5, -50)).toBe(1)
    })
})

describe('parseMilestoneEntry / parseMilestones', () => {
    it('parses "<date> label" and bare dates, keeping the raw entry', () => {
        expect(parseMilestoneEntry('2026-09-01 Beta launch')).toEqual({
            date: new Date(2026, 8, 1),
            label: 'Beta launch',
            raw: '2026-09-01 Beta launch'
        })
        expect(parseMilestoneEntry('2026-09-01')).toEqual({
            date: new Date(2026, 8, 1),
            label: '',
            raw: '2026-09-01'
        })
    })

    it('tolerates wikilink brackets around the date', () => {
        expect(parseMilestoneEntry('[[2026-09-01]] Beta')).toEqual({
            date: new Date(2026, 8, 1),
            label: 'Beta',
            raw: '[[2026-09-01]] Beta'
        })
    })

    it('returns null when the first token is not a date', () => {
        expect(parseMilestoneEntry('Beta 2026-09-01')).toBeNull()
        expect(parseMilestoneEntry('')).toBeNull()
        expect(parseMilestoneEntry('   ')).toBeNull()
    })

    it('parseMilestones accepts lists and scalars, skips junk, sorts by date', () => {
        const parsed = parseMilestones(['2026-10-01 Later', 'not a date', '2026-09-01 First', 42])
        expect(parsed.map((m) => m.label)).toEqual(['First', 'Later'])
        expect(parseMilestones('2026-09-01 Solo')).toHaveLength(1)
        expect(parseMilestones(null)).toEqual([])
        expect(parseMilestones(undefined)).toEqual([])
    })
})

describe('barGeometry', () => {
    it('positions an in-range inclusive span', () => {
        // Days 3–5 of June (offsets 2..4) → left 20%, width 30%.
        const bar = barGeometry(new Date(2026, 5, 3), new Date(2026, 5, 5), TEN_DAYS)
        expect(bar).toEqual({ leftPct: 20, widthPct: 30, clippedStart: false, clippedEnd: false })
    })

    it('a single-day span has one day of width', () => {
        const bar = barGeometry(new Date(2026, 5, 3), new Date(2026, 5, 3), TEN_DAYS)
        expect(bar).toMatchObject({ leftPct: 20, widthPct: 10 })
    })

    it('clamps and flags spans crossing the range edges', () => {
        const bar = barGeometry(new Date(2026, 4, 20), new Date(2026, 5, 2), TEN_DAYS)
        expect(bar).toEqual({ leftPct: 0, widthPct: 20, clippedStart: true, clippedEnd: false })
        const bar2 = barGeometry(new Date(2026, 5, 9), new Date(2026, 6, 15), TEN_DAYS)
        expect(bar2).toEqual({ leftPct: 80, widthPct: 20, clippedStart: false, clippedEnd: true })
    })

    it('returns null for spans entirely outside the range', () => {
        expect(barGeometry(new Date(2026, 4, 1), new Date(2026, 4, 20), TEN_DAYS)).toBeNull()
        expect(barGeometry(new Date(2026, 6, 1), new Date(2026, 6, 5), TEN_DAYS)).toBeNull()
    })

    it('treats a reversed span as its start day', () => {
        const bar = barGeometry(new Date(2026, 5, 5), new Date(2026, 5, 2), TEN_DAYS)
        expect(bar).toMatchObject({ leftPct: 40, widthPct: 10 })
    })
})

describe('pointPct', () => {
    it('centers on the day cell', () => {
        expect(pointPct(new Date(2026, 5, 1), TEN_DAYS)).toBe(5)
        expect(pointPct(new Date(2026, 5, 10), TEN_DAYS)).toBe(95)
    })

    it('is null outside the range', () => {
        expect(pointPct(new Date(2026, 4, 31), TEN_DAYS)).toBeNull()
        expect(pointPct(new Date(2026, 5, 11), TEN_DAYS)).toBeNull()
    })
})

describe('dayOffsetAtPct', () => {
    it('maps a track position back to its day, clamped into the range', () => {
        expect(dayOffsetAtPct(5, TEN_DAYS)).toBe(0) // center of day 1
        expect(dayOffsetAtPct(95, TEN_DAYS)).toBe(9) // center of day 10
        expect(dayOffsetAtPct(0, TEN_DAYS)).toBe(0)
        expect(dayOffsetAtPct(100, TEN_DAYS)).toBe(9) // clamped
        expect(dayOffsetAtPct(-5, TEN_DAYS)).toBe(0)
    })
})

describe('groupByTypeAndStatus', () => {
    interface Item {
        title: string
        type: { id: string; name: string } | null
        status: string | null
    }
    const item = (title: string, type: Item['type'], status: string | null): Item => ({
        title,
        type,
        status
    })
    const task = { id: 't1', name: 'Task' }
    const project = { id: 'p1', name: 'Project' }

    it('groups by type (alphabetical, no-type last), then status (column order, no-status last)', () => {
        const groups = groupByTypeAndStatus(
            [
                item('t done', task, '80 - Done'),
                item('untyped', null, '10 - Backlog'),
                item('p backlog', project, '10 - Backlog'),
                item('t backlog', task, '10 - Backlog'),
                item('t nostatus', task, null)
            ],
            (i) => i.type,
            (i) => i.status
        )
        expect(groups.map((g) => g.typeName)).toEqual(['Project', 'Task', 'No type'])
        expect(groups[2]?.typeId).toBe(NO_TYPE_ID)
        expect(groups[1]?.groups.map((g) => g.label)).toEqual(['Backlog', 'Done', 'No status'])
        expect(groups[1]?.groups[2]?.status).toBe('')
        expect(groups[1]?.groups[0]?.items.map((i) => i.title)).toEqual(['t backlog'])
        expect(groups[0]?.groups).toHaveLength(1)
    })

    it('strips the NN- prefix for the status label, keeps unprefixed values as-is', () => {
        const groups = groupByTypeAndStatus(
            [item('x', task, 'In Review')],
            (i) => i.type,
            (i) => i.status
        )
        expect(groups[0]?.groups[0]?.label).toBe('In Review')
        expect(groups[0]?.groups[0]?.status).toBe('In Review')
    })

    it('is empty for no items', () => {
        expect(
            groupByTypeAndStatus(
                [],
                () => null,
                () => null
            )
        ).toEqual([])
    })
})

describe('axisTicks', () => {
    const june: TimelineRange = { start: new Date(2026, 5, 1), end: new Date(2026, 5, 30) }

    it('week: one labelled major tick per day', () => {
        const week: TimelineRange = { start: new Date(2026, 5, 1), end: new Date(2026, 5, 7) }
        const ticks = axisTicks(week, 'week')
        expect(ticks).toHaveLength(7)
        expect(ticks[0]).toMatchObject({ pct: 0, label: 'Mon 1', major: true })
    })

    it('month: a tick per day, week starts major and labelled', () => {
        const ticks = axisTicks(june, 'month', 1)
        expect(ticks).toHaveLength(30)
        // 2026-06-01 is a Monday → major with the day number.
        expect(ticks[0]).toMatchObject({ label: '1', major: true })
        expect(ticks[1]).toMatchObject({ label: '', major: false })
        expect(ticks[7]).toMatchObject({ label: '8', major: true })
    })

    it('quarter: week starts minor, month starts major with month label', () => {
        const q3: TimelineRange = { start: new Date(2026, 6, 1), end: new Date(2026, 8, 30) }
        const ticks = axisTicks(q3, 'quarter', 1)
        const majors = ticks.filter((t) => t.major)
        expect(majors.map((t) => t.label)).toEqual(['Jul', 'Aug', 'Sep'])
        expect(ticks.some((t) => !t.major)).toBe(true)
    })

    it('year: one major tick per month', () => {
        const y: TimelineRange = { start: new Date(2026, 0, 1), end: new Date(2026, 11, 31) }
        const ticks = axisTicks(y, 'year')
        expect(ticks).toHaveLength(12)
        expect(ticks.every((t) => t.major)).toBe(true)
        expect(ticks[0]?.label).toBe('Jan')
        expect(ticks[11]?.label).toBe('Dec')
    })
})
