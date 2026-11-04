import { parseFrontmatterDate } from './calendar'

/**
 * Lifecycle durations of an action (issue #172, phase C), in whole calendar
 * days, computed from the lifecycle dates and never stored:
 * - cycle = done − started (how long the work took);
 * - lead = started − committed (how long it waited);
 * - lateness = done − due (positive = late, negative = early);
 * - active = today − started, for an item still open.
 * Every value is null when a date it needs is missing or unreadable: a
 * missing date is a blank, never a guess. Dates may be `YYYY-MM-DD` or a full
 * ISO datetime; only its literal calendar day matters (never converted).
 *
 * Pure: no Obsidian imports.
 */

/**
 * The local calendar day of a frontmatter date value, or null. One parser for
 * the whole plugin (issue #232): {@link parseFrontmatterDate}, which takes the
 * LITERAL date part of an ISO value, so `2026-09-08T23:30-05:00` is the 8th
 * here too, the same day the calendar and the timeline show.
 */
export function parseDay(raw: unknown): Date | null {
    return parseFrontmatterDate(raw)
}

function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Whole days from `from` to `to` (negative when `to` is earlier); null if either is missing. */
export function daysBetween(from: Date | null, to: Date | null): number | null {
    if (!from || !to) return null
    const ms = startOfDay(to).getTime() - startOfDay(from).getTime()
    return Math.round(ms / 86_400_000)
}

export interface LifecycleDates {
    committed: Date | null
    started: Date | null
    due: Date | null
    done: Date | null
}

export interface LifecycleDays {
    cycle: number | null
    lead: number | null
    lateness: number | null
    /** Days since start for an open item (null once done, or without a start). */
    active: number | null
}

/** The four durations for one item; `done` set means the item is finished. */
export function lifecycleDays(dates: LifecycleDates, today: Date): LifecycleDays {
    const finished = dates.done !== null
    return {
        cycle: finished ? daysBetween(dates.started, dates.done) : null,
        lead: daysBetween(dates.committed, dates.started),
        lateness: finished ? daysBetween(dates.due, dates.done) : null,
        active: finished ? null : daysBetween(dates.started, today)
    }
}

/** `12d`, `-3d`, `0d`; empty for null. */
export function formatDays(days: number | null): string {
    return days === null ? '' : `${days}d`
}
