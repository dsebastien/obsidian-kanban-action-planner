import { addDays, parseFrontmatterDate, startOfDay, startOfWeek, toDateKey } from './calendar'
import type { CalendarRange } from './calendar'
import { compareStatusValues, splitStatusValue } from './status'

/**
 * Pure timeline math (issue #77). No Obsidian/DOM deps so it is fully
 * unit-testable: the controller reads dates/milestones from frontmatter and
 * this module turns them into percentage-based geometry on an inclusive day
 * range (the same week/month/quarter/year vocabulary as the calendar).
 */

/** Inclusive day range shown by the timeline (from `periodRange`). */
export interface TimelineRange {
    start: Date
    end: Date
}

/** One parsed milestone: a date plus an optional label. */
export interface TimelineMilestone {
    date: Date
    label: string
    /** The original list entry, verbatim — the removal key. */
    raw: string
}

/** Horizontal geometry of a bar within the range, in % of the track width. */
export interface BarGeometry {
    leftPct: number
    widthPct: number
    /** True when the real start/end lies outside the visible range. */
    clippedStart: boolean
    clippedEnd: boolean
}

/** One axis tick: position in % plus an optional label (major ticks only). */
export interface AxisTick {
    pct: number
    label: string
    major: boolean
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export function daysBetween(a: Date, b: Date): number {
    const ms = startOfDay(b).getTime() - startOfDay(a).getTime()
    return Math.round(ms / 86_400_000)
}

/**
 * Inclusive day count of a `start`→`end` span (issue #80 duration display).
 * A reversed span (end before start) counts as 1 — the single `start` day,
 * matching {@link barGeometry}'s treatment of inverted stored dates.
 */
export function inclusiveDays(start: Date, end: Date): number {
    return Math.max(1, daysBetween(start, end) + 1)
}

/** Days shown by the range (inclusive; delegates so the convention has one home). */
export function totalDays(range: TimelineRange): number {
    return inclusiveDays(range.start, range.end)
}

/** Range kinds from most zoomed-in to most zoomed-out (issue #80 wheel zoom). */
export const ZOOM_ORDER: ReadonlyArray<CalendarRange> = ['week', 'month', 'quarter', 'year']

/**
 * The next range kind when zooming from `kind` (`1` = in, `-1` = out), or
 * `null` at either end of {@link ZOOM_ORDER} (already at week/year) — callers
 * treat `null` as a no-op.
 */
export function zoomRange(kind: CalendarRange, direction: 1 | -1): CalendarRange | null {
    const index = ZOOM_ORDER.indexOf(kind)
    if (index < 0) return null
    return ZOOM_ORDER[index - direction] ?? null
}

/**
 * The new date for a bar edge dragged by `dayDelta` whole days (issue #80
 * resize handles): the span never inverts and never shrinks below 1 inclusive
 * day (start ≤ end always). Already-inverted stored dates are normalized
 * first — the effective span is the single `start` day, matching
 * {@link barGeometry} — so the clamp works against what the user sees.
 */
export function clampResizeDate(
    start: Date,
    end: Date,
    edge: 'start' | 'end',
    dayDelta: number
): Date {
    const effectiveEnd = daysBetween(start, end) < 0 ? start : end
    if (edge === 'start') {
        const moved = addDays(start, dayDelta)
        return daysBetween(moved, effectiveEnd) < 0 ? startOfDay(effectiveEnd) : moved
    }
    const moved = addDays(effectiveEnd, dayDelta)
    return daysBetween(start, moved) < 0 ? startOfDay(start) : moved
}

/**
 * Parse one milestone entry: `"<date> [label…]"`. Wikilink brackets around the
 * date are tolerated (`[[2026-09-01]] Beta`); the date part uses the same
 * parser as every other date in the plugin. Returns `null` for entries whose
 * first token isn't a date (best-effort, never throws).
 */
export function parseMilestoneEntry(raw: string): TimelineMilestone | null {
    const cleaned = raw.replace(/\[\[|\]\]/g, ' ').trim()
    if (cleaned.length === 0) return null
    const space = cleaned.search(/\s/)
    const first = space < 0 ? cleaned : cleaned.slice(0, space)
    const date = parseFrontmatterDate(first)
    if (!date) return null
    const label = space < 0 ? '' : cleaned.slice(space + 1).trim()
    return { date, label, raw }
}

/**
 * Parse a milestone frontmatter value (list or scalar) into milestones,
 * sorted by date. Non-string / non-parseable entries are skipped.
 */
export function parseMilestones(raw: unknown): TimelineMilestone[] {
    const entries = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw]
    const out: TimelineMilestone[] = []
    for (const entry of entries) {
        if (typeof entry !== 'string') continue
        const parsed = parseMilestoneEntry(entry)
        if (parsed) out.push(parsed)
    }
    return out.sort((a, b) => a.date.getTime() - b.date.getTime())
}

