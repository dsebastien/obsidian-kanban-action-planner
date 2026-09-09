import type { ArchiveConfig, AutomationRule } from './note-type'
import { isDoneValue } from './done'
import type { ResolvedDoneConfig } from './done'
import { parseFrontmatterDate, startOfDay } from './calendar'

/**
 * Archive grace period (pure). A note in one of its type's auto-archive
 * statuses is not necessarily archived on the transition: with a global grace
 * period (`archiveGraceDays` > 0) and a type-level list of done-date
 * properties (`archive.doneDateProperties`), the note stays on the board until
 * its done date is old enough, and a board-load sweep archives it. Without a
 * grace period or without a clock source the transition archives at once, as
 * before.
 *
 * The done date is the FIRST listed property holding a non-empty value (first
 * present wins); a note in a trigger status with none set gets that first
 * property stamped with today, which starts its clock — so notes marked done
 * outside the board (editor, scripts) are still swept eventually.
 */

/** Reads a note's raw frontmatter value by property name. */
export type PropertyReader = (property: string) => unknown

export type GraceDecision =
    /** Not a trigger status, or no archive folder: nothing to do. */
    | { kind: 'none' }
    /** No grace period / no clock source: archive on the transition. */
    | { kind: 'immediate' }
    /** The done date is at least the grace period old. */
    | { kind: 'aged'; property: string; ageDays: number }
    /** Trigger status but no done date set: stamp `property` with today. */
    | { kind: 'stamp'; property: string }
    /** Done date set but younger than the grace period (or unparseable). */
    | { kind: 'wait' }

/** The configured done-date property names, trimmed, blanks dropped. */
export function doneDateProperties(archive: ArchiveConfig): string[] {
    return archive.doneDateProperties.map((p) => p.trim()).filter((p) => p.length > 0)
}

/** Whether `status` auto-archives notes of this type (folder set + trigger). */
export function isArchiveTrigger(archive: ArchiveConfig, status: string | null): boolean {
    if (status === null) return false
    return archive.triggerStatuses.includes(status) && archive.archiveFolder.trim().length > 0
}

/**
 * The note's done date: the first listed property with a non-empty value.
 * `invalid` = a value is present but not a date (neither stamp nor archive).
 */
export function resolveDoneDate(
    properties: ReadonlyArray<string>,
    read: PropertyReader
): { property: string; date: Date } | { property: string; invalid: true } | null {
    for (const property of properties) {
        const raw = read(property)
        if (raw === undefined || raw === null) continue
        if (typeof raw === 'string' && raw.trim().length === 0) continue
        const date = parseFrontmatterDate(raw)
        return date ? { property, date } : { property, invalid: true }
    }
    return null
}

/** Whole calendar days from `from` to `today` (local midnights). */
export function ageInDays(from: Date, today: Date): number {
    const ms = startOfDay(today).getTime() - startOfDay(from).getTime()
    return Math.round(ms / 86_400_000)
}

/**
 * Decide what archiving should do for a note sitting in `status`. Pure: the
 * frontmatter is read through `read`, the clock is `today`.
 */
export function graceDecision(input: {
    archive: ArchiveConfig
    status: string | null
    graceDays: number
    read: PropertyReader
    today: Date
}): GraceDecision {
    const { archive, status, graceDays, read, today } = input
    if (!isArchiveTrigger(archive, status)) return { kind: 'none' }
    const properties = doneDateProperties(archive)
    const first = properties[0]
    if (graceDays <= 0 || first === undefined) return { kind: 'immediate' }
    const done = resolveDoneDate(properties, read)
    if (done === null) return { kind: 'stamp', property: first }
    if ('invalid' in done) return { kind: 'wait' }
    const ageDays = ageInDays(done.date, today)
    if (ageDays >= graceDays) return { kind: 'aged', property: done.property, ageDays }
    return { kind: 'wait' }
}

/** `YYYY-MM-DD` of a local date — the value stamped as a done date. */
export function isoDate(date: Date): string {
    const pad = (n: number): string => (n < 10 ? `0${String(n)}` : String(n))
    return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Which done-date property to stamp for a note in `status` when none is set:
 * the one the type's own automations would write on that transition (a
 * `status-entered` rule listing the status, or a `done-entered` rule when the
 * status is a done value, whose `set-property` targets a listed property) —
 * so an Abandoned note gets `date_abandoned`, not `date_completed` — else the
 * first listed property.
 */
export function stampProperty(
    archive: ArchiveConfig,
    status: string | null,
    rules: ReadonlyArray<AutomationRule>,
    done: ResolvedDoneConfig | null
): string | null {
    const properties = doneDateProperties(archive)
    const first = properties[0]
    if (first === undefined) return null
    const listed = new Map(properties.map((p) => [p.toLowerCase(), p]))
    for (const rule of rules) {
        if (!rule.enabled || status === null) continue
        const trigger = rule.trigger
        const matches =
            (trigger.kind === 'status-entered' && trigger.statuses.includes(status)) ||
            (trigger.kind === 'done-entered' && done !== null && isDoneValue(status, done.values))
        if (!matches) continue
        for (const action of rule.actions) {
            if (action.kind !== 'set-property') continue
            const hit = listed.get(action.property.trim().toLowerCase())
            if (hit !== undefined) return hit
        }
    }
    return first
}
