import type { TrackedTimeResult } from './linked-time'
import type { TimeEntry } from './time-entries'
import {
    buildTimeEntry,
    entryMinutes,
    formatEntryDate,
    numericDuration,
    parseEntryDateTime,
    parseTimeEntries,
    withoutEmptyEntries
} from './time-entries'

/**
 * A recompute never lowers a stored tracked time on its own (business rule 79).
 *
 * When the stored duration is above the computed one (a total typed by
 * hand, or a linked session removed or shortened), the recompute leaves it
 * and reports a {@link TrackedTimeDecision}; the user decides:
 * - keep: the difference becomes ONE time entry described
 *   {@link MANUAL_ADJUSTMENT}, starting at local midnight of the note's
 *   `created` day (fallback: the earliest tracked day, then the file's
 *   creation time) and lasting the difference, never ending after now; the stored total then
 *   equals the computed one, that entry included;
 * - drop: the computed value is written.
 *
 * Pure: no Obsidian imports.
 */

/** The description of the entry a "keep" writes. */
export const MANUAL_ADJUSTMENT = 'Manual adjustment'

/** The property whose day dates a manual adjustment (read case-insensitively). */
export const CREATED_PROPERTY = 'created'

/** The user's answer when the stored time is above the computed one. */
export type LowerChoice = 'keep' | 'drop'

/** The stored total is above the computed one: left as it is until the user decides. */
export interface TrackedTimeDecision {
    /** The stored minutes, rounded. */
    stored: number
    /** The computed minutes (entries + linked notes). */
    computed: number
    /** `stored − computed`, always ≥ 1. */
    difference: number
}

/**
 * The public API's answer (`plugin.api.computeTrackedTime`): the computed
 * tracked time, plus the stored duration and, when the stored value is above
 * the computed one, the decision "Recompute tracked time" asks for. `minutes`
 * stays the COMPUTED value; a caller must not write it over a higher stored
 * value without the user (`decision` set).
 */
export interface TrackedTimeReport extends TrackedTimeResult {
    /** The stored duration as a number (numeric strings accepted); null when empty or not a number. */
    storedMinutes: number | null
    /** Set when the stored duration (rounded) is above `minutes` and the note has entries or linked minutes. */
    decision: TrackedTimeDecision | null
}

/** What a recompute does with the stored duration. */
export type DurationVerdict =
    /** No entries and no linked minutes: nothing to compute from, the stored value stays. */
    | { kind: 'leave' }
    /** The stored value already equals the computed one. */
    | { kind: 'same' }
    /** Stored empty, not a number, or below: the computed value is written. */
    | { kind: 'write' }
    /** Stored above computed: the user decides. */
    | { kind: 'lower'; decision: TrackedTimeDecision }

/**
 * Compare a stored duration with a computed one. `hasSources` is false when
 * the note has no entries and no linked minutes (then the stored value is
 * its only record and stays). Stored values are compared rounded, so 80.4
 * against 80 is not "lower".
 */
export function durationVerdict(
    storedRaw: unknown,
    hasSources: boolean,
    computed: number
): DurationVerdict {
    if (!hasSources) return { kind: 'leave' }
    if (storedRaw === computed) return { kind: 'same' }
    const decision = lowerDecision(storedRaw, computed)
    return decision ? { kind: 'lower', decision } : { kind: 'write' }
}

/** The decision to ask for when `storedRaw` (rounded) is above `computed`, else null. */
export function lowerDecision(storedRaw: unknown, computed: number): TrackedTimeDecision | null {
    const stored = numericDuration(storedRaw)
    if (stored === null) return null
    const rounded = Math.round(stored)
    return rounded > computed ? { stored: rounded, computed, difference: rounded - computed } : null
}

/** Local midnight (epoch ms) of a `YYYY-MM-DD…` string's day (taken as written), or null. */
function dayStart(raw: unknown): number | null {
    if (typeof raw !== 'string') return null
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim().slice(0, 10))
    if (!match) return null
    const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    return Number.isNaN(day.getTime()) ? null : day.getTime()
}

/** Where a manual adjustment is dated when the note has no usable `created` value. */
export interface AdjustmentFallback {
    /** The earliest day the note was tracked (`YYYY-MM-DD`: first entry or linked note), or null. */
    earliestDay: string | null
    /** The file's creation time (epoch ms). */
    fileCreatedMs: number
}

/**
 * Local midnight (epoch ms) of the day a manual adjustment is dated on: the
 * first 10 characters of `created` when they read `YYYY-MM-DD` (taken as
 * written, no timezone conversion), else the earliest tracked day (first
 * entry start or linked-note date), else the local day of the file's
 * creation time.
 */
export function manualAdjustmentStart(createdRaw: unknown, fallback: AdjustmentFallback): number {
    const created = dayStart(createdRaw) ?? dayStart(fallback.earliestDay)
    if (created !== null) return created
    const ctime = new Date(fallback.fileCreatedMs)
    return new Date(ctime.getFullYear(), ctime.getMonth(), ctime.getDate()).getTime()
}

const HOUR_MS = 3600000

/**
 * The entry a "keep" writes: `difference` minutes from the adjustment day's
 * midnight, moved earlier when it would end after `now` (start = min(midnight,
 * now − difference)), so it never lies in the future nor moves the last session
 * forward. Entries are local datetimes without offset, so an end inside the
 * hour repeated when clocks go back would read back an hour short: the start
 * is then moved by whole hours (later when that still ends by `now`, else
 * earlier) until the stored entry reads back as exactly `difference` minutes.
 */
