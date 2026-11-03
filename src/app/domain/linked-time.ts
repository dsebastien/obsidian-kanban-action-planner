import type { TimeEntry } from './time-entries'
import { formatEntryDate, latestEntryDate, sumEntryMinutes } from './time-entries'

/**
 * Time from linked notes (per note type, opt-in).
 *
 * A note N counts for a target note T when N carries the required tag
 * (hierarchical: `type/session` matches `type/session/sport/running`) and
 * its link property links to T. N then contributes its minutes on its date:
 * - minutes: `Number(raw)`, counted only when finite and > 0;
 * - date: the first 10 characters of a string, when they read `YYYY-MM-DD`.
 *   No valid date = the minutes still count for all-time totals, never for a
 *   week, and the note does not move the last-session date. A valid date
 *   moves the last-session date even with no minutes (a play with no
 *   duration is still a session).
 *
 * An entry of T whose description is a wikilink to a note counted for T is
 * skipped: that session counts once, with the linked note's own minutes.
 *
 * Pure: no Obsidian imports. The index and link resolution live in
 * `services/linked-time.service.ts`.
 */

/** The resolved (non-blank) config a target note's type uses. */
export interface LinkedTimeConfig {
    linkProperty: string
    minutesProperty: string
    dateProperty: string
    requiredTag: string
}

/** One linked note counted for a target. */
export interface LinkedNoteTime {
    path: string
    /** Its minutes (0 when none or not counted). */
    minutes: number
    /** Its day (`YYYY-MM-DD`), or null without a valid date. */
    date: string | null
}

/** The tracked time of a target: entries + linked notes. */
export interface TrackedTimeResult {
    /** `entryMinutes + linkedMinutes`: the value a recompute stores. */
    minutes: number
    /** Rounded sum of the counted entries (linked-session entries skipped). */
    entryMinutes: number
    /** Sum of the linked notes' minutes. */
    linkedMinutes: number
    /** Later of the latest counted entry day and the latest linked date; null when neither. */
    lastSession: string | null
    /** The linked notes counted, sorted by path. */
    linkedNotes: LinkedNoteTime[]
}

/** A tag without its leading '#' and trailing '/', lower-cased. */
export function normalizeTag(tag: string): string {
    return tag.trim().replace(/^#/, '').replace(/\/+$/, '').toLowerCase()
}

/**
 * Whether a raw frontmatter `tags` value (a list, or a single string) holds
 * `required` or one of its nested tags. Case-insensitive, leading '#'
 * ignored. A blank `required` matches nothing.
 */
export function tagsInclude(raw: unknown, required: string): boolean {
    const want = normalizeTag(required)
    if (want === '') return false
    const list: unknown[] = Array.isArray(raw) ? (raw as unknown[]) : [raw]
    return list.some((tag) => {
        if (typeof tag !== 'string') return false
        const have = normalizeTag(tag)
        return have === want || have.startsWith(`${want}/`)
    })
}

/** A linked note's day: the first 10 chars of a string when they read `YYYY-MM-DD`, else null. */
export function linkedDate(raw: unknown): string | null {
    if (typeof raw !== 'string') return null
    const day = raw.slice(0, 10)
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

/** A linked note's minutes: `Number(raw)` when finite and > 0, else 0. */
export function linkedMinutes(raw: unknown): number {
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * The link path of an entry description that is exactly one wikilink
 * (`[[name]]`, `[[name|alias]]`, `[[name#heading]]`; surrounding spaces
 * trimmed), without its subpath; null for anything else.
 */
export function entryDescriptionLinkpath(description: string | undefined): string | null {
    const match = /^\[\[([^[\]|]+)(?:\|[^[\]]*)?\]\]$/.exec((description ?? '').trim())
    const target = match?.[1]
    if (target === undefined) return null
    const linkpath = target.split('#')[0]?.trim() ?? ''
    return linkpath === '' ? null : linkpath
}

/**
 * Combine a target's entries with its linked notes. `isLinkedEntry` tells
 * whether an entry is a linked note's session (its description resolves to
 * a counted linked note); those entries are left out of both the minutes
 * and the last-session date.
 */
export function combineTrackedTime(
    entries: readonly TimeEntry[],
    linked: readonly LinkedNoteTime[],
    isLinkedEntry: (entry: TimeEntry) => boolean
): TrackedTimeResult {
    const kept = entries.filter((entry) => !isLinkedEntry(entry))
    const entryMinutes = Math.round(sumEntryMinutes(kept))
    let linkedTotal = 0
    let latestLinked: string | null = null
    for (const note of linked) {
        linkedTotal += note.minutes
        if (note.date !== null && (latestLinked === null || note.date > latestLinked)) {
            latestLinked = note.date
        }
    }
    const latestEntry = latestEntryDate(kept)
    const lastSession =
        latestEntry === null
            ? latestLinked
            : latestLinked === null || latestEntry >= latestLinked
              ? latestEntry
              : latestLinked
    return {
        minutes: entryMinutes + linkedTotal,
        entryMinutes,
        linkedMinutes: linkedTotal,
        lastSession,
        linkedNotes: [...linked].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    }
}

/**
 * The minutes of the linked notes whose date falls inside `[from, to)`
 * (local days; a note without a valid date never counts for a range).
 */
export function linkedMinutesInRange(
    linked: readonly LinkedNoteTime[],
    from: Date,
    to: Date
): number {
    const lo = formatEntryDate(from)
    const hi = formatEntryDate(to)
    let total = 0
    for (const note of linked) {
        if (note.date !== null && note.date >= lo && note.date < hi) total += note.minutes
    }
    return total
}