/**
 * Bar geometry for an inclusive `start`→`end` day span within `range`, clamped
 * to the visible window (with clipped flags), or `null` when the span lies
 * entirely outside. A reversed span (end before start) is treated as its
 * single `start` day.
 */
export function barGeometry(start: Date, end: Date, range: TimelineRange): BarGeometry | null {
    const days = totalDays(range)
    const effectiveEnd = daysBetween(start, end) < 0 ? start : end
    let startOffset = daysBetween(range.start, start)
    let endOffset = daysBetween(range.start, effectiveEnd)
    if (endOffset < 0 || startOffset >= days) return null
    const clippedStart = startOffset < 0
    const clippedEnd = endOffset >= days
    startOffset = Math.max(0, startOffset)
    endOffset = Math.min(days - 1, endOffset)
    return {
        leftPct: (startOffset / days) * 100,
        widthPct: ((endOffset - startOffset + 1) / days) * 100,
        clippedStart,
        clippedEnd
    }
}

/** Center of `date`'s day cell in % of the track, or `null` when outside the range. */
export function pointPct(date: Date, range: TimelineRange): number | null {
    const days = totalDays(range)
    const offset = daysBetween(range.start, date)
    if (offset < 0 || offset >= days) return null
    return ((offset + 0.5) / days) * 100
}

/**
 * The day offset (0-based, clamped into the range) under a horizontal position
 * given in % of the track width — the inverse of {@link pointPct}, used to turn
 * a drop/click position into a date (issue #77 scheduling + milestones).
 */
export function dayOffsetAtPct(pct: number, range: TimelineRange): number {
    const days = totalDays(range)
    return Math.max(0, Math.min(days - 1, Math.floor((pct / 100) * days)))
}

/** One group of undated cards, keyed by their status value. */
export interface StatusGroup<T> {
    /** Display label: the status value's label (`NN -` prefix stripped), or `No status`. */
    label: string
    items: T[]
}

/**
 * Group the undated-strip items by their status value: ordered like the board's
 * columns (numeric `NN -` prefixes compare numerically), the no-status group
 * last. Labels reuse the column-label convention (`splitStatusValue`).
 */
export function groupByStatus<T>(
    items: ReadonlyArray<T>,
    statusOf: (item: T) => string | null
): StatusGroup<T>[] {
    const byStatus = new Map<string, T[]>()
    for (const item of items) {
        const key = statusOf(item) ?? ''
        const bucket = byStatus.get(key)
        if (bucket) bucket.push(item)
        else byStatus.set(key, [item])
    }
    const keys = [...byStatus.keys()].sort((a, b) => {
        if (a === '') return 1
        if (b === '') return -1
        return compareStatusValues(a, b)
    })
    return keys.map((key) => ({
        label: key === '' ? 'No status' : splitStatusValue(key).label,
        items: byStatus.get(key) ?? []
    }))
}

const MONTH_SHORT = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec'
]

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Tick at the start (left edge) of the day at `offset` days into the range. */
function tickAt(offset: number, days: number, label: string, major: boolean): AxisTick {
    return { pct: (offset / days) * 100, label, major }
}

/**
 * Axis ticks for the range at a granularity fitting the zoom level:
 * - `week`: every day, all major (`Mon 6`)
 * - `month`: every day (minor), week starts major and labelled with the day number
 * - `quarter`: every week start (minor), month starts major (`Sep`)
 * - `year`: every month start, all major (`Sep`)
 */
export function axisTicks(
    range: TimelineRange,
    kind: CalendarRange,
    firstDayOfWeek = 1
): AxisTick[] {
    const days = totalDays(range)
    const ticks: AxisTick[] = []
    if (kind === 'week' || kind === 'month') {
        for (let offset = 0; offset < days; offset++) {
            const date = addDays(range.start, offset)
            if (kind === 'week') {
                const weekday = WEEKDAY_SHORT[date.getDay()] ?? ''
                ticks.push(tickAt(offset, days, `${weekday} ${String(date.getDate())}`, true))
            } else {
                const major = date.getDay() === firstDayOfWeek % 7 || offset === 0
                ticks.push(tickAt(offset, days, major ? String(date.getDate()) : '', major))
            }
        }
        return ticks
    }
    if (kind === 'quarter') {
        for (let offset = 0; offset < days; offset++) {
            const date = addDays(range.start, offset)
            const monthStart = date.getDate() === 1
            const weekStart = toDateKey(startOfWeek(date, firstDayOfWeek)) === toDateKey(date)
            if (!monthStart && !weekStart) continue
            ticks.push(
                tickAt(
                    offset,
                    days,
                    monthStart ? (MONTH_SHORT[date.getMonth()] ?? '') : '',
                    monthStart
                )
            )
        }
        return ticks
    }
    // year: month starts only.
    for (let offset = 0; offset < days; offset++) {
        const date = addDays(range.start, offset)
        if (date.getDate() !== 1) continue
        ticks.push(tickAt(offset, days, MONTH_SHORT[date.getMonth()] ?? '', true))
    }
    return ticks
}
