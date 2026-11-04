import type { NoteType } from './note-type'
import type { EstimateConfig } from './estimate'
import { DATE_TYPES, LIST_TYPES, NUMBER_TYPES, type PlannedProperty } from './declared-properties'

/**
 * Per-note-type property resolution (issue #232). Pure: every resolver takes
 * the global defaults and the card's OWN note type (undefined = untyped), so a
 * mixed board resolves each card through its own type instead of the board's
 * dominant one.
 */

/** The global defaults the resolvers fall back to. */
export interface TypePropertyDefaults {
    defaultOrderProperty: string
    defaultScheduledDateProperty: string
    defaultDueDateProperty: string
    defaultDeferDateProperty: string
    defaultEstimateProperty: string
    defaultMilestonesProperty: string
    defaultProgressProperty: string
    defaultDurationProperty: string
    defaultTotalDurationProperty: string
    defaultTimeEntriesProperty: string
    defaultLastSessionProperty: string
    defaultTimeBlocksProperty: string
    defaultPlannedMinutesProperty: string
    defaultTargetMinutesProperty: string
}

const pick = (value: string | undefined, fallback: string): string =>
    value && value.trim() !== '' ? value.trim() : fallback

/** A type's start, due and defer date properties (blank per-type value = global). */
export interface TypeDateProperties {
    start: string
    due: string
    defer: string
}

export function datePropertiesForType(
    settings: Pick<
        TypePropertyDefaults,
        'defaultScheduledDateProperty' | 'defaultDueDateProperty' | 'defaultDeferDateProperty'
    >,
    noteType: Pick<NoteType, 'calendar'> | undefined
): TypeDateProperties {
    const calendar = noteType?.calendar
    return {
        start: pick(calendar?.scheduledDateProperty, settings.defaultScheduledDateProperty),
        due: pick(calendar?.dueDateProperty, settings.defaultDueDateProperty),
        defer: pick(calendar?.deferDateProperty, settings.defaultDeferDateProperty)
    }
}

/**
 * A type's estimate property + unit, or `null` when the type has no estimate
 * (mode `none`, issue #232). Resolution:
 * 1. an explicit override: `none` → null; else its property (blank = the
 *    global name) and unit;
 * 2. a type whose Starter Kit declarations are known: `time_estimate`
 *    (minutes) or `time_estimate_days` (days) when declared, else the global
 *    property when declared (days), else null — the type is not estimated;
 * 3. otherwise (local type, untyped card, older Starter Kit): the global
 *    property in days, as before.
 */
export function estimateConfigForType(
    settings: Pick<TypePropertyDefaults, 'defaultEstimateProperty'>,
    noteType: Pick<NoteType, 'estimate' | 'declaredProperties'> | undefined
): EstimateConfig | null {
    const override = noteType?.estimate
    if (override) {
        if (override.mode === 'none') return null
        return {
            property: pick(override.property, settings.defaultEstimateProperty),
            unit: override.unit
        }
    }
    const declared = noteType?.declaredProperties
    if (declared) {
        const has = (name: string): boolean =>
            declared.some((p) => p.name.toLowerCase() === name.toLowerCase())
        if (has('time_estimate')) return { property: 'time_estimate', unit: 'minutes' }
        if (has('time_estimate_days')) return { property: 'time_estimate_days', unit: 'days' }
        if (has(settings.defaultEstimateProperty))
            return { property: settings.defaultEstimateProperty, unit: 'days' }
        return null
    }
    return { property: settings.defaultEstimateProperty, unit: 'days' }
}

/**
 * Every property the plugin reads or writes for notes of `noteType`, with
 * the declared types it expects. Feeds the read-only "Check note types
 * against the Starter Kit" command.
 */
export function plannedPropertiesForType(
    settings: TypePropertyDefaults,
    noteType: NoteType
): PlannedProperty[] {
    const dates = datePropertiesForType(settings, noteType)
    const estimate = estimateConfigForType(settings, noteType)
    const tracking = noteType.timeTracking
    const week = noteType.weekPlanner
    const planned: PlannedProperty[] = [
        { role: 'Status', name: noteType.statusProperty, expected: [] },
        {
            role: 'Manual order',
            name: pick(noteType.orderProperty, settings.defaultOrderProperty),
            expected: NUMBER_TYPES
        },
        { role: 'Start date', name: dates.start, expected: DATE_TYPES },
        { role: 'Due date', name: dates.due, expected: DATE_TYPES },
        { role: 'Defer date', name: dates.defer, expected: DATE_TYPES },
        ...(estimate
            ? [{ role: 'Estimate', name: estimate.property, expected: NUMBER_TYPES }]
            : []),
        {
            role: 'Tracked time',
            name: pick(tracking?.durationProperty, settings.defaultDurationProperty),
            expected: NUMBER_TYPES
        },
        {
            role: 'Total tracked time',
            name: pick(tracking?.totalDurationProperty, settings.defaultTotalDurationProperty),
            expected: NUMBER_TYPES
        },
        {
            role: 'Time entries',
            name: pick(tracking?.entriesProperty, settings.defaultTimeEntriesProperty),
            expected: [...LIST_TYPES, 'object']
        },
        {
            role: 'Last session',
            name: pick(tracking?.lastSessionProperty, settings.defaultLastSessionProperty),
            expected: DATE_TYPES
        },
        { role: 'Milestones', name: settings.defaultMilestonesProperty, expected: LIST_TYPES },
        { role: 'Progress', name: settings.defaultProgressProperty, expected: NUMBER_TYPES },
        {
            role: 'Time blocks',
            name: pick(week?.timeBlocksProperty, settings.defaultTimeBlocksProperty),
            expected: LIST_TYPES
        },
        {
            role: 'Planned minutes',
            name: pick(week?.plannedMinutesProperty, settings.defaultPlannedMinutesProperty),
            expected: NUMBER_TYPES
        },
        {
            role: 'Target minutes',
            name: pick(week?.targetMinutesProperty, settings.defaultTargetMinutesProperty),
            expected: NUMBER_TYPES
        }
    ]
    for (const rule of noteType.relationships) {
        planned.push({
            role: `Relationship (${rule.role.replace('_', ' ')})`,
            name: rule.linkProperty,
            expected: rule.cardinality === 'one' ? [...LIST_TYPES, 'text'] : LIST_TYPES
        })
    }
    return planned
}

/** The ISO formats a typed date property is written with (issue #232). */
export const ISO_DATE_FORMAT = 'YYYY-MM-DD'
export const ISO_DATETIME_FORMAT = 'YYYY-MM-DDTHH:mm'

/**
 * The momentjs format to write a date into a property of `propertyType`
 * (issue #232): a `date` property gets `YYYY-MM-DD`, a `datetime` property
 * `YYYY-MM-DDTHH:mm`, whatever the board's free-text format says. Only an
 * untyped (or otherwise typed) property uses `fallback`, the configured
 * date format.
 */
export function dateFormatForType(
    propertyType: string | null | undefined,
    fallback: string
): string {
    if (propertyType === 'date') return ISO_DATE_FORMAT
    if (propertyType === 'datetime') return ISO_DATETIME_FORMAT
    return fallback
}