export function manualAdjustmentEntry(
    createdRaw: unknown,
    fallback: AdjustmentFallback,
    difference: number,
    now: number
): TimeEntry {
    const latestStart = now - difference * 60000
    const start = Math.min(manualAdjustmentStart(createdRaw, fallback), latestStart)
    const build = (at: number): TimeEntry =>
        buildTimeEntry(at, at + difference * 60000, MANUAL_ADJUSTMENT)
    for (const shift of [0, 1, 2, 3, -1, -2, -3]) {
        const at = start + shift * HOUR_MS
        if (at > latestStart) continue
        const entry = build(at)
        if (entryMinutes(entry) === difference) return entry
    }
    return build(start)
}

/** The earliest local day of the entries' starts and the linked notes' dates, or null. */
export function earliestTrackedDay(
    entries: readonly TimeEntry[],
    linked: readonly { date: string | null }[]
): string | null {
    let earliest: string | null = null
    const consider = (day: string | null): void => {
        if (day !== null && (earliest === null || day < earliest)) earliest = day
    }
    for (const entry of entries) {
        const start = parseEntryDateTime(entry.startTime)
        consider(start ? formatEntryDate(start) : null)
    }
    for (const note of linked) consider(note.date)
    return earliest
}

/**
 * The last-session day an APPEND writes (timer stop, a kept rollup): the
 * latest of `candidates`, only when it is later than the stored day (an
 * append never makes the last session earlier). Null = write nothing.
 */
export function laterLastSession(
    storedRaw: unknown,
    candidates: readonly (string | null)[]
): string | null {
    let latest: string | null = null
    for (const day of candidates) {
        if (day !== null && (latest === null || day > latest)) latest = day
    }
    if (latest === null) return null
    const stored =
        typeof storedRaw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(storedRaw)
            ? storedRaw.slice(0, 10)
            : null
    return stored === null || latest > stored ? latest : null
}

/** The stored values and inputs a recompute plans from. */
export interface RecomputeInput {
    /** Raw value of the entries property. */
    rawEntries: unknown
    /** Raw value of the duration property. */
    storedDuration: unknown
    /** Raw value of the last-session property. */
    storedLastSession: unknown
    /** The tracked time of an entries list (entries + linked notes). */
    compute: (rawEntries: unknown) => TrackedTimeResult
    /** The user's answer when stored > computed; null = never lower, report instead. */
    choice: LowerChoice | null
    /** Raw value of the `created` property. */
    created: unknown
    /** The file's creation time (epoch ms), when `created` and the tracked days are missing. */
    fileCreatedMs: number
    /** Now (epoch ms): a manual adjustment never ends after it. */
    now: number
}

/** The writes a recompute makes (each only when it changes the stored value). */
export interface RecomputePlan {
    /** New entries list (empty items dropped, or a manual adjustment added). */
    entries?: unknown[]
    /** New duration. */
    duration?: number
    /** New last-session day. */
    lastSession?: string
    /** Set when stored > computed and no choice was given: nothing lowers. */
    decision: TrackedTimeDecision | null
    /** Minutes kept as a manual adjustment entry (0 when none). */
    adjusted: number
    /** The duration after the plan; null when the duration is left alone (no sources). */
    minutes: number | null
    /** The tracked time after the plan (the manual adjustment included). */
    result: TrackedTimeResult
}

/**
 * Plan a recompute of a note's tracked time: duration = kept entries +
 * linked minutes, last session = the later of the latest entry day and the
 * latest linked date. Never lowers the stored duration without a choice;
 * idempotent (after a keep, the next plan writes nothing).
 */
export function planRecompute(input: RecomputeInput): RecomputePlan {
    const cleaned = withoutEmptyEntries(input.rawEntries)
    const base: unknown[] = Array.isArray(input.rawEntries)
        ? (cleaned ?? (input.rawEntries as unknown[]))
        : []
    let result = input.compute(input.rawEntries)
    const hasSources = parseTimeEntries(input.rawEntries).length > 0 || result.linkedMinutes > 0
    const verdict = durationVerdict(input.storedDuration, hasSources, result.minutes)
    const plan: RecomputePlan = { decision: null, adjusted: 0, minutes: null, result }
    if (cleaned) plan.entries = cleaned
    switch (verdict.kind) {
        case 'leave':
            break
        case 'same':
            plan.minutes = result.minutes
            break
        case 'write':
            plan.duration = result.minutes
            plan.minutes = result.minutes
            break
        case 'lower':
            if (input.choice === 'keep') {
                const entry = manualAdjustmentEntry(
                    input.created,
                    {
                        earliestDay: earliestTrackedDay(
                            parseTimeEntries(input.rawEntries),
                            result.linkedNotes
                        ),
                        fileCreatedMs: input.fileCreatedMs
                    },
                    verdict.decision.difference,
                    input.now
                )
                const list = [...base, entry]
                result = input.compute(list)
                plan.entries = list
                plan.adjusted = verdict.decision.difference
                plan.result = result
                plan.minutes = result.minutes
                if (input.storedDuration !== result.minutes) plan.duration = result.minutes
            } else if (input.choice === 'drop') {
                plan.duration = result.minutes
                plan.minutes = result.minutes
            } else {
                plan.decision = verdict.decision
                plan.minutes = verdict.decision.stored
            }
            break
    }
    if (result.lastSession !== null && input.storedLastSession !== result.lastSession) {
        plan.lastSession = result.lastSession
    }
    return plan
}
