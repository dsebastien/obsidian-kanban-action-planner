import type { TrackedTimeResult } from './linked-time'
import type { TimeEntry } from './time-entries'
import {
    buildTimeEntry,
    numericDuration,
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
 *   `created` day (fallback: the file's creation time) and lasting the
 *   difference, so no current week's ring jumps; the stored total then
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

/**
 * Local midnight (epoch ms) of the day a manual adjustment is dated on: the
 * first 10 characters of `created` when they read `YYYY-MM-DD` (taken as
 * written, no timezone conversion), else the local day of `fallbackMs`
 * (the file's creation time).
 */
export function manualAdjustmentStart(createdRaw: unknown, fallbackMs: number): number {
    if (typeof createdRaw === 'string') {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(createdRaw.trim().slice(0, 10))
        if (match) {
            const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
            if (!Number.isNaN(day.getTime())) return day.getTime()
        }
    }
    const fallback = new Date(fallbackMs)
    return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate()).getTime()
}

/** The entry a "keep" writes: `difference` minutes from the adjustment day's midnight. */
export function manualAdjustmentEntry(
    createdRaw: unknown,
    fallbackMs: number,
    difference: number
): TimeEntry {
    const start = manualAdjustmentStart(createdRaw, fallbackMs)
    return buildTimeEntry(start, start + difference * 60000, MANUAL_ADJUSTMENT)
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
    /** The file's creation time (epoch ms), when `created` is missing. */
    fallbackCreatedMs: number
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
                    input.fallbackCreatedMs,
                    verdict.decision.difference
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
