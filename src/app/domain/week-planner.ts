import { addDays, startOfDay, startOfWeek, toDateKey } from './calendar'
import { GRID_MINUTES, MINUTES_PER_DAY, snapToGrid } from './time-blocks'
import type { Slot, TimeBlock } from './time-blocks'

/**
 * Week Planner mode geometry and membership (issue #172, phase B). Pure.
 *
 * The grid is one column per day of the shown week (rotated by the
 * `firstDayOfWeek` setting) and one vertical minute axis from `gridStart` to
 * `gridEnd` (minutes from midnight; the full day by default). A block crossing
 * midnight renders as two pieces: the tail of its day and the head of the
 * next. Every number a renderer positions with is computed here so it can be
 * unit-tested without a DOM.
 */

export interface WeekGridConfig {
    /** First visible minute (0 = 00:00). */
    gridStart: number
    /** Last visible minute (1440 = 24:00). */
    gridEnd: number
    /** Vertical scale. */
    pxPerMinute: number
    /** The settings' first day of week (0 = Sunday … 6 = Saturday). */
    firstDayOfWeek: number
    /** Work band, minutes from midnight (`workEnd <= workStart` = no band). */
    workStart: number
    workEnd: number
    /** Monday-first day indexes carrying the work band. */
    workDays: number[]
}

/** Monday-first day index (0 = Monday) of a `Date`. */
export function dayIndexOf(date: Date): number {
    return (date.getDay() + 6) % 7
}

/** The Monday-first day index shown in each of the seven columns, left to right. */
export function columnDays(firstDayOfWeek: number): number[] {
    const first = ((firstDayOfWeek % 7) + 7) % 7
    const mondayFirst = (first + 6) % 7
    return Array.from({ length: 7 }, (_, c) => (mondayFirst + c) % 7)
}

/** The seven dates of the week containing `anchor`, in column order. */
export function weekDates(anchor: Date, firstDayOfWeek: number): Date[] {
    const start = startOfWeek(startOfDay(anchor), firstDayOfWeek)
    return Array.from({ length: 7 }, (_, c) => addDays(start, c))
}

/** "Sep 7 – 13, 2026" / "Dec 29, 2025 – Jan 4, 2026". */
export function weekRangeLabel(dates: readonly Date[]): string {
    const first = dates[0]
    const last = dates[dates.length - 1]
    if (!first || !last) return ''
    const month = (d: Date): string => d.toLocaleDateString(undefined, { month: 'short' })
    if (first.getFullYear() !== last.getFullYear()) {
        return `${month(first)} ${first.getDate()}, ${first.getFullYear()} – ${month(last)} ${last.getDate()}, ${last.getFullYear()}`
    }
    if (first.getMonth() !== last.getMonth()) {
        return `${month(first)} ${first.getDate()} – ${month(last)} ${last.getDate()}, ${last.getFullYear()}`
    }
    return `${month(first)} ${first.getDate()} – ${last.getDate()}, ${last.getFullYear()}`
}

/** ISO week number of a date. */
export function isoWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
    const day = d.getUTCDay() || 7
    d.setUTCDate(d.getUTCDate() + 4 - day)
    const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
    return Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7)
}

/**
 * Whether a note whose blocks apply between `start` and `due` (either may be
 * null = open-ended) has any day in the week `weekStart`..`weekEnd`
 * (inclusive, local midnights).
 */
export function inWeekWindow(
    start: Date | null,
    due: Date | null,
    weekStart: Date,
    weekEnd: Date
): boolean {
    if (start && startOfDay(start).getTime() > startOfDay(weekEnd).getTime()) return false
    if (due && startOfDay(due).getTime() < startOfDay(weekStart).getTime()) return false
    return true
}

/** One rendered piece of a slot: a day column and a vertical extent (grid-clipped). */
export interface SlotPiece {
    /** Monday-first day index of the column. */
    day: number
    /** Minutes from midnight of the visible extent. */
    start: number
    end: number
    /** Pixels from the top of the day column. */
    top: number
    height: number
    /** Whether this is the continuation of a midnight-crossing slot. */
    continuation: boolean
    /** Whether the visible extent was clipped by the grid bounds. */
    clippedTop: boolean
    clippedBottom: boolean
}

/** Clip `[start, end)` to the grid and position it; null when fully outside. */
function piece(
    day: number,
    start: number,
    end: number,
    continuation: boolean,
    cfg: WeekGridConfig
): SlotPiece | null {
    const visibleStart = Math.max(start, cfg.gridStart)
    const visibleEnd = Math.min(end, cfg.gridEnd)
    if (visibleEnd <= visibleStart) return null
    return {
        day,
        start: visibleStart,
        end: visibleEnd,
        top: (visibleStart - cfg.gridStart) * cfg.pxPerMinute,
        height: (visibleEnd - visibleStart) * cfg.pxPerMinute,
        continuation,
        clippedTop: visibleStart > start,
        clippedBottom: visibleEnd < end
    }
}

