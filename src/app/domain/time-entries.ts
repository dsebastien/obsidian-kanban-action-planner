import { coerceOrder } from '../services/frontmatter.service'

/**
 * TaskNotes-compatible time entries (issue #172, phase A).
 *
 * A tracked session is one `{startTime, endTime, description}` object in the
 * note's entries list (`time_entries` in TaskNotes' mapping). Datetimes are
 * stored as LOCAL ISO strings without an offset (`2026-09-09T14:05:00`),
 * exactly as TaskNotes writes them, so the two tools read each other's
 * records. The spent-minutes property is a CACHE recomputed from the list on
 * every write (an entry the user edited or removed by hand is honoured), and
 * the last-session date is the calendar day of the latest entry.
 *
 * Pure: no Obsidian imports, so the arithmetic is unit-testable.
 */

export interface TimeEntry {
    startTime: string
    /** Absent on an entry still running (TaskNotes leaves it open). */
    endTime?: string
    description?: string
}

/** Zero-pad to two digits. */
function pad(n: number): string {
    return n < 10 ? `0${n}` : String(n)
}

/** A `Date` as a local ISO datetime without offset (`YYYY-MM-DDTHH:mm:ss`). */
export function formatEntryDateTime(date: Date): string {
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    )
}

/** A `Date` as a local ISO day (`YYYY-MM-DD`). */
export function formatEntryDate(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Parse a stored entry datetime. Offset-less strings are local time (the
 * TaskNotes convention); strings carrying an offset or `Z` parse as such.
 * Returns null for anything unparsable.
 */
export function parseEntryDateTime(value: unknown): Date | null {
    if (typeof value !== 'string' || value.trim() === '') return null
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
}

/** Coerce a raw frontmatter value into well-formed entries (malformed ones dropped). */
export function parseTimeEntries(raw: unknown): TimeEntry[] {
    if (!Array.isArray(raw)) return []
    const entries: TimeEntry[] = []
    for (const item of raw) {
        if (typeof item !== 'object' || item === null) continue
        const record = item as Record<string, unknown>
        if (typeof record['startTime'] !== 'string' || record['startTime'].trim() === '') continue
        const entry: TimeEntry = { startTime: record['startTime'] }
        if (typeof record['endTime'] === 'string' && record['endTime'].trim() !== '') {
            entry.endTime = record['endTime']
        }
        if (typeof record['description'] === 'string') entry.description = record['description']
        entries.push(entry)
    }
    return entries
}

/**
 * Whole minutes of one CLOSED entry, at least 1 (a tracked tap still counts);
 * null for an open entry or unparsable datetimes. A session crossing
 * midnight is plain subtraction — the entry keeps its real start and end.
 */
export function entryMinutes(entry: TimeEntry): number | null {
    const start = parseEntryDateTime(entry.startTime)
    const end = parseEntryDateTime(entry.endTime)
    if (!start || !end) return null
    const elapsed = end.getTime() - start.getTime()
    if (elapsed < 0) return null
    return Math.max(1, Math.round(elapsed / 60000))
}

/** Sum of every closed entry's minutes (open / malformed entries contribute 0). */
export function sumEntryMinutes(entries: readonly TimeEntry[]): number {
    let total = 0
    for (const entry of entries) total += entryMinutes(entry) ?? 0
    return total
}

/**
 * The local calendar day (`YYYY-MM-DD`) of the latest entry — by end time,
 * falling back to start time for an open entry — or null without entries.
 */
export function latestEntryDate(entries: readonly TimeEntry[]): string | null {
    let latest: Date | null = null
    for (const entry of entries) {
        const at = parseEntryDateTime(entry.endTime) ?? parseEntryDateTime(entry.startTime)
        if (at && (!latest || at.getTime() > latest.getTime())) latest = at
    }
    return latest ? formatEntryDate(latest) : null
}

/** Build the entry a session from `startedAt` to `endedAt` (epoch ms) produces. */
export function buildTimeEntry(startedAt: number, endedAt: number, description = ''): TimeEntry {
    return {
        startTime: formatEntryDateTime(new Date(startedAt)),
        endTime: formatEntryDateTime(new Date(endedAt)),
        description
    }
}

/**
 * A note's own tracked minutes from its raw frontmatter values, in priority
 * order: the entries list when it holds any entry (the ledger is the truth),
 * else the spent-minutes cache when set, else a legacy single `duration`
 * number written by the pre-#172 tracker. Null when nothing is tracked.
 */
export function readTrackedMinutes(raw: {
    entries: unknown
    spent: unknown
    legacy?: unknown
}): number | null {
    const entries = parseTimeEntries(raw.entries)
    if (entries.length > 0) {
        const sum = sumEntryMinutes(entries)
        return sum > 0 ? sum : null
    }
    const spent = coerceOrder(raw.spent)
    if (spent !== null && spent > 0) return spent
    const legacy = coerceOrder(raw.legacy)
    return legacy !== null && legacy > 0 ? legacy : null
}
