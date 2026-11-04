import type { App } from 'obsidian'
import {
    checkPlannedProperties,
    mergeDeclaredProperties,
    type PlannedProperty,
    type PropertyFinding
} from '../domain/declared-properties'
import { plannedPropertiesForType, type TypePropertyDefaults } from '../domain/type-properties'
import type { NoteType } from '../domain/note-type'
import {
    isStarterKitAvailable,
    listGlobalProperties,
    listNoteTypes,
    stampedDatesFor
} from './starter-kit.service'
import {
    isLifecycleDate,
    PREFERRED_SCHEDULED_PROPERTY,
    stampOf,
    type StampedDate
} from '../domain/stamped-dates'
import { createDefaultNoteType } from './note-type.service'

/** The check's result for one Starter Kit note type. */
export interface NoteTypeCheck {
    id: string
    name: string
    /** False when this plugin has no stored config for the type yet (defaults were checked). */
    configured: boolean
    findings: PropertyFinding[]
    /**
     * Informed choices, not faults (issue #232): a planning date that the
     * Starter Kit stamps as a lifecycle fact. Shown, never counted.
     */
    notes: PropertyFinding[]
}

/** The whole report, or why there is none. */
export type NoteTypeCheckReport =
    | { kind: 'unavailable' }
    | { kind: 'no-global-properties' }
    | { kind: 'report'; types: NoteTypeCheck[] }

/**
 * Read-only check (issue #232): for every Starter Kit note type, the
 * properties this plugin would read or write that the type does not declare,
 * or declares with another type. Declarations come LIVE from the Starter Kit
 * (the type's properties + the global ones); the plugin's per-type config is
 * the stored one, else the defaults a new type would get. Nothing is written,
 * not even the mirror.
 */
export function checkNoteTypesAgainstStarterKit(
    app: App,
    settings: TypePropertyDefaults & { noteTypes: ReadonlyArray<NoteType> }
): NoteTypeCheckReport {
    if (!isStarterKitAvailable(app)) return { kind: 'unavailable' }
    const globals = listGlobalProperties(app)
    if (globals === null) return { kind: 'no-global-properties' }
    const types: NoteTypeCheck[] = []
    for (const skType of listNoteTypes(app)) {
        const stored = settings.noteTypes.find((t) => t.id === skType.id)
        const declared = mergeDeclaredProperties(skType.properties ?? [], globals)
        const base =
            stored ??
            createDefaultNoteType(skType.id, skType.name, 'starter-kit', undefined, declared)
        const noteType: NoteType = { ...base, declaredProperties: declared }
        const planned = plannedPropertiesForType(settings, noteType)
        types.push({
            id: skType.id,
            name: skType.name,
            configured: stored !== undefined,
            findings: checkPlannedProperties(noteType, planned),
            notes: stampedDateFindings(planned, stampedDatesFor(app, skType), declared)
        })
    }
    types.sort((a, b) => a.name.localeCompare(b.name))
    return { kind: 'report', types }
}

const DATE_ROLES = new Set(['Start date', 'Due date', 'Defer date'])

/**
 * A planning date (start, due, defer) that is a lifecycle FACT (issue #232):
 * a date the type's Starter Kit automations stamp (`date_started` on 30 -
 * Active), or `date_started` / `date_completed`. Cycle and lead times read
 * it; a drop would fill it early and the real date would never be stamped.
 * The start date names `date_scheduled` as the alternative when the type
 * declares it. These are NOTES: keeping such a property is a valid choice.
 */
export function stampedDateFindings(
    planned: ReadonlyArray<PlannedProperty>,
    stamped: ReadonlyArray<StampedDate>,
    declared: ReadonlyArray<{ name: string }>
): PropertyFinding[] {
    const findings: PropertyFinding[] = []
    const preferred = PREFERRED_SCHEDULED_PROPERTY
    for (const property of planned) {
        if (!DATE_ROLES.has(property.role) || !isLifecycleDate(stamped, property.name)) continue
        const suggest =
            property.role === 'Start date' &&
            declared.some((p) => p.name.toLowerCase() === preferred) &&
            !isLifecycleDate(stamped, preferred)
        findings.push({
            role: property.role,
            name: property.name,
            problem: 'stamped',
            declaredType: null,
            expected: property.expected,
            stampedWhen: stampOf(stamped, property.name)?.when ?? [],
            ...(suggest ? { suggestion: preferred } : {})
        })
    }
    return findings
}

/** One finding as a sentence, for the modal and the console. */
export function describeFinding(finding: PropertyFinding): string {
    if (finding.problem === 'stamped') {
        const when = finding.stampedWhen ?? []
        const fact =
            when.length > 0
                ? `is stamped by the Starter Kit when the status becomes ${when.join(' or ')}`
                : 'is a lifecycle date, not a planning date'
        const alternative = finding.suggestion
            ? ` (${finding.suggestion} is the planning alternative)`
            : ''
        return `${finding.role}: \`${finding.name}\` ${fact}. A drop fills it before the real date${alternative}.`
    }
    if (finding.problem === 'undeclared') {
        return `${finding.role}: \`${finding.name}\` is not declared`
    }
    return `${finding.role}: \`${finding.name}\` is declared as ${finding.declaredType ?? '?'}, expected ${finding.expected.join(' or ')}`
}