/** The pieces a slot renders as (two for a midnight crosser; the Sunday tail wraps to Monday). */
export function slotPieces(slot: Slot, cfg: WeekGridConfig): SlotPiece[] {
    const pieces: SlotPiece[] = []
    if (slot.end <= MINUTES_PER_DAY) {
        const p = piece(slot.day, slot.start, slot.end, false, cfg)
        if (p) pieces.push(p)
        return pieces
    }
    const head = piece(slot.day, slot.start, MINUTES_PER_DAY, false, cfg)
    if (head) pieces.push(head)
    const tail = piece((slot.day + 1) % 7, 0, slot.end - MINUTES_PER_DAY, true, cfg)
    if (tail) pieces.push(tail)
    return pieces
}

/** The grid minute under a vertical offset (px from the top of a day column), snapped. */
export function minutesAtOffset(offsetPx: number, cfg: WeekGridConfig): number {
    const raw = cfg.gridStart + offsetPx / cfg.pxPerMinute
    return Math.min(cfg.gridEnd, Math.max(cfg.gridStart, snapToGrid(raw)))
}

/** Total grid height in pixels. */
export function gridHeight(cfg: WeekGridConfig): number {
    return (cfg.gridEnd - cfg.gridStart) * cfg.pxPerMinute
}

/** The hour marks (minutes from midnight) to draw, gridStart..gridEnd on whole hours. */
export function hourMarks(cfg: WeekGridConfig): number[] {
    const marks: number[] = []
    const first = Math.ceil(cfg.gridStart / 60) * 60
    for (let m = first; m < cfg.gridEnd; m += 60) marks.push(m)
    return marks
}

/** The work band's vertical extent on a day column (null when the day carries none). */
export function workBand(day: number, cfg: WeekGridConfig): { top: number; height: number } | null {
    if (cfg.workEnd <= cfg.workStart || !cfg.workDays.includes(day)) return null
    const p = piece(day, cfg.workStart, cfg.workEnd, false, cfg)
    return p ? { top: p.top, height: p.height } : null
}

/**
 * The slot a new block occupies when created at `start` on `day`: the
 * default length, shortened so it ends by the grid end (at least one step).
 */
export function newBlockSlot(
    day: number,
    start: number,
    lengthMinutes: number,
    cfg: WeekGridConfig
): Slot {
    const snappedStart = Math.min(
        cfg.gridEnd - GRID_MINUTES,
        Math.max(cfg.gridStart, snapToGrid(start))
    )
    const end = Math.min(
        cfg.gridEnd,
        snappedStart + Math.max(GRID_MINUTES, snapToGrid(lengthMinutes))
    )
    return { day, start: snappedStart, end: Math.max(snappedStart + GRID_MINUTES, end) }
}

/** A note as the week grid sees it. */
export interface WeekEntry {
    path: string
    title: string
    /** First context wins for colour; empty = neutral. */
    contexts: string[]
    blocks: TimeBlock[]
    /** Parse errors of the note's own list (rendered as a warning). */
    errors: { entry: string; error: string }[]
    /** Weekly target in minutes (the "Needs planning" rail reads it). */
    targetMinutes: number | null
    /** Note type name for grouping in pickers. */
    typeName: string | null
    /** Whether the note's status has the active planning role (its blocks count fully). */
    active: boolean
    /** Whether the note's blocks are drawn (today is inside its start..due window). */
    onGrid: boolean
    /** Status label and rank (column order) for the status-grouped rail. */
    statusLabel: string
    statusRank: number
}

/** Entries with a target and no block. */
export function needsPlanning(entries: readonly WeekEntry[]): WeekEntry[] {
    return entries.filter((e) => (e.targetMinutes ?? 0) > 0 && e.blocks.length === 0)
}

/** The rail's groups: entries by status label, in status (column) order, titles sorted. */
export function groupByStatus(
    entries: readonly WeekEntry[]
): { label: string; rank: number; entries: WeekEntry[] }[] {
    const groups = new Map<string, { label: string; rank: number; entries: WeekEntry[] }>()
    for (const entry of entries) {
        const group = groups.get(entry.statusLabel) ?? {
            label: entry.statusLabel,
            rank: entry.statusRank,
            entries: []
        }
        group.entries.push(entry)
        groups.set(entry.statusLabel, group)
    }
    return [...groups.values()]
        .map((g) => ({
            ...g,
            entries: [...g.entries].sort((a, b) => a.title.localeCompare(b.title))
        }))
        .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))
}

/** A stable key for a rendered piece (`path|day|start|end`). */
export function slotKey(path: string, slot: Slot): string {
    return `${path}|${slot.day}|${slot.start}|${slot.end}`
}

/** The date key of the column holding Monday-first `day` in the shown week. */
export function dateKeyForDay(dates: readonly Date[], day: number): string | null {
    const date = dates.find((d) => dayIndexOf(d) === day)
    return date ? toDateKey(date) : null
}
