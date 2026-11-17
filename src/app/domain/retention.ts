import { ageInDays, isoDate } from './archive-grace'
import type { PropertyReader } from './archive-grace'
import { isDoneValue } from './done'
import type { ResolvedDoneConfig } from './done'

/**
 * Retention (issue #241, pure). A done note is deleted once its completion
 * date is older than its retention period. The period is the whole number of
 * days in the note's retention property; a note without a value takes its
 * type's default, and 0 (on the note or as the default) keeps the note.
 *
 * Nothing here deletes or reads the vault: the frontmatter comes through
 * `read`, the clock is `today`, and the answer is a decision the retention
 * service acts on (`services/retention.service.ts`).
 */

export type RetentionValue =
    /** No value on the note: the type's default applies. */
    | { kind: 'unset' }
    /** A whole number of days, 0 included. */
    | { kind: 'days'; days: number }
    /** A value that is not a whole number of days. */
    | { kind: 'invalid'; raw: string }

/** Read a note's retention value: a whole number ≥ 0, as a number or as text. */
export function parseRetentionDays(raw: unknown): RetentionValue {
    if (raw === undefined || raw === null) return { kind: 'unset' }
    if (typeof raw === 'number') {
        return Number.isInteger(raw) && raw >= 0
            ? { kind: 'days', days: raw }
            : { kind: 'invalid', raw: String(raw) }
    }
    if (typeof raw === 'string') {
        const trimmed = raw.trim()
        if (trimmed.length === 0) return { kind: 'unset' }
        return /^\d+$/.test(trimmed)
            ? { kind: 'days', days: Number(trimmed) }
            : { kind: 'invalid', raw: trimmed }
    }
    if (typeof raw === 'boolean') return { kind: 'invalid', raw: String(raw) }
    return { kind: 'invalid', raw: Array.isArray(raw) ? 'a list' : 'an object' }
}

/**
 * The properties holding the completion date, in order: the type's done-date
 * properties (first present wins, as for the archive grace period), else the
 * global fallback property.
 */
export function retentionDateProperties(
    typeProperties: ReadonlyArray<string>,
    fallback: string
): string[] {
    const listed = typeProperties.map((p) => p.trim()).filter((p) => p.length > 0)
    if (listed.length > 0) return listed
    const name = fallback.trim()
    return name.length > 0 ? [name] : []
}

/**
 * A completion date, read strictly: only a real calendar date written
 * `YYYY-MM-DD` (a time may follow). A delete decision must not rest on a
 * guess, so `05/12/2026`, `0000-00-00` or "last week" are not dates here,
 * although the calendar's lenient parser would accept some of them.
 */
export function parseCompletionDate(raw: unknown): Date | null {
    if (typeof raw !== 'string') return null
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(raw.trim())
    if (!match) return null
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    return isoDate(date) === `${String(match[1])}-${String(match[2])}-${String(match[3])}`
        ? date
        : null
}

/**
 * The note's completion date for retention: the LATEST date among the listed
 * properties, so a note completed, reopened and completed again (or completed
 * and later abandoned) counts from its last end, never from a stale earlier
 * one. One unreadable value makes the whole answer `invalid`: the note waits.
 */
export function resolveCompletionDate(
    properties: ReadonlyArray<string>,
    read: PropertyReader
): { property: string; date: Date } | { invalid: true } | null {
    let latest: { property: string; date: Date } | null = null
    for (const property of properties) {
        const raw = read(property)
        if (raw === undefined || raw === null) continue
        if (typeof raw === 'string' && raw.trim().length === 0) continue
        const date = parseCompletionDate(raw)
        if (date === null) return { invalid: true }
        if (latest === null || date.getTime() > latest.date.getTime()) latest = { property, date }
    }
    return latest
}

export type RetentionDecision =
    /** No retention asked for, or the note is not done: nothing to do. */
    | { kind: 'none' }
    /** Retention asked for, but the note's type defines no done state. */
    | { kind: 'no-done-state' }
    /** Done, but the retention value is not a whole number of days. */
    | { kind: 'invalid'; raw: string }
    /** Done with no completion date: stamp one so the clock starts. */
    | { kind: 'stamp'; days: number }
    /** Done, but not old enough yet (or a date cannot be read). */
    | { kind: 'wait'; days: number }
    /** Done, and both the completion date and the last change are `days` old. */
    | { kind: 'expired'; days: number; property: string; completed: Date; ageDays: number }

/**
 * Decide what retention does for one note. The order matters for safety: a
 * note is only ever `expired` when it asks for a retention period above 0
 * (itself or through its type), its type defines a done state, the note is in
 * it NOW (a reopened note drops out), a readable completion date is old
 * enough, and the note was not changed during the period (`modified`). Each
 * edit, a new status included, restarts the clock, so a note completed again
 * with a stale date still gets its full period.
 */
export function retentionDecision(input: {
    /** The raw value of the note's retention property. */
    retention: unknown
    /** The type's default period; 0 keeps notes without their own value. */
    defaultDays: number
    done: ResolvedDoneConfig | null
    dateProperties: ReadonlyArray<string>
    read: PropertyReader
    today: Date
    /** When the note file last changed; null = unknown (no guard). */
    modified?: Date | null
}): RetentionDecision {
    const { retention, defaultDays, done, dateProperties, read, today } = input
    const value = parseRetentionDays(retention)
    if (value.kind === 'days' && value.days === 0) return { kind: 'none' }
    if (value.kind === 'unset' && defaultDays <= 0) return { kind: 'none' }
    if (done === null) return { kind: 'no-done-state' }
    if (!isDoneValue(read(done.property), done.values)) return { kind: 'none' }
    if (value.kind === 'invalid') return { kind: 'invalid', raw: value.raw }
    const days = value.kind === 'days' ? value.days : Math.floor(defaultDays)
    const completed = resolveCompletionDate(dateProperties, read)
    if (completed === null) {
        return dateProperties.length > 0 ? { kind: 'stamp', days } : { kind: 'wait', days }
    }
    if ('invalid' in completed) return { kind: 'wait', days }
    const ageDays = ageInDays(completed.date, today)
    if (ageDays < days) return { kind: 'wait', days }
    if (input.modified && ageInDays(input.modified, today) < days) return { kind: 'wait', days }
    return {
        kind: 'expired',
        days,
        property: completed.property,
        completed: completed.date,
        ageDays
    }
}

/** Why a note past its retention period is kept all the same. */
export type RetentionGuard = 'tracking' | 'folder-note' | 'linked'

/**
 * The guard that keeps an expired note, or null when it may be deleted.
 * A note with a running time-tracking session, a folder note that has other
 * files beside it (deleting the note alone would orphan them; deleting the
 * folder would delete more than was asked), and, when `keepLinked` is on, a
 * note other notes link to.
 */
export function retentionGuard(facts: {
    tracking: boolean
    folderNoteWithSiblings: boolean
    backlinks: number
    keepLinked: boolean
}): RetentionGuard | null {
    if (facts.tracking) return 'tracking'
    if (facts.folderNoteWithSiblings) return 'folder-note'
    if (facts.keepLinked && facts.backlinks > 0) return 'linked'
    return null
}
