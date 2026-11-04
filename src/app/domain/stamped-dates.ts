/**
 * Lifecycle dates the Starter Kit stamps (issue #232). A type's automation
 * rule such as "status enters 30 - Active → set `date_started` to `{{date}}`,
 * only if empty" makes `date_started` a FACT: cycle and lead times read it.
 * A board that wrote it on a drop would fill it early, and the real start
 * would never be stamped. So the planner never picks such a property as a
 * planning date, and the type check flags one that is configured.
 *
 * Pure: no Obsidian imports; every input is normalized defensively.
 */

/** One stamped property and the statuses (or triggers) that stamp it. */
export interface StampedDate {
    property: string
    /** Status values whose entry stamps it; a non-status trigger reads e.g. `done`. */
    when: string[]
}

/** Lifecycle dates never used as a planning date, whatever the automations say. */
export const LIFECYCLE_DATE_PROPERTIES: ReadonlyArray<string> = ['date_started', 'date_completed']

const DATE_TOKEN = /\{\{\s*(date|now|datetime)\s*\}\}/i

/** The trigger's label for the message: its statuses, else its kind. */
function triggerLabels(trigger: unknown): string[] {
    if (typeof trigger !== 'object' || trigger === null) return []
    const { kind, statuses } = trigger as { kind?: unknown; statuses?: unknown }
    if (Array.isArray(statuses)) {
        const values = statuses.filter((s): s is string => typeof s === 'string' && s !== '')
        if (values.length > 0) return values
    }
    if (kind === 'done-entered') return ['done']
    if (kind === 'archived') return ['archived']
    return typeof kind === 'string' && kind !== '' ? [kind] : []
}

/**
 * The date properties a type's automation rules stamp: every enabled rule's
 * `set-property` action whose value is a date token (`{{date}}`, `{{now}}`,
 * `{{datetime}}`), plus the status values that stamp a date (`stampsDate`).
 * Names keep their first spelling; matching is case-insensitive.
 */
export function stampedDatesOf(
    automations: unknown,
    statusStamps: ReadonlyArray<{ value: string; stampsDate: string | null }> = []
): StampedDate[] {
    const byName = new Map<string, StampedDate>()
    const add = (property: string, when: string[]): void => {
        const key = property.trim().toLowerCase()
        if (key === '') return
        const entry = byName.get(key) ?? { property: property.trim(), when: [] }
        for (const label of when) if (!entry.when.includes(label)) entry.when.push(label)
        byName.set(key, entry)
    }
    if (Array.isArray(automations)) {
        for (const rule of automations as unknown[]) {
            if (typeof rule !== 'object' || rule === null) continue
            const { enabled, trigger, actions } = rule as {
                enabled?: unknown
                trigger?: unknown
                actions?: unknown
            }
            if (enabled === false || !Array.isArray(actions)) continue
            for (const action of actions as unknown[]) {
                if (typeof action !== 'object' || action === null) continue
                const { kind, property, value } = action as {
                    kind?: unknown
                    property?: unknown
                    value?: unknown
                }
                if (kind !== 'set-property' || typeof property !== 'string') continue
                if (typeof value !== 'string' || !DATE_TOKEN.test(value)) continue
                add(property, triggerLabels(trigger))
            }
        }
    }
    for (const status of statusStamps) {
        if (status.stampsDate) add(status.stampsDate, [status.value])
    }
    return [...byName.values()]
}

/** The stamp entry for `property`, or undefined when nothing stamps it. */
export function stampOf(
    stamped: ReadonlyArray<StampedDate>,
    property: string
): StampedDate | undefined {
    const key = property.trim().toLowerCase()
    return stamped.find((s) => s.property.toLowerCase() === key)
}

/** True when `property` may not be a planning date: stamped, or a lifecycle date. */
export function isLifecycleDate(stamped: ReadonlyArray<StampedDate>, property: string): boolean {
    const key = property.trim().toLowerCase()
    return LIFECYCLE_DATE_PROPERTIES.includes(key) || stampOf(stamped, property) !== undefined
}

/** The planning property the planner prefers for a Starter Kit type. */
export const PREFERRED_SCHEDULED_PROPERTY = 'date_scheduled'

/**
 * The per-type scheduled property to store when a Starter Kit type is set up
 * or mirrored (issue #232). An explicit per-type value is the user's and is
 * kept (the check flags a stamped one). An empty value inherits the global
 * default; when that default is a lifecycle date for this type and the type
 * declares `date_scheduled`, `date_scheduled` is pinned instead. Otherwise
 * the value stays empty (inherit).
 */
export function pickScheduledProperty(
    current: string,
    globalDefault: string,
    declared: ReadonlyArray<{ name: string }> | undefined,
    stamped: ReadonlyArray<StampedDate>
): string {
    if (current.trim() !== '') return current
    if (!isLifecycleDate(stamped, globalDefault)) return current
    const preferred = PREFERRED_SCHEDULED_PROPERTY
    const declaresPreferred = (declared ?? []).some(
        (p) => p.name.toLowerCase() === preferred.toLowerCase()
    )
    return declaresPreferred && !isLifecycleDate(stamped, preferred) ? preferred : current
}
