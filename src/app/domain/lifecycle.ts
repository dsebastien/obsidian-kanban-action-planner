/**
 * Lifecycle durations of an action (issue #172, phase C), in whole calendar
 * days, computed from the lifecycle dates and never stored:
 * - cycle = done − started (how long the work took);
 * - lead = started − committed (how long it waited);
 * - lateness = done − due (positive = late, negative = early);
 * - active = today − started, for an item still open.
 * Every value is null when a date it needs is missing or unreadable: a
 * missing date is a blank, never a guess. Dates may be `YYYY-MM-DD` or a full
 * ISO datetime; only the local calendar day matters.
 *
 * Pure: no Obsidian imports.
 */

/** The local calendar day of a frontmatter date value, or null. */
export function parseDay(raw: unknown): Date | null {
    if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : startOfDay(raw)
    if (typeof raw !== 'string' || raw.trim() === '') return null
    const value = raw.trim()
    // A bare date is local (`new Date('2026-09-09')` would be UTC midnight).
    const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (bare) {
        const date = new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3]))
        return Number.isNaN(date.getTime()) ? null : date
    }
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : startOfDay(date)
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
